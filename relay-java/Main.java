/*
 * Main.java — Void Chat relay entry point. Pure Java, java.base only.
 * Binds 127.0.0.1 (loopback) — the relay is only ever reached via the local
 * Tauri renderer or the local onion proxy forwarding through Tor.
 */
import java.nio.file.Path;

public final class Main {
    private static final int MAX_BODY_BYTES = 512 * 1024; // matches http.rs

    public static void main(String[] args) throws Exception {
        Config cfg = Config.fromEnv();
        Log.info("starting voidchat-relay (java) port=" + cfg.port
                + " data_dir=" + cfg.dataDir + " cors=" + cfg.corsOrigins
                + (cfg.corsAllowAny ? " (allow-any)" : ""));

        Store store = new Store(cfg.dbPath());
        store.open();
        Log.info("store ready: " + cfg.dbPath());

        Relay relay = start(cfg, store);
        Log.info("listening on 127.0.0.1:" + relay.port());

        // VOIDCHAT_TOR=1 publishes the relay as a v3 onion hidden service via
        // a managed tor process (binary from PATH or VOIDCHAT_TOR_BINARY).
        Tor tor = null;
        if ("1".equals(System.getenv("VOIDCHAT_TOR"))) {
            tor = Tor.start(cfg.dataDir.resolve("tor"), relay.port(),
                    (pct, summary) -> Log.info("tor bootstrap " + pct + "% " + summary));
            Log.info("onion address: http://" + tor.onionHostname()
                    + "  (socks for outbound dials: 127.0.0.1:" + tor.socksPort() + ")");
        }

        final Tor torRef = tor;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            Log.info("shutting down");
            if (torRef != null) torRef.stop();
            relay.stop();
        }));

        // Park the main thread; the accept loop runs on its own virtual thread.
        Thread.currentThread().join();
    }

    /** Boots the HTTP + realtime stack. Returned handle exposes the bound port. */
    public static Relay start(Config cfg, Store store) throws Exception {
        HttpServer server = new HttpServer(cfg.port, MAX_BODY_BYTES);
        new Api(store, cfg).mount(server);

        Realtime realtime = new Realtime();
        server.websocket("/ws", (socket, req, in, out) ->
                WebSocket.accept(socket, req, in, out, realtime));

        server.start();
        return new Relay(server);
    }

    /** Lifecycle handle so tests can boot on an ephemeral port and stop cleanly. */
    public static final class Relay {
        private final HttpServer server;
        Relay(HttpServer server) { this.server = server; }
        public int port() { return server.boundPort(); }
        public void stop() { server.stop(); }
    }
}
