/*
 * Log.java — minimal stderr logger. Level from VOIDCHAT_RELAY_LOG
 * (error|warn|info|debug; default info). Replaces the `tracing` crate.
 */
import java.time.Instant;

public final class Log {
    private Log() {}

    private static final int ERROR = 0, WARN = 1, INFO = 2, DEBUG = 3;
    private static final int LEVEL = parseLevel(System.getenv("VOIDCHAT_RELAY_LOG"));

    private static int parseLevel(String s) {
        if (s == null) return INFO;
        switch (s.trim().toLowerCase()) {
            case "error": return ERROR;
            case "warn": return WARN;
            case "debug": case "trace": return DEBUG;
            default: return INFO;
        }
    }

    public static void error(String msg) { emit(ERROR, "ERROR", msg); }
    public static void warn(String msg) { emit(WARN, "WARN", msg); }
    public static void info(String msg) { emit(INFO, "INFO", msg); }
    public static void debug(String msg) { emit(DEBUG, "DEBUG", msg); }

    private static void emit(int level, String label, String msg) {
        if (level > LEVEL) return;
        System.err.println(Instant.now() + " " + label + " " + msg);
    }
}
