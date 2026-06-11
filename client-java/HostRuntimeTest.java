/*
 * HostRuntimeTest.java — proves the GUI's Host toggle engine offline:
 * HostRuntime boots store + relay + real tor (DisableNetwork), mints the
 * onion, serves the HTTP API locally, and keeps both the onion identity and
 * the community store across a restart of the same baseDir.
 *
 * Run (from project root):
 *   javac -cp relay-java/out:seal-java/out -d client-java/out client-java/*.java
 *   java -cp relay-java/out:seal-java/out:client-java/out HostRuntimeTest
 */
import java.nio.file.Files;
import java.nio.file.Path;

public final class HostRuntimeTest {
    static int passed = 0, failed = 0;
    static void check(boolean c, String name) {
        if (c) passed++; else { failed++; System.err.println("FAIL: " + name); }
    }

    public static void main(String[] args) throws Exception {
        Path baseDir = Files.createTempDirectory("vc-host-runtime");

        // ── First boot ─────────────────────────────────────────────────
        HostRuntime h = HostRuntime.start(baseDir, null, true);
        String onion = h.onion();
        check(onion != null && onion.matches("[a-z2-7]{56}\\.onion"),
            "host mints a v3 onion: " + onion);
        check(h.inviteUrl().equals("http://" + onion), "invite URL is the onion");
        check(h.relayPort() > 0, "relay listening on a loopback port");
        check(h.socksPort() > 0, "tor SOCKS port allocated");
        check(h.isAlive(), "tor process alive");

        // The local relay actually serves the API (the host's own client path).
        RelayHttpClient api = new RelayHttpClient("http://127.0.0.1:" + h.relayPort());
        var community = api.createCommunity("Host Test", null, null);
        check(community.get("id") != null, "local HTTP API works while hosting");
        String communityId = (String) community.get("id");

        h.stop();
        check(!h.isAlive(), "stop() tears down tor");

        // ── Restart same baseDir: same onion, same store ───────────────
        HostRuntime h2 = HostRuntime.start(baseDir, null, true);
        check(onion.equals(h2.onion()), "restart keeps the onion address");
        RelayHttpClient api2 = new RelayHttpClient("http://127.0.0.1:" + h2.relayPort());
        var fetched = api2.getCommunity(communityId, null);
        check(communityId.equals(fetched.get("id")), "restart keeps the community store");
        h2.stop();

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
