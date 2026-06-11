/*
 * WebSocket.java — RFC 6455 server endpoint. Handles the upgrade handshake
 * (SHA-1 accept key), reads masked client frames (text/binary/close/ping/
 * pong) with a size cap and fragmentation support, auto-replies to pings,
 * and writes unmasked server text frames. Zero dependencies.
 *
 * Threading: each connection has a dedicated reader (the virtual thread that
 * accepted it) and a dedicated writer virtual thread draining an outbound
 * queue, so application code can send from any thread without blocking the
 * reader. send()/close() are safe to call concurrently.
 */
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;

public final class WebSocket {
    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_MESSAGE_BYTES = 256 * 1024; // generous; ciphertext cap is checked above this
    private static final long QUEUE_POISON = -1;

    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final LinkedBlockingQueue<Object> outbox = new LinkedBlockingQueue<>();
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private Thread writerThread;

    public interface Listener {
        void onOpen(WebSocket ws);
        void onText(WebSocket ws, String message);
        void onClose(WebSocket ws);
    }

    private WebSocket(Socket socket, InputStream in, OutputStream out) {
        this.socket = socket;
        this.in = in;
        this.out = out;
    }

    /**
     * Complete the RFC 6455 handshake on an already-parsed GET /ws request
     * and run the read loop until close. Blocks the calling (reader) thread.
     */
    public static void accept(Socket socket, HttpServer.Request req,
            InputStream in, OutputStream out, Listener listener) {
        String key = req.header("sec-websocket-key");
        if (key == null) {
            writeHandshakeError(out);
            return;
        }
        String accept = acceptKey(key);
        String resp = "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        try {
            out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
        } catch (IOException e) {
            return;
        }

        WebSocket ws = new WebSocket(socket, in, out);
        ws.writerThread = Thread.ofVirtual().name("ws-writer").start(ws::writerLoop);
        try {
            listener.onOpen(ws);
            ws.readLoop(listener);
        } finally {
            ws.shutdown();
            listener.onClose(ws);
        }
    }

    /** Queue a text frame for sending. Non-blocking, thread-safe. */
    public void send(String text) {
        if (!closed.get())
            outbox.offer(text);
    }

    /** Initiate a clean close; the reader loop will then exit. */
    public void close() {
        if (closed.compareAndSet(false, true)) {
            outbox.offer(QUEUE_POISON);
            try { socket.shutdownInput(); } catch (IOException ignored) {}
        }
    }

    public boolean isClosed() {
        return closed.get();
    }

    // ── Reader ────────────────────────────────────────────────────────

    private void readLoop(Listener listener) {
        try {
            java.io.ByteArrayOutputStream fragments = null;
            int fragOpcode = 0;
            for (;;) {
                Frame f = readFrame();
                if (f == null)
                    return; // EOF or close

                switch (f.opcode) {
                    case 0x0: // continuation
                        if (fragments == null)
                            return; // protocol error
                        fragments.write(f.payload);
                        if (fragments.size() > MAX_MESSAGE_BYTES)
                            return;
                        if (f.fin) {
                            String msg = new String(fragments.toByteArray(), StandardCharsets.UTF_8);
                            fragments = null;
                            if (fragOpcode == 0x1)
                                listener.onText(this, msg);
                        }
                        break;
                    case 0x1: // text
                        if (f.fin) {
                            listener.onText(this, new String(f.payload, StandardCharsets.UTF_8));
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
                    case 0x8: // close
                        return;
                    case 0x9: // ping → pong with same payload
                        sendControl(0xA, f.payload);
                        break;
                    case 0xA: // pong — ignore
                        break;
                    default:
                        return; // unknown opcode: fail the connection
                }
            }
        } catch (IOException e) {
            // transport closed under us
        }
    }

    private Frame readFrame() throws IOException {
        int b0 = in.read();
        if (b0 == -1)
            return null;
        int b1 = in.read();
        if (b1 == -1)
            return null;
        boolean fin = (b0 & 0x80) != 0;
        int opcode = b0 & 0x0f;
        boolean masked = (b1 & 0x80) != 0;
        long len = b1 & 0x7f;
        if (len == 126) {
            len = ((long) readByte() << 8) | readByte();
        } else if (len == 127) {
            len = 0;
            for (int i = 0; i < 8; i++)
                len = (len << 8) | readByte();
        }
        // RFC 6455: client frames MUST be masked. Reject unmasked + oversize.
        if (!masked)
            throw new IOException("unmasked client frame");
        if (len > MAX_MESSAGE_BYTES)
            throw new IOException("frame too large");
        byte[] mask = new byte[4];
        readFully(mask, 4);
        byte[] payload = new byte[(int) len];
        readFully(payload, (int) len);
        for (int i = 0; i < payload.length; i++)
            payload[i] ^= mask[i & 3];
        Frame f = new Frame();
        f.fin = fin;
        f.opcode = opcode;
        f.payload = payload;
        return f;
    }

    private int readByte() throws IOException {
        int c = in.read();
        if (c == -1)
            throw new IOException("unexpected EOF");
        return c;
    }

    private void readFully(byte[] buf, int n) throws IOException {
        int off = 0;
        while (off < n) {
            int r = in.read(buf, off, n - off);
            if (r == -1)
                throw new IOException("unexpected EOF");
            off += r;
        }
    }

    // ── Writer ────────────────────────────────────────────────────────

    private void writerLoop() {
        try {
            for (;;) {
                Object item = outbox.take();
                if (item instanceof Long && (Long) item == QUEUE_POISON)
                    break;
                if (item instanceof String)
                    writeTextFrame((String) item);
            }
        } catch (InterruptedException | IOException e) {
            // fall through to shutdown
        } finally {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private synchronized void writeTextFrame(String text) throws IOException {
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        writeFrameHeader(0x1, payload.length);
        out.write(payload);
        out.flush();
    }

    private synchronized void sendControl(int opcode, byte[] payload) throws IOException {
        writeFrameHeader(opcode, payload.length);
        out.write(payload);
        out.flush();
    }

    private void writeFrameHeader(int opcode, int len) throws IOException {
        out.write(0x80 | opcode); // FIN + opcode
        if (len < 126) {
            out.write(len);
        } else if (len < 65536) {
            out.write(126);
            out.write((len >>> 8) & 0xff);
            out.write(len & 0xff);
        } else {
            out.write(127);
            for (int i = 7; i >= 0; i--)
                out.write((int) (((long) len >>> (8 * i)) & 0xff));
        }
        // server frames are never masked
    }

    private void shutdown() {
        closed.set(true);
        outbox.offer(QUEUE_POISON);
        try { socket.close(); } catch (IOException ignored) {}
    }

    private static void writeHandshakeError(OutputStream out) {
        try {
            out.write(("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
                    .getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
        } catch (IOException ignored) {
        }
    }

    static String acceptKey(String key) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            byte[] digest = sha1.digest((key + GUID).getBytes(StandardCharsets.ISO_8859_1));
            return Base64.getEncoder().encodeToString(digest);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-1 unavailable", e);
        }
    }

    private static final class Frame {
        boolean fin;
        int opcode;
        byte[] payload;
    }
}
