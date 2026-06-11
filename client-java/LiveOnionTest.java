/*
 * LiveOnionTest.java — THE real end-to-end proof, over the actual Tor
 * network: boots the Java relay, publishes it as a v3 onion via the managed
 * tor process, then connects a client BACK through that tor's SOCKS port to
 * the .onion address — the request leaves the machine, routes through real
 * Tor circuits, and re-enters via the hidden service. A second client
 * connects directly; the two exchange an E2E-encrypted message across the
 * mixed transports.
 *
 * Needs internet + a tor binary; takes 1–5 minutes (bootstrap + descriptor
 * publication). Not part of the always-run suite — run it before shipping:
 *   javac -cp relay-java/out:seal-java/out -d client-java/out client-java/*.java
 *   java -cp relay-java/out:seal-java/out:client-java/out LiveOnionTest
 */
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class LiveOnionTest {
    static int passed = 0, failed = 0;
    static void check(boolean c, String name) {
        if (c) passed++; else { failed++; System.err.println("FAIL: " + name); }
    }
    static void log(String s) { System.out.println("[live] " + s); }

    private static final long BOOTSTRAP_TIMEOUT_MS = 180_000;
    private static final long REACHABILITY_DEADLINE_MS = 240_000;

    public static void main(String[] args) throws Exception {
        Path dataDir = Files.createTempDirectory("vc-live-onion");

        // ── Relay + tor hosting ────────────────────────────────────────
        Config cfg = Config.of(0, dataDir, List.of("*"), true);
        Store store = new Store(cfg.dbPath());
        store.open();
        Main.Relay relay = Main.start(cfg, store);
        log("relay on 127.0.0.1:" + relay.port());

        Tor tor = Tor.start(dataDir.resolve("tor"), relay.port(),
                (pct, summary) -> log("bootstrap " + pct + "% " + summary), 30_000, false);
        String onion = tor.onionHostname();
        log("onion: " + onion + "  socks: 127.0.0.1:" + tor.socksPort());

        try {
            check(tor.awaitBootstrapped(BOOTSTRAP_TIMEOUT_MS),
                "tor bootstraps to 100% on the live network");

            Transport viaTor = Transport.socks5("127.0.0.1", tor.socksPort());
            RelayHttpClient api = new RelayHttpClient("http://" + onion, viaTor);

            // Descriptor publication lags bootstrap; retry until reachable.
            log("waiting for hidden-service reachability (can take minutes)…");
            long deadline = System.currentTimeMillis() + REACHABILITY_DEADLINE_MS;
            java.util.Map<String, Object> community = null;
            Exception lastErr = null;
            while (System.currentTimeMillis() < deadline) {
                try {
                    community = api.createCommunity("Onion Live", null, null);
                    break;
                } catch (Exception e) {
                    lastErr = e;
                    log("not reachable yet (" + e.getMessage() + "), retrying…");
                    Thread.sleep(10_000);
                }
            }
            check(community != null, "HTTP request round-trips the real Tor network"
                    + (community == null ? " (last error: " + lastErr + ")" : ""));
            if (community == null) throw new IllegalStateException("onion never became reachable");

            String communityId = (String) community.get("id");
            var fetched = api.getCommunity(communityId, null);
            String channelId = (String) Json.asObj(Json.asArr(fetched.get("channels")).get(0)).get("id");
            log("community " + communityId + " created over Tor");

            // ── Onion-routed client + direct client exchange E2E msg ──
            VoidClient remote = new VoidClient("Remote");   // via real Tor
            remote.setTransport(viaTor);
            VoidClient host = new VoidClient("Host");       // direct loopback

            CountDownLatch remoteReady = new CountDownLatch(1);
            CountDownLatch hostReady = new CountDownLatch(1);
            CountDownLatch hostSawTwo = new CountDownLatch(1);
            CountDownLatch hostGotMsg = new CountDownLatch(1);
            CountDownLatch remoteGotDM = new CountDownLatch(1);
            var msgs = new CopyOnWriteArrayList<String[]>();
            var dms = new CopyOnWriteArrayList<Object[]>();

            remote.setListener(new VoidClient.Listener() {
                public void onReady() { remoteReady.countDown(); }
                public void onDM(String box, String name, String text, boolean ok, String msgId, long ts) {
                    dms.add(new Object[] { name, text, ok }); remoteGotDM.countDown();
                }
            });
            host.setListener(new VoidClient.Listener() {
                public void onReady() { hostReady.countDown(); }
                public void onRoster(String ch, List<String> names) {
                    if (names.size() == 2) hostSawTwo.countDown();
                }
                public void onChannelMessage(String ch, String name, String box, String text, String msgId, long ts) {
                    msgs.add(new String[] { name, text }); hostGotMsg.countDown();
                }
            });

            remote.connect("ws://" + onion + "/ws");
            host.connect("ws://127.0.0.1:" + relay.port() + "/ws");
            check(remoteReady.await(60, TimeUnit.SECONDS), "websocket announce over real Tor");
            check(hostReady.await(15, TimeUnit.SECONDS), "direct client announced");

            remote.join(channelId);
            host.join(channelId);
            check(hostSawTwo.await(60, TimeUnit.SECONDS), "roster reaches 2 across Tor + loopback");

            Thread.sleep(2_000); // let the Tor-side roster settle before sealing
            String secret = "spoken through the void, routed through the world 🧅";
            remote.sendToChannel(channelId, secret);
            check(hostGotMsg.await(60, TimeUnit.SECONDS), "E2E channel message arrives through real Tor");
            if (!msgs.isEmpty()) {
                check("Remote".equals(msgs.get(0)[0]) && secret.equals(msgs.get(0)[1]),
                    "sender + plaintext intact after the onion round-trip");
            }

            host.sendDM(remote.boxPubB58, "ack from the host side");
            check(remoteGotDM.await(60, TimeUnit.SECONDS), "DM arrives at the Tor-routed client");
            if (!dms.isEmpty())
                check(Boolean.TRUE.equals(dms.get(0)[2]), "DM signature verifies across transports");

            remote.close();
            host.close();
        } finally {
            tor.stop();
            relay.stop();
        }

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
