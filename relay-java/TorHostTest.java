/*
 * TorHostTest.java — exercises the managed tor process OFFLINE against the
 * real tor binary: `DisableNetwork 1` makes tor validate our torrc, create
 * the hidden-service directory, and mint a genuine v3 onion identity without
 * touching the network. What this can't prove (needs a live two-machine run):
 * actual reachability of the onion, i.e. awaitBootstrapped(=100%).
 *
 * Run (from project root):
 *   javac -d relay-java/out relay-java/*.java
 *   java -cp relay-java/out TorHostTest
 */
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;

public final class TorHostTest {
    static int passed = 0, failed = 0;
    static void check(boolean c, String name) {
        if (c) passed++; else { failed++; System.err.println("FAIL: " + name); }
    }

    public static void main(String[] args) throws Exception {
        Path stateDir = Files.createTempDirectory("vc-tor-host");

        // ── Start: real binary, offline ────────────────────────────────
        AtomicInteger lastPct = new AtomicInteger(-1);
        Tor tor = Tor.start(stateDir, 3001,
                (pct, summary) -> lastPct.set(pct), 30_000, true);

        String onion = tor.onionHostname();
        check(onion != null && onion.matches("[a-z2-7]{56}\\.onion"),
            "tor mints a well-formed v3 onion address: " + onion);
        check(tor.isAlive(), "tor process is running");
        check(tor.socksPort() > 0, "a local SOCKS port was allocated");

        // torrc the real parser accepted; key material is on disk, private.
        check(Files.exists(stateDir.resolve("torrc")), "torrc written");
        check(Files.exists(stateDir.resolve("onion").resolve("hs_ed25519_secret_key")),
            "onion ed25519 secret key exists");
        String perms = java.nio.file.attribute.PosixFilePermissions.toString(
                Files.getPosixFilePermissions(stateDir.resolve("onion")));
        check("rwx------".equals(perms), "hidden-service dir is 0700, got " + perms);

        // Offline ⇒ bootstrap can never hit 100%; await must time out false.
        check(!tor.awaitBootstrapped(1_500), "awaitBootstrapped times out offline (no false ready)");

        // ── Stop ───────────────────────────────────────────────────────
        tor.stop();
        check(!tor.isAlive(), "stop() terminates the tor process");

        // ── Identity persistence: same stateDir → same onion ──────────
        Tor tor2 = Tor.start(stateDir, 3001, null, 30_000, true);
        check(onion.equals(tor2.onionHostname()),
            "restart with same stateDir keeps the same onion address");
        tor2.stop();

        // ── Fresh stateDir → different onion (no accidental key reuse) ─
        Path stateDir3 = Files.createTempDirectory("vc-tor-host-fresh");
        Tor tor3 = Tor.start(stateDir3, 3001, null, 30_000, true);
        check(!onion.equals(tor3.onionHostname()),
            "fresh stateDir mints a different onion identity");
        tor3.stop();

        // ── Failure honesty: tor rejecting the config must throw fast ──
        // HiddenServicePort forwarding to port 0 fails tor's config parse,
        // so the process exits before writing a hostname.
        Path stateDir4 = Files.createTempDirectory("vc-tor-host-bad");
        boolean threwOnBadConfig = false;
        try {
            Tor.start(stateDir4, 0, null, 15_000, true);
        } catch (Exception e) {
            threwOnBadConfig = true;
        }
        check(threwOnBadConfig, "tor failing at config load surfaces as an exception, not a hang");

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
