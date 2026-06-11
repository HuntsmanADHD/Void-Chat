/*
 * Transport.java — opens client TCP connections either directly or through a
 * SOCKS5 proxy (Tor). Hand-rolled SOCKS5 client (RFC 1928): no-auth, CONNECT
 * only, and ALWAYS domain addressing (ATYP 0x03) — the hostname is sent to
 * the proxy verbatim and never resolved locally. That is mandatory for
 * .onion addresses (they don't exist in DNS) and prevents DNS leaks for
 * everything else. Pure java.base.
 */
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public final class Transport {
    public static final Transport DIRECT = new Transport(null, 0);

    private static final int CONNECT_TIMEOUT_MS = 20_000;

    private final String socksHost;
    private final int socksPort;

    private Transport(String socksHost, int socksPort) {
        this.socksHost = socksHost;
        this.socksPort = socksPort;
    }

    /** Route all connections through a SOCKS5 proxy (e.g. Tor on 127.0.0.1:9050). */
    public static Transport socks5(String host, int port) {
        return new Transport(host, port);
    }

    /** Parse a "host:port" spec (e.g. $VOIDCHAT_SOCKS); null/blank → DIRECT. */
    public static Transport fromSpec(String spec) {
        if (spec == null || spec.isBlank()) return DIRECT;
        int colon = spec.lastIndexOf(':');
        if (colon <= 0) throw new IllegalArgumentException("SOCKS spec must be host:port, got: " + spec);
        return socks5(spec.substring(0, colon), Integer.parseInt(spec.substring(colon + 1)));
    }

    public boolean isProxied() {
        return socksHost != null;
    }

    /**
     * Open a TCP connection to host:port — directly, or via SOCKS5 CONNECT
     * when proxied. `host` may be a name the proxy resolves (an .onion).
     */
    public Socket open(String host, int port) throws IOException {
        Socket s = new Socket();
        s.setTcpNoDelay(true);
        if (socksHost == null) {
            s.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            return s;
        }
        try {
            s.connect(new InetSocketAddress(socksHost, socksPort), CONNECT_TIMEOUT_MS);
            socks5Connect(s, host, port);
            return s;
        } catch (IOException e) {
            try { s.close(); } catch (IOException ignored) {}
            throw e;
        }
    }

    private static void socks5Connect(Socket s, String host, int port) throws IOException {
        InputStream in = s.getInputStream();
        OutputStream out = s.getOutputStream();

        // Greeting: version 5, one auth method offered, 0x00 = no auth.
        out.write(new byte[] { 5, 1, 0 });
        out.flush();
        int ver = readByte(in);
        int method = readByte(in);
        if (ver != 5 || method != 0)
            throw new IOException("SOCKS5 greeting refused (ver=" + ver + " method=" + method + ")");

        // Request: CONNECT with domain addressing — never resolve locally.
        byte[] name = host.getBytes(StandardCharsets.US_ASCII);
        if (name.length < 1 || name.length > 255)
            throw new IOException("SOCKS5 hostname length out of range: " + name.length);
        out.write(new byte[] { 5, 1, 0, 3, (byte) name.length });
        out.write(name);
        out.write((port >>> 8) & 0xff);
        out.write(port & 0xff);
        out.flush();

        int rver = readByte(in);
        int rep = readByte(in);
        readByte(in); // RSV
        if (rver != 5 || rep != 0)
            throw new IOException("SOCKS5 connect failed (rep=" + rep + ")");
        // Skip the bound address (variable per ATYP) + 2-byte port.
        int atyp = readByte(in);
        int addrLen = switch (atyp) {
            case 1 -> 4;               // IPv4
            case 3 -> readByte(in);    // domain: length-prefixed
            case 4 -> 16;              // IPv6
            default -> throw new IOException("SOCKS5 bad reply atyp " + atyp);
        };
        for (int i = 0; i < addrLen + 2; i++) readByte(in);
    }

    private static int readByte(InputStream in) throws IOException {
        int b = in.read();
        if (b == -1) throw new IOException("SOCKS5 unexpected EOF");
        return b;
    }

    @Override public String toString() {
        return socksHost == null ? "direct" : "socks5://" + socksHost + ":" + socksPort;
    }
}
