/*
 * Config.java — runtime configuration from environment variables, matching
 * config.rs so the same dev/prod workflows keep working.
 */
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public final class Config {
    public static final int DEFAULT_PORT = 3001;
    private static final String PRODUCTION_DEFAULT_CORS =
            "tauri://localhost,https://tauri.localhost,http://tauri.localhost";

    public final int port;
    public final Path dataDir;
    public final List<String> corsOrigins;
    public final boolean corsAllowAny;

    private Config(int port, Path dataDir, List<String> corsOrigins, boolean corsAllowAny) {
        this.port = port;
        this.dataDir = dataDir;
        this.corsOrigins = corsOrigins;
        this.corsAllowAny = corsAllowAny;
    }

    public static Config fromEnv() {
        int port = DEFAULT_PORT;
        String portStr = System.getenv("SOCKET_PORT");
        if (portStr != null) {
            try {
                int p = Integer.parseInt(portStr.trim());
                if (p >= 0 && p <= 65535) port = p;
            } catch (NumberFormatException ignored) {
            }
        }

        String dir = System.getenv("VOIDCHAT_DATA_DIR");
        Path dataDir = Path.of(dir != null ? dir : "./data");

        String corsRaw = System.getenv("CORS_ORIGIN");
        if (corsRaw == null)
            corsRaw = PRODUCTION_DEFAULT_CORS;
        boolean allowAny = corsRaw.trim().equals("*");
        List<String> origins = new ArrayList<>();
        for (String o : corsRaw.split(",")) {
            String t = o.trim();
            if (!t.isEmpty())
                origins.add(t);
        }
        return new Config(port, dataDir, origins, allowAny);
    }

    /** Test/explicit constructor. */
    public static Config of(int port, Path dataDir, List<String> corsOrigins, boolean corsAllowAny) {
        return new Config(port, dataDir, corsOrigins, corsAllowAny);
    }

    public Path dbPath() {
        return dataDir.resolve("voidchat.json");
    }
}
