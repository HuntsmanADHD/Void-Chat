/*
 * HttpServer.java — minimal HTTP/1.1 server for the relay, loopback only,
 * one virtual thread per connection. Zero dependencies. Handles the subset
 * of HTTP the relay needs: GET/POST/DELETE/OPTIONS, Content-Length bodies
 * (no chunked request bodies — the client never sends them), keep-alive,
 * CORS, and a WebSocket upgrade hand-off on GET /ws.
 *
 * Not a general-purpose server: request line + headers are capped, bodies
 * are capped, anything malformed gets a 400 and the connection closes.
 */
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BiFunction;

public final class HttpServer {
    private static final int MAX_REQUEST_LINE = 8 * 1024;
    private static final int MAX_HEADERS_BYTES = 32 * 1024;
    private static final int MAX_HEADER_COUNT = 100;

    private final int port;
    private final int maxBodyBytes;
    private final List<Route> routes = new ArrayList<>();
    private WsHandler wsHandler;
    private volatile ServerSocket serverSocket;

    public HttpServer(int port, int maxBodyBytes) {
        this.port = port;
        this.maxBodyBytes = maxBodyBytes;
    }

    // ── Routing ───────────────────────────────────────────────────────

    /**
     * A handler receives the parsed request and returns a Response. Path
     * params are exposed via Request.param(name) for patterns like
     * "/api/communities/:id".
     */
    public interface Handler {
        Response handle(Request req) throws Exception;
    }

    /** Called when a GET request wants to upgrade to WebSocket (path /ws). */
    public interface WsHandler {
        void onUpgrade(Socket socket, Request req, InputStream in, OutputStream out);
    }

    public void route(String method, String pattern, Handler handler) {
        routes.add(new Route(method, pattern, handler));
    }

    public void websocket(String path, WsHandler handler) {
        this.wsHandler = handler;
        this.wsPath = path;
    }

    private String wsPath = "/ws";

    // ── Lifecycle ─────────────────────────────────────────────────────

    public void start() throws IOException {
        // Bind to loopback only — the relay is never reachable from a
        // non-loopback address (matches the Rust relay's 127.0.0.1 bind).
        serverSocket = new ServerSocket(port, 128, InetAddress.getByName("127.0.0.1"));
        Thread.ofVirtual().name("http-accept").start(this::acceptLoop);
    }

    public int boundPort() {
        return serverSocket.getLocalPort();
    }

    public void stop() {
        try {
            ServerSocket s = serverSocket;
            if (s != null) s.close();
        } catch (IOException ignored) {
        }
    }

    private void acceptLoop() {
        ServerSocket ss = serverSocket;
        for (;;) {
            Socket socket;
            try {
                socket = ss.accept();
            } catch (IOException e) {
                if (ss.isClosed()) return; // graceful shutdown
                continue;
            }
            Thread.ofVirtual().start(() -> handleConnection(socket));
        }
    }

    private void handleConnection(Socket socket) {
        String peerIp = socket.getInetAddress().getHostAddress();
        try {
            socket.setTcpNoDelay(true);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();
            for (;;) {
                Request req = parseRequest(in, peerIp);
                if (req == null)
                    return; // clean EOF between keep-alive requests

                // WebSocket upgrade hand-off (GET /ws with Upgrade header).
                if (wsHandler != null && req.method.equals("GET")
                        && req.path.equals(wsPath)
                        && "websocket".equalsIgnoreCase(req.header("upgrade"))) {
                    wsHandler.onUpgrade(socket, req, in, out);
                    return; // the ws handler owns the socket now
                }

                Response resp = dispatch(req);
                boolean keepAlive = writeResponse(out, req, resp);
                if (!keepAlive)
                    return;
            }
        } catch (BadRequest e) {
            try {
                writeRaw(socket.getOutputStream(),
                        Response.text(e.status, e.getMessage() + "\n"), false);
            } catch (IOException ignored) {
            }
        } catch (IOException ignored) {
            // peer hung up; nothing to do
        } finally {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private Response dispatch(Request req) {
        boolean pathMatchedDifferentMethod = false;
        for (Route r : routes) {
            Map<String, String> params = r.match(req.method, req.path);
            if (params != null) {
                req.params = params;
                try {
                    return r.handler.handle(req);
                } catch (BadRequest br) {
                    return Response.json(br.status, Json.obj("error", br.getMessage()));
                } catch (Store.Conflict c) {
                    return Response.json(409, Json.obj("error", c.getMessage()));
                } catch (Store.NotFound nf) {
                    return Response.json(404, Json.obj("error", "Not found"));
                } catch (Exception e) {
                    Log.warn("handler error: " + e);
                    return Response.json(500, Json.obj("error", "Internal server error"));
                }
            }
            if (r.pathMatches(req.path))
                pathMatchedDifferentMethod = true;
        }
        // CORS preflight for a known path: answer OPTIONS generically.
        if (req.method.equals("OPTIONS") && pathMatchedDifferentMethod)
            return Response.noContent();
        if (pathMatchedDifferentMethod)
            return Response.json(405, Json.obj("error", "Method not allowed"));
        return Response.json(404, Json.obj("error", "Not found"));
    }

    // ── Request parsing ───────────────────────────────────────────────

    private Request parseRequest(InputStream in, String peerIp) throws IOException {
        String line = readLine(in, MAX_REQUEST_LINE);
        if (line == null)
            return null; // EOF
        if (line.isEmpty())
            throw new BadRequest(400, "empty request line");
        String[] parts = line.split(" ");
        if (parts.length != 3)
            throw new BadRequest(400, "malformed request line");
        String method = parts[0];
        String target = parts[1];
        if (!parts[2].startsWith("HTTP/1."))
            throw new BadRequest(400, "unsupported HTTP version");

        String path = target;
        String query = "";
        int q = target.indexOf('?');
        if (q >= 0) {
            path = target.substring(0, q);
            query = target.substring(q + 1);
        }
        path = urlDecode(path);

        Map<String, String> headers = new LinkedHashMap<>();
        int headerBytes = 0;
        for (;;) {
            String h = readLine(in, MAX_REQUEST_LINE);
            if (h == null)
                throw new BadRequest(400, "unexpected EOF in headers");
            if (h.isEmpty())
                break;
            headerBytes += h.length() + 2;
            if (headerBytes > MAX_HEADERS_BYTES || headers.size() > MAX_HEADER_COUNT)
                throw new BadRequest(431, "headers too large");
            int colon = h.indexOf(':');
            if (colon <= 0)
                throw new BadRequest(400, "malformed header");
            String name = h.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String value = h.substring(colon + 1).trim();
            // last value wins; the relay never relies on multi-valued headers
            headers.put(name, value);
        }

        byte[] body = new byte[0];
        String cl = headers.get("content-length");
        if (cl != null) {
            int len;
            try {
                len = Integer.parseInt(cl.trim());
            } catch (NumberFormatException e) {
                throw new BadRequest(400, "bad Content-Length");
            }
            if (len < 0)
                throw new BadRequest(400, "bad Content-Length");
            if (len > maxBodyBytes)
                throw new BadRequest(413, "Payload too large");
            body = readN(in, len);
            if (body == null)
                throw new BadRequest(400, "unexpected EOF in body");
        } else if ("chunked".equalsIgnoreCase(headers.get("transfer-encoding"))) {
            throw new BadRequest(411, "chunked request bodies not supported");
        }

        Request req = new Request();
        req.method = method;
        req.path = path;
        req.rawQuery = query;
        req.headers = headers;
        req.body = body;
        req.peerIp = peerIp;
        return req;
    }

    /** Read a CRLF- or LF-terminated line as ASCII; null on immediate EOF. */
    private static String readLine(InputStream in, int max) throws IOException {
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        int c = in.read();
        if (c == -1)
            return null;
        while (c != -1) {
            if (c == '\n') {
                int n = buf.size();
                byte[] b = buf.toByteArray();
                int end = (n > 0 && b[n - 1] == '\r') ? n - 1 : n;
                return new String(b, 0, end, StandardCharsets.ISO_8859_1);
            }
            buf.write(c);
            if (buf.size() > max)
                throw new BadRequest(431, "line too long");
            c = in.read();
        }
        // EOF mid-line
        return new String(buf.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        byte[] b = new byte[n];
        int off = 0;
        while (off < n) {
            int r = in.read(b, off, n - off);
            if (r == -1)
                return null;
            off += r;
        }
        return b;
    }

    // ── Response writing ──────────────────────────────────────────────

    /** Returns true if the connection should be kept alive. */
    private boolean writeResponse(OutputStream out, Request req, Response resp) throws IOException {
        boolean keepAlive = !"close".equalsIgnoreCase(req.header("connection"));
        // attach CORS headers chosen by the handler/global policy
        if (req.corsOrigin != null)
            resp.headers.putIfAbsent("Access-Control-Allow-Origin", req.corsOrigin);
        writeRaw(out, resp, keepAlive);
        return keepAlive;
    }

    private static void writeRaw(OutputStream out, Response resp, boolean keepAlive) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(resp.status).append(' ')
          .append(reason(resp.status)).append("\r\n");
        resp.headers.putIfAbsent("Content-Type", resp.contentType);
        sb.append("Content-Length: ").append(resp.body.length).append("\r\n");
        sb.append("Connection: ").append(keepAlive ? "keep-alive" : "close").append("\r\n");
        for (Map.Entry<String, String> e : resp.headers.entrySet())
            sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(resp.body);
        out.flush();
    }

    private static String urlDecode(String s) {
        if (s.indexOf('%') < 0 && s.indexOf('+') < 0)
            return s;
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '%' && i + 2 < s.length()) {
                int hi = Character.digit(s.charAt(i + 1), 16);
                int lo = Character.digit(s.charAt(i + 2), 16);
                if (hi >= 0 && lo >= 0) {
                    b.write((hi << 4) | lo);
                    i += 2;
                    continue;
                }
            }
            b.write(c);
        }
        return new String(b.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 201: return "Created";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 409: return "Conflict";
            case 411: return "Length Required";
            case 413: return "Payload Too Large";
            case 429: return "Too Many Requests";
            case 431: return "Request Header Fields Too Large";
            case 500: return "Internal Server Error";
            default: return "Status";
        }
    }

    // ── Types ─────────────────────────────────────────────────────────

    public static final class Request {
        String method;
        String path;
        String rawQuery;
        Map<String, String> headers;
        byte[] body;
        String peerIp;
        Map<String, String> params = Map.of();
        String corsOrigin; // set by the CORS layer when the origin is allowed

        public String method() { return method; }
        public String path() { return path; }
        public byte[] body() { return body; }
        public String peerIp() { return peerIp; }
        public String param(String name) { return params.get(name); }

        public String header(String name) {
            return headers.get(name.toLowerCase(Locale.ROOT));
        }

        public String query(String key) {
            if (rawQuery == null || rawQuery.isEmpty())
                return null;
            for (String pair : rawQuery.split("&")) {
                int eq = pair.indexOf('=');
                String k = eq < 0 ? pair : pair.substring(0, eq);
                if (k.equals(key))
                    return eq < 0 ? "" : urlDecode(pair.substring(eq + 1));
            }
            return null;
        }

        public String bodyString() {
            return new String(body, StandardCharsets.UTF_8);
        }
    }

    public static final class Response {
        int status;
        byte[] body;
        String contentType = "application/json";
        Map<String, String> headers = new LinkedHashMap<>();

        public static Response json(int status, Object value) {
            Response r = new Response();
            r.status = status;
            r.body = Json.write(value).getBytes(StandardCharsets.UTF_8);
            r.contentType = "application/json";
            return r;
        }

        public static Response text(int status, String text) {
            Response r = new Response();
            r.status = status;
            r.body = text.getBytes(StandardCharsets.UTF_8);
            r.contentType = "text/plain; charset=utf-8";
            return r;
        }

        public static Response noContent() {
            Response r = new Response();
            r.status = 204;
            r.body = new byte[0];
            r.contentType = "text/plain";
            return r;
        }

        public Response header(String name, String value) {
            headers.put(name, value);
            return this;
        }
    }

    /** Thrown by handlers to short-circuit with a status + message. */
    public static final class BadRequest extends RuntimeException {
        final int status;
        public BadRequest(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private static final class Route {
        final String method;
        final String[] segments;
        final Handler handler;

        Route(String method, String pattern, Handler handler) {
            this.method = method;
            this.segments = pattern.substring(1).split("/", -1);
            this.handler = handler;
        }

        /** Returns captured params if method+path match, else null. */
        Map<String, String> match(String reqMethod, String reqPath) {
            if (!method.equals(reqMethod))
                return null;
            return capture(reqPath);
        }

        boolean pathMatches(String reqPath) {
            return capture(reqPath) != null;
        }

        private Map<String, String> capture(String reqPath) {
            String[] parts = reqPath.substring(1).split("/", -1);
            if (parts.length != segments.length)
                return null;
            Map<String, String> params = new LinkedHashMap<>();
            for (int i = 0; i < segments.length; i++) {
                String seg = segments[i];
                if (seg.startsWith(":")) {
                    if (parts[i].isEmpty())
                        return null;
                    params.put(seg.substring(1), parts[i]);
                } else if (!seg.equals(parts[i])) {
                    return null;
                }
            }
            return params;
        }
    }
}
