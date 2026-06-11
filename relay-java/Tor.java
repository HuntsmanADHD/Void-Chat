/*
 * Tor.java — managed tor process that publishes the relay as a v3 onion
 * hidden service (the Java counterpart of the Tauri tor sidecar). Pure
 * java.base: writes a torrc, spawns the system/bundled tor binary, parses
 * bootstrap progress from its log, and reads the generated .onion hostname.
 *
 * The onion identity (ed25519 keypair) lives in <stateDir>/onion/ — back up
 * that directory to keep the same address across machines; reusing the same
 * stateDir keeps it across restarts. Both it and DataDirectory are created
 * 0700 (tor refuses to run otherwise).
 *
 * The same tor instance also opens a local SOCKS5 port (socksPort()), which
 * client-java's Transport can use to dial *other* hosts' onions — one tor
 * process serves both directions, exactly like the Tauri bundle.
 */
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayDeque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class Tor {
    public interface Progress {
        void onBootstrap(int percent, String summary);
    }

    /** e.g. "Bootstrapped 75% (loading_descriptors): Loading relay descriptors" */
    private static final Pattern BOOTSTRAP_LINE =
            Pattern.compile("Bootstrapped (\\d+)%(?:\\s*\\([^)]*\\))?(?::\\s*(.*))?");
    private static final int LOG_TAIL_LINES = 120;
    private static final long HOSTNAME_POLL_MS = 100;

    private final Process process;
    private final int socksPort;
    private final CountDownLatch bootstrapped = new CountDownLatch(1);
    /**
     * Client-mode readiness: tor accepted the config and entered its main
     * loop — signalled by the SOCKS listener opening OR any "Bootstrapped"
     * line (the latter still appears under DisableNetwork, where no
     * listeners exist; a rejected config exits before either).
     */
    private final CountDownLatch clientReady = new CountDownLatch(1);
    private final ArrayDeque<String> logTail = new ArrayDeque<>();
    private volatile String onionHostname;

    private Tor(Process process, int socksPort) {
        this.process = process;
        this.socksPort = socksPort;
    }

    /**
     * Start tor publishing 127.0.0.1:relayPort as <onion>:80. Blocks until
     * the onion hostname exists (fast — tor writes it at config load, before
     * any network activity), throws on bad binary / bad config / timeout.
     * Reachability additionally needs awaitBootstrapped().
     *
     * relayPort == 0 means CLIENT-ONLY: no hidden service is published; the
     * instance just provides the local SOCKS port for dialing other onions.
     * In that mode readiness = the SOCKS listener being open, and
     * onionHostname() stays null.
     *
     * `disableNetwork` keeps tor fully offline (used by tests: the real
     * binary still validates the torrc and mints the onion identity).
     */
    public static Tor start(Path stateDir, int relayPort, Progress progress,
            long timeoutMs, boolean disableNetwork) throws IOException {
        String binary = System.getenv("VOIDCHAT_TOR_BINARY");
        if (binary == null || binary.isBlank()) binary = "tor";

        boolean hosting = relayPort != 0;
        Path dataDir = stateDir.resolve("tor-data");
        Path onionDir = stateDir.resolve("onion");
        createPrivateDir(stateDir);
        createPrivateDir(dataDir);
        if (hosting) createPrivateDir(onionDir);

        int socksPort = pickFreePort();
        Path torrc = stateDir.resolve("torrc");
        String conf = "DataDirectory " + dataDir.toAbsolutePath() + "\n"
                + "SocksPort 127.0.0.1:" + socksPort + "\n"
                + "ControlPort 0\n"
                + "SafeLogging 1\n"
                + (hosting
                        ? "HiddenServiceDir " + onionDir.toAbsolutePath() + "\n"
                        + "HiddenServicePort 80 127.0.0.1:" + relayPort + "\n"
                        : "")
                + (disableNetwork ? "DisableNetwork 1\n" : "")
                + "Log notice stdout\n";
        Files.writeString(torrc, conf);

        Process p;
        try {
            p = new ProcessBuilder(binary, "-f", torrc.toAbsolutePath().toString())
                    .redirectErrorStream(true)
                    .start();
        } catch (IOException e) {
            throw new IOException("could not launch tor binary '" + binary
                    + "' (set VOIDCHAT_TOR_BINARY): " + e.getMessage(), e);
        }

        Tor tor = new Tor(p, socksPort);
        Thread.ofVirtual().name("tor-log").start(() -> tor.logLoop(progress));

        // Readiness: hosting waits for the hostname file; client-only waits
        // for the SOCKS listener. Either way fail fast if tor dies.
        Path hostnameFile = onionDir.resolve("hostname");
        long deadline = System.currentTimeMillis() + timeoutMs;
        for (;;) {
            if (hosting) {
                if (Files.exists(hostnameFile)) {
                    String name = Files.readString(hostnameFile, StandardCharsets.US_ASCII).trim();
                    if (!name.isEmpty()) {
                        tor.onionHostname = name;
                        return tor;
                    }
                }
            } else if (tor.clientReady.getCount() == 0) {
                return tor;
            }
            if (!p.isAlive())
                throw new IOException("tor exited (code " + p.exitValue() + "):\n" + tor.tail());
            if (System.currentTimeMillis() > deadline) {
                tor.stop();
                throw new IOException("timed out waiting for tor readiness:\n" + tor.tail());
            }
            try {
                Thread.sleep(HOSTNAME_POLL_MS);
            } catch (InterruptedException e) {
                tor.stop();
                Thread.currentThread().interrupt();
                throw new IOException("interrupted while starting tor", e);
            }
        }
    }

    /** Convenience: online, 30 s hostname timeout. */
    public static Tor start(Path stateDir, int relayPort, Progress progress) throws IOException {
        return start(stateDir, relayPort, progress, 30_000, false);
    }

    /** Client-only tor: local SOCKS for dialing onions, no hidden service. */
    public static Tor startClient(Path stateDir, Progress progress,
            long timeoutMs, boolean disableNetwork) throws IOException {
        return start(stateDir, 0, progress, timeoutMs, disableNetwork);
    }

    /** The published v3 address, e.g. "abc…xyz.onion". */
    public String onionHostname() {
        return onionHostname;
    }

    /** Local SOCKS5 port of this tor — usable for dialing other onions. */
    public int socksPort() {
        return socksPort;
    }

    /** True once tor reports "Bootstrapped 100%" (needs real network). */
    public boolean awaitBootstrapped(long timeoutMs) throws InterruptedException {
        return bootstrapped.await(timeoutMs, TimeUnit.MILLISECONDS);
    }

    public boolean isAlive() {
        return process.isAlive();
    }

    public void stop() {
        process.destroy();
        try {
            if (!process.waitFor(5, TimeUnit.SECONDS))
                process.destroyForcibly();
        } catch (InterruptedException e) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
        }
    }

    // ── internals ─────────────────────────────────────────────────────

    private void logLoop(Progress progress) {
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                synchronized (logTail) {
                    logTail.addLast(line);
                    if (logTail.size() > LOG_TAIL_LINES) logTail.removeFirst();
                }
                if (line.contains("Opened Socks listener"))
                    clientReady.countDown();
                Matcher m = BOOTSTRAP_LINE.matcher(line);
                if (m.find()) {
                    clientReady.countDown();
                    int pct = Integer.parseInt(m.group(1));
                    if (progress != null)
                        progress.onBootstrap(pct, m.group(2) == null ? "" : m.group(2));
                    if (pct >= 100)
                        bootstrapped.countDown();
                }
            }
        } catch (IOException ignored) {
            // process ended
        }
    }

    private String tail() {
        synchronized (logTail) {
            return String.join("\n", logTail);
        }
    }

    private static void createPrivateDir(Path dir) throws IOException {
        Files.createDirectories(dir);
        try {
            Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------"));
        } catch (UnsupportedOperationException ignored) {
            // non-POSIX (Windows): tor relaxes the check there
        }
    }

    private static int pickFreePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            return s.getLocalPort();
        }
    }
}
