/*
 * RelayHttpClient.java — thin client for the relay HTTP API
 * (community/channel CRUD). Hand-rolled HTTP/1.1 over a Transport socket —
 * pure java.base, no java.net.http — so the same code path works directly
 * and through SOCKS5/Tor (where the JDK client can't go). One
 * Connection: close request per call; the relay always answers with
 * Content-Length (see HttpServer.java), but read-to-EOF also works as a
 * fallback. Returns parsed JSON values (Json maps/lists). Throws
 * ApiException on non-2xx with the relay's error message.
 */
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class RelayHttpClient {
    private static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // avatars are ≤2 MB

    private final String base; // e.g. http://127.0.0.1:3001 or http://xyz.onion
    private final Transport transport;

    public RelayHttpClient(String base) {
        this(base, Transport.DIRECT);
    }

    public RelayHttpClient(String base, Transport transport) {
        this.base = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        this.transport = transport == null ? Transport.DIRECT : transport;
    }

    public static final class ApiException extends RuntimeException {
        public final int status;
        public ApiException(int status, String message) { super(message); this.status = status; }
    }

    /** GET /api/communities → list of community objects. */
    public List<Object> listCommunities() throws Exception {
        Map<String, Object> r = Json.asObj(get("/api/communities"));
        return Json.asArr(r.get("communities"));
    }

    /** POST /api/communities → created community (includes deleteToken if no password). */
    public Map<String, Object> createCommunity(String name, String description, String password) throws Exception {
        Map<String, Object> body = Json.obj("name", name);
        if (description != null) body.put("description", description);
        if (password != null) body.put("password", password);
        return Json.asObj(post("/api/communities", body, null));
    }

    /** GET /api/communities/:id → community + channels (password via header if needed). */
    public Map<String, Object> getCommunity(String id, String password) throws Exception {
        return Json.asObj(get("/api/communities/" + id, password));
    }

    /** POST /api/communities/:id/channels → created channel. */
    public Map<String, Object> createChannel(String communityId, String name, String password) throws Exception {
        return Json.asObj(post("/api/communities/" + communityId + "/channels", Json.obj("name", name), password));
    }

    // ── plumbing ──────────────────────────────────────────────────────

    private Object get(String path) throws Exception { return get(path, null); }

    private Object get(String path, String password) throws Exception {
        return request("GET", path, null, password);
    }

    private Object post(String path, Object body, String password) throws Exception {
        return request("POST", path, body, password);
    }

    private Object request(String method, String path, Object body, String password) throws Exception {
        URI u = URI.create(base);
        if (!"http".equalsIgnoreCase(u.getScheme()))
            throw new IOException("only http:// relay URLs are supported, got: " + base);
        String host = u.getHost();
        int port = u.getPort() == -1 ? 80 : u.getPort();

        byte[] bodyBytes = body == null ? null : Json.write(body).getBytes(StandardCharsets.UTF_8);
        StringBuilder req = new StringBuilder();
        req.append(method).append(' ').append(path).append(" HTTP/1.1\r\n");
        req.append("Host: ").append(host);
        if (port != 80) req.append(':').append(port);
        req.append("\r\n");
        req.append("Connection: close\r\n");
        req.append("Accept: application/json\r\n");
        if (password != null) req.append("x-community-password: ").append(password).append("\r\n");
        if (bodyBytes != null) {
            req.append("Content-Type: application/json\r\n");
            req.append("Content-Length: ").append(bodyBytes.length).append("\r\n");
        }
        req.append("\r\n");

        int status;
        String responseBody;
        try (Socket s = transport.open(host, port)) {
            OutputStream out = s.getOutputStream();
            out.write(req.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (bodyBytes != null) out.write(bodyBytes);
            out.flush();

            InputStream in = new java.io.BufferedInputStream(s.getInputStream());
            String headerBlock = readHeaderBlock(in);
            status = parseStatus(headerBlock);
            String lenHeader = headerValue(headerBlock, "content-length");
            byte[] raw = lenHeader != null
                    ? readN(in, Integer.parseInt(lenHeader.trim()))
                    : readToEof(in);
            responseBody = new String(raw, StandardCharsets.UTF_8);
        }

        Object parsed = responseBody.isEmpty() ? null : Json.parse(responseBody);
        if (status / 100 != 2) {
            Map<String, Object> err = Json.asObj(parsed);
            String msg = err != null && Json.str(err, "error") != null
                    ? Json.str(err, "error") : "HTTP " + status;
            throw new ApiException(status, msg);
        }
        return parsed;
    }

    private static String readHeaderBlock(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        int state = 0; // consecutive bytes of \r\n\r\n matched
        while (state < 4) {
            int b = in.read();
            if (b == -1) throw new IOException("EOF in response headers");
            buf.write(b);
            if (buf.size() > 64 * 1024) throw new IOException("response headers too large");
            state = (b == ((state % 2 == 0) ? '\r' : '\n')) ? state + 1 : (b == '\r' ? 1 : 0);
        }
        return buf.toString(StandardCharsets.ISO_8859_1);
    }

    private static int parseStatus(String headerBlock) throws IOException {
        // "HTTP/1.1 200 OK\r\n..."
        int sp = headerBlock.indexOf(' ');
        if (sp == -1 || sp + 4 > headerBlock.length())
            throw new IOException("bad status line");
        try {
            return Integer.parseInt(headerBlock.substring(sp + 1, sp + 4));
        } catch (NumberFormatException e) {
            throw new IOException("bad status line");
        }
    }

    private static String headerValue(String block, String lowerName) {
        for (String line : block.split("\r\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().toLowerCase(Locale.ROOT).equals(lowerName))
                return line.substring(colon + 1).trim();
        }
        return null;
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        if (n < 0 || n > MAX_RESPONSE_BYTES) throw new IOException("bad Content-Length: " + n);
        byte[] buf = new byte[n];
        int off = 0;
        while (off < n) {
            int r = in.read(buf, off, n - off);
            if (r == -1) throw new IOException("EOF in response body");
            off += r;
        }
        return buf;
    }

    private static byte[] readToEof(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int r;
        while ((r = in.read(chunk)) != -1) {
            buf.write(chunk, 0, r);
            if (buf.size() > MAX_RESPONSE_BYTES) throw new IOException("response too large");
        }
        return buf.toByteArray();
    }
}
