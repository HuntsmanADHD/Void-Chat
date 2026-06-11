/*
 * ClientE2ETest.java — end-to-end proof of the whole Java stack: boots the
 * Java relay in-process, connects two VoidClients, and has them exchange an
 * end-to-end encrypted channel message and a DM through the real relay.
 * Exercises relay + Box(X25519/XChaCha20-Poly1305) + Ed25519 signing + the
 * client's verification policy together.
 *
 * Run (from project root):
 *   javac -cp relay-java/out:seal-java/out -d client-java/out client-java/*.java
 *   java -cp relay-java/out:seal-java/out:client-java/out ClientE2ETest
 */
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class ClientE2ETest {
    static int passed = 0, failed = 0;
    static void check(boolean c, String name) {
        if (c) passed++; else { failed++; System.err.println("FAIL: " + name); }
    }

    public static void main(String[] args) throws Exception {
        // Boot the real relay on an ephemeral port + temp data dir.
        Path dataDir = Files.createTempDirectory("vc-client-e2e");
        Config cfg = Config.of(0, dataDir, List.of("*"), true);
        Store store = new Store(cfg.dbPath());
        store.open();
        Main.Relay relay = Main.start(cfg, store);
        int port = relay.port();
        String wsUri = "ws://127.0.0.1:" + port + "/ws";
        String httpBase = "http://127.0.0.1:" + port;

        try {
            // ── HTTP CRUD works from the Java client ──────────────────
            RelayHttpClient api = new RelayHttpClient(httpBase);
            var community = api.createCommunity("Java Friends", "the migration crew", null);
            check(community.get("id") != null, "client creates community over HTTP");
            String communityId = (String) community.get("id");
            var fetched = api.getCommunity(communityId, null);
            List<Object> channels = Json.asArr(fetched.get("channels"));
            check(channels != null && !channels.isEmpty(), "community has a default channel");
            String channelId = (String) Json.asObj(channels.get(0)).get("id");

            // ── Two clients connect + announce ────────────────────────
            VoidClient alice = new VoidClient("Alice");
            VoidClient bob = new VoidClient("Bob");

            CountDownLatch aliceReady = new CountDownLatch(1);
            CountDownLatch bobReady = new CountDownLatch(1);

            // Collectors for assertions.
            var bobChannelMsgs = new CopyOnWriteArrayList<String[]>(); // [senderName, text]
            var aliceDMs = new CopyOnWriteArrayList<Object[]>();       // [senderName, text, sigValid]
            AtomicReference<Integer> bobRosterSize = new AtomicReference<>(0);
            CountDownLatch bobSawTwo = new CountDownLatch(1);
            CountDownLatch bobGotMsg = new CountDownLatch(1);
            CountDownLatch aliceGotDM = new CountDownLatch(1);

            alice.setListener(new VoidClient.Listener() {
                public void onReady() { aliceReady.countDown(); }
                public void onDM(String box, String name, String text, boolean ok, String msgId, long ts) {
                    aliceDMs.add(new Object[] { name, text, ok }); aliceGotDM.countDown();
                }
            });
            bob.setListener(new VoidClient.Listener() {
                public void onReady() { bobReady.countDown(); }
                public void onRoster(String ch, List<String> names) {
                    bobRosterSize.set(names.size());
                    if (names.size() == 2) bobSawTwo.countDown();
                }
                public void onChannelMessage(String ch, String name, String box, String text, String msgId, long ts) {
                    bobChannelMsgs.add(new String[] { name, text }); bobGotMsg.countDown();
                }
            });

            alice.connect(wsUri);
            bob.connect(wsUri);
            check(aliceReady.await(15, TimeUnit.SECONDS), "alice announced");
            check(bobReady.await(15, TimeUnit.SECONDS), "bob announced");

            // ── Both join the channel; bob's roster should reach 2 ────
            alice.join(channelId);
            bob.join(channelId);
            check(bobSawTwo.await(15, TimeUnit.SECONDS),
                "bob's verified roster reaches 2 members (join sigs checked)");

            // ── Alice sends an encrypted channel message → Bob decrypts ─
            String secret = "meet at the onion at 0900 🧅";
            // small settle so alice's roster includes bob before sending
            Thread.sleep(200);
            alice.sendToChannel(channelId, secret);
            check(bobGotMsg.await(15, TimeUnit.SECONDS), "bob receives the channel message");
            if (!bobChannelMsgs.isEmpty()) {
                String[] m = bobChannelMsgs.get(0);
                check("Alice".equals(m[0]), "channel msg sender name is Alice");
                check(secret.equals(m[1]), "channel msg decrypts to the exact plaintext");
            }

            // ── Bob DMs Alice → Alice decrypts + sig verifies ─────────
            String dm = "got it. see you there. 👍";
            bob.sendDM(alice.boxPubB58, dm);
            check(aliceGotDM.await(15, TimeUnit.SECONDS), "alice receives the DM");
            if (!aliceDMs.isEmpty()) {
                Object[] m = aliceDMs.get(0);
                check(dm.equals(m[1]), "DM decrypts to the exact plaintext");
                check(Boolean.TRUE.equals(m[2]),
                    "DM sender signature verifies + binds to the roster-learned identity");
            }

            alice.close();
            bob.close();
        } finally {
            relay.stop();
        }

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
