/*
 * WsClientConnection.java — RFC 6455 *client* over a plain Socket: the
 * mirror image of relay-java's server-side WebSocket.java. Performs the GET
 * upgrade handshake (random Sec-WebSocket-Key, verifies the SHA-1 accept
 * digest), sends MASKED frames as the RFC requires of clients, reads
 * unmasked server frames with fragmentation support and a size cap, and
 * auto-pongs pings. Pure java.base — replaces java.net.http.WebSocket so
 * the same code path runs directly and through Transport's SOCKS5/Tor route
 * (the JDK client can't do SOCKS).
 *
 * Threading mirrors the server side: a dedicated reader virtual thread and a
 * writer virtual thread draining an outbound queue; send()/close() are safe
 * from any thread. Lifecycle: open() connects + handshakes (blocking, so a
 * failure throws to the caller), then start() begins delivery — assign your
 * reference BETWEEN the two, so the first inbound frame can never beat the
 * field assignment (the race the old java.net.http onOpen comment fought).
 */
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Locale;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;

public final class WsClientConnection {
    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_MESSAGE_BYTES = 256 * 1024; // match the relay's cap
    private static final int MAX_HANDSHAKE_BYTES = 16 * 1024;
    private static final Object QUEUE_CLOSE = new Object();
    private static final SecureRandom RANDOM = new SecureRandom();

    public interface Listener {
        void onText(String message);
        /** Fires exactly once, for any cause (clean close, error, EOF). */
        void onClose();
    }

    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final Listener listener;
    private final LinkedBlockingQueue<Object> outbox = new LinkedBlockingQueue<>();
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final AtomicBoolean closeNotified = new AtomicBoolean(false);
    private volatile boolean started = false;

    private WsClientConnection(Socket socket, InputStream in, OutputStream out, Listener listener) {
        this.socket = socket;
        this.in = in;
        this.out = out;
        this.listener = listener;
    }

    /**
     * Connect (via `transport`) and complete the upgrade handshake for a
     * ws:// URI. Throws if the relay is unreachable or the handshake fails.
     * No frames are delivered until start() is called.
     */
    public static WsClientConnection open(Transport transport, String wsUri, Listener listener)
            throws IOException {
        URI u = URI.create(wsUri);
        if (!"ws".equalsIgnoreCase(u.getScheme()))
            throw new IOException("only ws:// is supported, got: " + wsUri);
        String host = u.getHost();
        int port = u.getPort() == -1 ? 80 : u.getPort();
        String path = (u.getRawPath() == null || u.getRawPath().isEmpty()) ? "/" : u.getRawPath();

        Socket s = transport.open(host, port);
        try {
            InputStream in = new java.io.BufferedInputStream(s.getInputStream());
            OutputStream out = new java.io.BufferedOutputStream(s.getOutputStream());
            handshake(in, out, host, port, path);
            return new WsClientConnection(s, in, out, listener);
        } catch (IOException e) {
            try { s.close(); } catch (IOException ignored) {}
            throw e;
        }
    }

    /** Begin frame delivery (reader + writer threads). Call exactly once. */
    public void start() {
        if (started) throw new IllegalStateException("already started");
        started = true;
        Thread.ofVirtual().name("wsc-writer").start(this::writerLoop);
        Thread.ofVirtual().name("wsc-reader").start(this::readerLoop);
    }

    /** Queue a text frame for sending. Non-blocking, thread-safe. */
    public void send(String text) {
        if (!closed.get())
            outbox.offer(text);
    }

    /** Send a close frame and tear down; the reader then fires onClose once. */
    public void close() {
        if (closed.compareAndSet(false, true))
            outbox.offer(QUEUE_CLOSE);
    }

    public boolean isClosed() {
        return closed.get();
    }

    // ── Handshake ─────────────────────────────────────────────────────

    private static void handshake(InputStream in, OutputStream out,
            String host, int port, String path) throws IOException {
        byte[] keyBytes = new byte[16];
        RANDOM.nextBytes(keyBytes);
        String key = Base64.getEncoder().encodeToString(keyBytes);
        String req = "GET " + path + " HTTP/1.1\r\n"
                + "Host: " + host + (port == 80 ? "" : ":" + port) + "\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + key + "\r\n"
                + "Sec-WebSocket-Version: 13\r\n\r\n";
        out.write(req.getBytes(StandardCharsets.ISO_8859_1));
        out.flush();

        String response = readHeaderBlock(in);
        String statusLine = response.substring(0, lineEnd(response));
        if (!statusLine.startsWith("HTTP/1.1 101"))
            throw new IOException("websocket upgrade refused: " + statusLine);
        String accept = headerValue(response, "sec-websocket-accept");
        if (!acceptKey(key).equals(accept))
            throw new IOException("bad Sec-WebSocket-Accept (got " + accept + ")");
    }

    /** Read bytes until the \r\n\r\n that ends the response header block. */
    private static String readHeaderBlock(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        int state = 0; // consecutive bytes of \r\n\r\n matched
        while (state < 4) {
            int b = in.read();
            if (b == -1) throw new IOException("EOF during websocket handshake");
            buf.write(b);
            if (buf.size() > MAX_HANDSHAKE_BYTES) throw new IOException("handshake response too large");
            state = (b == ((state % 2 == 0) ? '\r' : '\n')) ? state + 1 : (b == '\r' ? 1 : 0);
        }
        return buf.toString(StandardCharsets.ISO_8859_1);
    }

    private static int lineEnd(String block) {
        int i = block.indexOf("\r\n");
        return i == -1 ? block.length() : i;
    }

    private static String headerValue(String block, String lowerName) {
        for (String line : block.split("\r\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().toLowerCase(Locale.ROOT).equals(lowerName))
                return line.substring(colon + 1).trim();
        }
        return null;
    }

    private static String acceptKey(String key) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            return Base64.getEncoder().encodeToString(
                    sha1.digest((key + GUID).getBytes(StandardCharsets.ISO_8859_1)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-1 unavailable", e);
        }
    }

    // ── Reader ────────────────────────────────────────────────────────

    private void readerLoop() {
        try {
            java.io.ByteArrayOutputStream fragments = null;
            int fragOpcode = 0;
            for (;;) {
                Frame f = readFrame();
                if (f == null)
                    break; // EOF
                switch (f.opcode) {
                    case 0x0: // continuation
                        if (fragments == null) { shutdownAndNotify(); return; }
                        fragments.write(f.payload);
                        if (fragments.size() > MAX_MESSAGE_BYTES) { shutdownAndNotify(); return; }
                        if (f.fin) {
                            String msg = new String(fragments.toByteArray(), StandardCharsets.UTF_8);
                            fragments = null;
                            if (fragOpcode == 0x1) listener.onText(msg);
                        }
                        break;
                    case 0x1: // text
                        if (f.fin) {
                            listener.onText(new String(f.payload, StandardCharsets.UTF_8));
                        } else {
                            fragments = new java.io.ByteArrayOutputStream();
                            fragments.write(f.payload);
                            fragOpcode = 0x1;
                        }
                        break;
                    case 0x2: // binary — relay protocol is text-only; ignore
                        if (!f.fin) {
                            fragments = new java.io.ByteArrayOutputStream();
                            fragments.write(f.payload);
                            fragOpcode = 0x2;
                        }
                        break;
                    case 0x8: // close from server
                        shutdownAndNotify();
                        return;
                    case 0x9: // ping → masked pong (we are the client)
                        sendControl(0xA, f.payload);
                        break;
                    case 0xA: // pong — ignore
                        break;
                    default:
                        shutdownAndNotify();
                        return;
                }
            }
        } catch (IOException e) {
            // transport closed under us
        }
        shutdownAndNotify();
    }

    private void shutdownAndNotify() {
        closed.set(true);
        outbox.offer(QUEUE_CLOSE);
        try { socket.close(); } catch (IOException ignored) {}
        if (closeNotified.compareAndSet(false, true))
            listener.onClose();
    }

    private Frame readFrame() throws IOException {
        int b0 = in.read();
        if (b0 == -1) return null;
        int b1 = readByte();
        boolean fin = (b0 & 0x80) != 0;
        int opcode = b0 & 0x0f;
        boolean masked = (b1 & 0x80) != 0;
        long len = b1 & 0x7f;
        if (len == 126) {
            len = ((long) readByte() << 8) | readByte();
        } else if (len == 127) {
            len = 0;
            for (int i = 0; i < 8; i++) len = (len << 8) | readByte();
        }
        // RFC 6455 §5.1: server frames MUST NOT be masked.
        if (masked) throw new IOException("masked server frame");
        if (len > MAX_MESSAGE_BYTES) throw new IOException("frame too large");
        byte[] payload = new byte[(int) len];
        readFully(payload, (int) len);
        Frame f = new Frame();
        f.fin = fin;
        f.opcode = opcode;
        f.payload = payload;
        return f;
    }

    private int readByte() throws IOException {
        int c = in.read();
        if (c == -1) throw new IOException("unexpected EOF");
        return c;
    }

    private void readFully(byte[] buf, int n) throws IOException {
        int off = 0;
        while (off < n) {
            int r = in.read(buf, off, n - off);
            if (r == -1) throw new IOException("unexpected EOF");
            off += r;
        }
    }

    // ── Writer ────────────────────────────────────────────────────────

    private void writerLoop() {
        try {
            for (;;) {
                Object item = outbox.take();
                if (item == QUEUE_CLOSE) {
                    try { writeFrame(0x8, new byte[0]); } catch (IOException ignored) {}
                    break;
                }
                if (item instanceof String text)
                    writeFrame(0x1, text.getBytes(StandardCharsets.UTF_8));
            }
        } catch (InterruptedException | IOException e) {
            // fall through to shutdown
        } finally {
            shutdownAndNotify();
        }
    }

    private synchronized void sendControl(int opcode, byte[] payload) throws IOException {
        writeFrame(opcode, payload);
    }

    /** Write one FIN frame, masked as RFC 6455 requires of clients. */
    private synchronized void writeFrame(int opcode, byte[] payload) throws IOException {
        out.write(0x80 | opcode);
        int len = payload.length;
        if (len < 126) {
            out.write(0x80 | len); // mask bit + length
        } else if (len < 65536) {
            out.write(0x80 | 126);
            out.write((len >>> 8) & 0xff);
            out.write(len & 0xff);
        } else {
            out.write(0x80 | 127);
            for (int i = 7; i >= 0; i--)
                out.write((int) (((long) len >>> (8 * i)) & 0xff));
        }
        byte[] mask = new byte[4];
        RANDOM.nextBytes(mask);
        out.write(mask);
        byte[] maskedPayload = new byte[len];
        for (int i = 0; i < len; i++)
            maskedPayload[i] = (byte) (payload[i] ^ mask[i & 3]);
        out.write(maskedPayload);
        out.flush();
    }

    private static final class Frame {
        boolean fin;
        int opcode;
        byte[] payload;
    }
}
