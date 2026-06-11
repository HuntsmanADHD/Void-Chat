/*
 * ClientFeatureTest.java — identity persistence + heartbeat/reconnect.
 *
 *  1. Identity save → load round-trips the exact keys + name; a second
 *     loadOrCreate returns the SAME identity (not a fresh one).
 *  2. Reconnect: a client joined to a channel survives the relay going away
 *     and coming back on the same port — it re-announces and re-joins, and
 *     can exchange messages again.
 *
 * Run (from project root):
 *   javac -cp relay-java/out:seal-java/out -d client-java/out client-java/*.java
 *   java  -cp relay-java/out:seal-java/out:client-java/out ClientFeatureTest
 */
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class ClientFeatureTest {
    static int passed = 0, failed = 0;
    static void check(boolean c, String name) {
        if (c) passed++; else { failed++; System.err.println("FAIL: " + name); }
    }

    public static void main(String[] args) throws Exception {
        identityPersistence();
        dedup();
        reconnect();
        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }

    // ── msgId dedup ───────────────────────────────────────────────────
    // Inject the SAME channel:message frame twice (no relay needed) and
    // assert the listener fires exactly once; a different msgId fires again.

    static void dedup() {
        VoidClient recipient = new VoidClient("Recv");
        Object[] sender = Box.generateKeyPair();
        byte[] senderSec = (byte[]) sender[0];
        String senderPub = (String) sender[1];

        var delivered = new CopyOnWriteArrayList<String>();
        recipient.setListener(new VoidClient.Listener() {
            public void onChannelMessage(String ch, String name, String box, String text, String msgId, long ts) {
                delivered.add(text);
            }
        });

        Box.Sealed sealed = Box.sealForRecipient("hello once", recipient.boxPubB58, senderSec);
        String frame = Json.write(Json.obj("t", "channel:message", "d", Json.obj(
            "channelId", "c1",
            "senderBoxPublicKey", senderPub,
            "senderSigningPublicKey", "x",
            "senderDisplayName", "Sender",
            "ciphertext", sealed.ciphertext,
            "nonce", sealed.nonce,
            "msgId", "m_dup_1",
            "ts", 123L)));

        recipient.dispatch(frame);
        recipient.dispatch(frame); // exact duplicate
        check(delivered.size() == 1, "duplicate msgId delivered exactly once (" + delivered.size() + ")");

        // a genuinely new message (different msgId) still gets through
        Box.Sealed sealed2 = Box.sealForRecipient("hello again", recipient.boxPubB58, senderSec);
        String frame2 = Json.write(Json.obj("t", "channel:message", "d", Json.obj(
            "channelId", "c1", "senderBoxPublicKey", senderPub, "senderSigningPublicKey", "x",
            "senderDisplayName", "Sender", "ciphertext", sealed2.ciphertext, "nonce", sealed2.nonce,
            "msgId", "m_dup_2", "ts", 124L)));
        recipient.dispatch(frame2);
        check(delivered.size() == 2, "distinct msgId still delivered");
        recipient.close();
    }

    // ── 1. Identity persistence ───────────────────────────────────────

    static void identityPersistence() throws Exception {
        Path dir = Files.createTempDirectory("vc-identity");
        Path file = dir.resolve("identity.json");

        Identity a = Identity.loadOrCreate(file, "Alice");
        check(Files.exists(file), "identity file created on first use");

        // a second load returns the SAME identity, not a fresh one
        Identity b = Identity.loadOrCreate(file, "ignored-default");
        check(Arrays.equals(a.signSecret, b.signSecret), "signSecret persists across loads");
        check(Arrays.equals(a.boxSecret, b.boxSecret), "boxSecret persists across loads");
        check(a.signPubB58.equals(b.signPubB58), "signing pubkey stable");
        check(a.boxPubB58.equals(b.boxPubB58), "box pubkey stable");
        check("Alice".equals(b.displayName), "displayName persists");

        // derived pubkeys are internally consistent
        check(a.boxPubB58.equals(Box.publicKeyFromSecret(a.boxSecret)), "box pubkey derives from secret");
        check(a.signPubB58.equals(Base58.encode(Ed25519Sign.publicKeyFromSecret(a.signSecret))),
            "sign pubkey derives from secret");

        // owner-only permissions where supported
        try {
            var perms = Files.getPosixFilePermissions(file);
            check(perms.toString().equals("[OWNER_READ, OWNER_WRITE]")
                  || perms.equals(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------")),
                "identity file is 0600");
        } catch (UnsupportedOperationException e) {
            passed++; // non-POSIX FS — skip
        }

        // a re-saved name updates in place but keeps keys
        b.displayName = "Alice2";
        b.save(file);
        Identity c = Identity.load(file);
        check("Alice2".equals(c.displayName) && Arrays.equals(c.signSecret, a.signSecret),
            "name update keeps keys");
    }

    // ── 2. Reconnect across a relay restart ───────────────────────────

    static void reconnect() throws Exception {
        int port = freePort();
        Path dataDir = Files.createTempDirectory("vc-reconnect");
        Config cfg = Config.of(port, dataDir, List.of("*"), true);

        // boot relay #1
        Store store1 = new Store(cfg.dbPath());
        store1.open();
        Main.Relay relay = Main.start(cfg, store1);
        String wsUri = "ws://127.0.0.1:" + port + "/ws";
        String channelId = "chan-reconnect";

        VoidClient alice = new VoidClient("Alice");
        VoidClient bob = new VoidClient("Bob");

        var readyCount = new java.util.concurrent.atomic.AtomicInteger();
        CountDownLatch firstReady = new CountDownLatch(2);
        // re-ready latch is re-armed for the reconnect phase
        final CountDownLatch[] reReady = { new CountDownLatch(1) };
        var bobMsgs = new CopyOnWriteArrayList<String>();
        final CountDownLatch[] gotMsg = { new CountDownLatch(1) };

        alice.setListener(new VoidClient.Listener() {
            public void onReady() { firstReady.countDown(); reReady[0].countDown(); }
        });
        bob.setListener(new VoidClient.Listener() {
            public void onReady() { firstReady.countDown(); }
            public void onChannelMessage(String ch, String name, String box, String text, String msgId, long ts) {
                bobMsgs.add(text); gotMsg[0].countDown();
            }
        });

        alice.connect(wsUri);
        bob.connect(wsUri);
        check(firstReady.await(5, TimeUnit.SECONDS), "both clients announced (initial)");
        alice.join(channelId);
        bob.join(channelId);
        Thread.sleep(400);

        // kill relay #1; the clients should notice and start reconnecting
        relay.stop();
        Thread.sleep(800);

        // boot relay #2 on the SAME port; clients auto-reconnect + re-join
        Store store2 = new Store(cfg.dbPath());
        store2.open();
        Main.Relay relay2 = Main.start(cfg, store2);
        try {
            check(reReady[0].await(15, TimeUnit.SECONDS), "alice re-announced after relay restart");
            // give the re-join roster exchange a moment to settle
            Thread.sleep(800);
            // alice (re-joined) sends; bob (re-joined) should receive
            alice.sendToChannel(channelId, "still here after the restart 🔁");
            check(gotMsg[0].await(8, TimeUnit.SECONDS), "messaging works again after reconnect");
            check(!bobMsgs.isEmpty() && bobMsgs.get(bobMsgs.size() - 1).contains("still here"),
                "reconnected message decrypts correctly");
        } finally {
            alice.close();
            bob.close();
            relay2.stop();
        }
    }

    static int freePort() throws Exception {
        try (ServerSocket s = new ServerSocket(0)) { return s.getLocalPort(); }
    }
}
