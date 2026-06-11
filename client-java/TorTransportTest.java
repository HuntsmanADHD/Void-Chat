/*
 * TorTransportTest.java — proves the SOCKS5/Tor client transport without
 * needing Tor: boots the real relay, runs a minimal in-process SOCKS5 server
 * (the same protocol surface Tor exposes), and drives the full client flow —
 * HTTP CRUD, websocket announce, join, E2E channel message — through it
 * using a FAKE .onion hostname that only the SOCKS server can "resolve"
 * (it maps it to the local relay). That makes local DNS resolution
 * impossible: if the client ever resolved the name itself instead of
 * sending domain-ATYP to the proxy, every step would fail.
 *
 * Run (from project root):
 *   javac -cp relay-java/out:seal-java/out -d client-java/out client-java/*.java
 *   java -cp relay-java/out:seal-java/out:client-java/out TorTransportTest
 */
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class TorTransportTest {
    static int passed = 0, failed = 0;
    static void check(boolean c, String name) {
        if (c) passed++; else { failed++; System.err.println("FAIL: " + name); }
    }

    static final String FAKE_ONION = "vcjavatestvcjavatestvcjavatestvcjavatestvcjavatestvcjava.onion";

    public static void main(String[] args) throws Exception {
        // Real relay on an ephemeral port + temp data dir.
        Path dataDir = Files.createTempDirectory("vc-tor-transport");
        Config cfg = Config.of(0, dataDir, List.of("*"), true);
        Store store = new Store(cfg.dbPath());
        store.open();
        Main.Relay relay = Main.start(cfg, store);
        int relayPort = relay.port();

        // Mini SOCKS5 server: resolves FAKE_ONION → the local relay.
        MiniSocks5 socks = new MiniSocks5(FAKE_ONION, "127.0.0.1", relayPort);
        socks.start();

        try {
            Transport tor = Transport.socks5("127.0.0.1", socks.port());

            // ── HTTP CRUD through SOCKS to the .onion name ────────────
            RelayHttpClient api = new RelayHttpClient("http://" + FAKE_ONION + ":" + relayPort, tor);
            var community = api.createCommunity("Onion Friends", null, null);
            check(community.get("id") != null, "HTTP create community through SOCKS5 + .onion name");
            String communityId = (String) community.get("id");
            var fetched = api.getCommunity(communityId, null);
            List<Object> channels = Json.asArr(fetched.get("channels"));
            check(channels != null && !channels.isEmpty(), "HTTP fetch community through SOCKS5");
            String channelId = (String) Json.asObj(channels.get(0)).get("id");

            // The proxy must have received the DOMAIN, not an IP — proves
            // domain-ATYP addressing / no local resolution.
            check(socks.sawHosts.contains(FAKE_ONION), "SOCKS server received the .onion hostname verbatim");
            check(socks.sawHosts.stream().noneMatch(h -> h.equals("127.0.0.1")),
                "client never pre-resolved the name to an IP");

            // ── WebSocket flow through SOCKS: announce, join, message ──
            VoidClient onionClient = new VoidClient("Toriel");
            onionClient.setTransport(tor);
            VoidClient localClient = new VoidClient("Locke"); // direct path, same relay

            CountDownLatch onionReady = new CountDownLatch(1);
            CountDownLatch localReady = new CountDownLatch(1);
            CountDownLatch localSawTwo = new CountDownLatch(1);
            CountDownLatch localGotMsg = new CountDownLatch(1);
            var got = new CopyOnWriteArrayList<String[]>();

            onionClient.setListener(new VoidClient.Listener() {
                public void onReady() { onionReady.countDown(); }
            });
            localClient.setListener(new VoidClient.Listener() {
                public void onReady() { localReady.countDown(); }
                public void onRoster(String ch, List<String> names) {
                    if (names.size() == 2) localSawTwo.countDown();
                }
                public void onChannelMessage(String ch, String name, String box, String text, String msgId, long ts) {
                    got.add(new String[] { name, text });
                    localGotMsg.countDown();
                }
            });

            onionClient.connect("ws://" + FAKE_ONION + ":" + relayPort + "/ws");
            localClient.connect("ws://127.0.0.1:" + relayPort + "/ws");
            check(onionReady.await(15, TimeUnit.SECONDS), "onion-routed client announced (signed handshake over SOCKS5)");
            check(localReady.await(15, TimeUnit.SECONDS), "direct client announced");

            onionClient.join(channelId);
            localClient.join(channelId);
            check(localSawTwo.await(15, TimeUnit.SECONDS), "roster reaches 2 across mixed transports");

            Thread.sleep(200); // settle: onion client's roster includes the local one
            String secret = "routed through the onion 🧅";
            onionClient.sendToChannel(channelId, secret);
            check(localGotMsg.await(15, TimeUnit.SECONDS), "E2E message crosses SOCKS5 → relay → direct client");
            if (!got.isEmpty()) {
                check("Toriel".equals(got.get(0)[0]), "sender name survives the onion route");
                check(secret.equals(got.get(0)[1]), "plaintext decrypts exactly");
            }

            // ── Failure honesty: connect via a dead proxy must throw ──
            VoidClient deadProxy = new VoidClient("Nobody");
            deadProxy.setTransport(Transport.socks5("127.0.0.1", 1)); // nothing listens
            boolean threw = false;
            try { deadProxy.connect("ws://" + FAKE_ONION + ":" + relayPort + "/ws"); }
            catch (Exception e) { threw = true; }
            check(threw, "unreachable SOCKS proxy fails loudly, not silently");
            deadProxy.close();

            onionClient.close();
            localClient.close();
        } finally {
            socks.stop();
            relay.stop();
        }

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }

    /**
     * Minimal SOCKS5 server (RFC 1928): no-auth, CONNECT, domain ATYP only —
     * exactly the surface Tor exposes to clients. Maps one hostname to a
     * fixed target; anything else is refused (rep 0x04, host unreachable).
     */
    static final class MiniSocks5 {
        final List<String> sawHosts = new CopyOnWriteArrayList<>();
        private final String onionName, targetHost;
        private final int targetPort;
        private ServerSocket server;

        MiniSocks5(String onionName, String targetHost, int targetPort) {
            this.onionName = onionName;
            this.targetHost = targetHost;
            this.targetPort = targetPort;
        }

        void start() throws IOException {
            server = new ServerSocket(0, 16, java.net.InetAddress.getLoopbackAddress());
            Thread.ofVirtual().name("mini-socks-accept").start(() -> {
                try {
                    for (;;) {
                        Socket conn = server.accept();
                        Thread.ofVirtual().start(() -> serve(conn));
                    }
                } catch (IOException e) { /* server closed */ }
            });
        }

        int port() { return server.getLocalPort(); }

        void stop() {
            try { server.close(); } catch (IOException ignored) {}
        }

        private void serve(Socket conn) {
            try {
                InputStream in = conn.getInputStream();
                OutputStream out = conn.getOutputStream();
                // greeting
                int ver = in.read();
                int nMethods = in.read();
                for (int i = 0; i < nMethods; i++) in.read();
                if (ver != 5) { conn.close(); return; }
                out.write(new byte[] { 5, 0 }); // no-auth
                out.flush();
                // request
                in.read(); // ver
                int cmd = in.read();
                in.read(); // rsv
                int atyp = in.read();
                if (cmd != 1 || atyp != 3) { // CONNECT + domain only, like Tor
                    out.write(new byte[] { 5, 7, 0, 1, 0, 0, 0, 0, 0, 0 });
                    conn.close();
                    return;
                }
                int len = in.read();
                byte[] name = new byte[len];
                for (int i = 0; i < len; i++) name[i] = (byte) in.read();
                in.read(); in.read(); // port (we route by name)
                String host = new String(name, StandardCharsets.US_ASCII);
                sawHosts.add(host);
                if (!host.equals(onionName)) {
                    out.write(new byte[] { 5, 4, 0, 1, 0, 0, 0, 0, 0, 0 });
                    conn.close();
                    return;
                }
                Socket upstream = new Socket(targetHost, targetPort);
                out.write(new byte[] { 5, 0, 0, 1, 0, 0, 0, 0, 0, 0 });
                out.flush();
                // pump bytes both ways until either side closes
                Thread t = Thread.ofVirtual().start(() -> pump(upstream, conn));
                pump(conn, upstream);
                t.join();
            } catch (IOException | InterruptedException e) {
                try { conn.close(); } catch (IOException ignored) {}
            }
        }

        private static void pump(Socket from, Socket to) {
            try {
                byte[] buf = new byte[8192];
                InputStream in = from.getInputStream();
                OutputStream out = to.getOutputStream();
                int r;
                while ((r = in.read(buf)) != -1) {
                    out.write(buf, 0, r);
                    out.flush();
                }
            } catch (IOException ignored) {
            } finally {
                try { from.close(); } catch (IOException ignored) {}
                try { to.close(); } catch (IOException ignored) {}
            }
        }
    }
}
