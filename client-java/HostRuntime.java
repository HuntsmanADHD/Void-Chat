/*
 * HostRuntime.java — one-call "host a community" session: boots the Java
 * relay (ephemeral loopback port) and a managed tor publishing it as a v3
 * onion. This is the headless engine under the GUI's Host toggle, kept
 * separate so it can be tested without Swing. Reusing the same baseDir
 * keeps the store AND the onion address across restarts; the onion identity
 * is <baseDir>/tor/onion/ (back it up to keep your address).
 *
 * The tor instance's SOCKS port is exposed so the same process can also
 * dial *other* hosts' onions — one tor, both directions.
 */
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

public final class HostRuntime {
    private final Main.Relay relay;
    private final Tor tor;
    private final String onion;

    private HostRuntime(Main.Relay relay, Tor tor, String onion) {
        this.relay = relay;
        this.tor = tor;
        this.onion = onion;
    }

    /**
     * Boot store + relay + tor. Blocks until the relay is listening and the
     * onion identity exists; reachability needs awaitBootstrapped(). Pass
     * disableNetwork=true only in tests.
     */
    public static HostRuntime start(Path baseDir, Tor.Progress progress,
            boolean disableNetwork) throws Exception {
        Config cfg = Config.of(0, baseDir.resolve("data"), List.of("*"), true);
        java.nio.file.Files.createDirectories(cfg.dataDir);
        Store store = new Store(cfg.dbPath());
        store.open();
        Main.Relay relay = Main.start(cfg, store);
        Tor tor;
        try {
            tor = Tor.start(baseDir.resolve("tor"), relay.port(), progress, 30_000, disableNetwork);
        } catch (IOException e) {
            relay.stop();
            throw e;
        }
        return new HostRuntime(relay, tor, tor.onionHostname());
    }

    /** The published v3 address, e.g. "abc…xyz.onion". */
    public String onion() {
        return onion;
    }

    /** The invite to share: the onion as an http URL (HS maps port 80). */
    public String inviteUrl() {
        return "http://" + onion;
    }

    /** Loopback port of the local relay (the host's own client connects here). */
    public int relayPort() {
        return relay.port();
    }

    /** Local SOCKS port of the managed tor — for dialing other onions. */
    public int socksPort() {
        return tor.socksPort();
    }

    /** True once tor reports Bootstrapped 100% (the onion is then reachable). */
    public boolean awaitBootstrapped(long timeoutMs) throws InterruptedException {
        return tor.awaitBootstrapped(timeoutMs);
    }

    public boolean isAlive() {
        return tor.isAlive();
    }

    public void stop() {
        tor.stop();
        relay.stop();
    }
}
