/*
 * LocalStore.java — small persistent client-side stores, parity with the TS
 * client's localStorage features: pinned communities (rejoin without the
 * invite link), a community-password cache, and a recent-hosts list. One
 * JSON file per concern under ~/.voidchat/, written atomically (tmp + move,
 * same pattern as relay-java's Store) with 0600 permissions.
 *
 * The password cache is plaintext on disk (0600) in v0.1 — same exposure as
 * the identity file; both are covered by the opt-in passphrase encryption
 * (Phase A3) and are listed in the disk inventory (Phase C).
 */
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class LocalStore {
    private static final int MAX_HOSTS = 20;

    public static final class Pin {
        public final String name;       // community display name
        public final String relayUrl;   // http://…onion or http://127.0.0.1:…
        public final String communityId;
        public Pin(String name, String relayUrl, String communityId) {
            this.name = name;
            this.relayUrl = relayUrl;
            this.communityId = communityId;
        }
        String key() { return relayUrl + "|" + communityId; }
    }

    private final Path dir;
    private final Object lock = new Object();

    public LocalStore(Path dir) {
        this.dir = dir;
    }

    public static LocalStore inHome() {
        return new LocalStore(Path.of(System.getProperty("user.home"), ".voidchat"));
    }

    // ── Pinned communities ────────────────────────────────────────────

    public List<Pin> pins() {
        synchronized (lock) {
            List<Pin> out = new ArrayList<>();
            for (Object o : loadArr("pinned.json")) {
                Map<String, Object> m = Json.asObj(o);
                if (m == null) continue;
                String name = Json.str(m, "name");
                String relay = Json.str(m, "relayUrl");
                String id = Json.str(m, "communityId");
                if (name != null && relay != null && id != null)
                    out.add(new Pin(name, relay, id));
            }
            return out;
        }
    }

    public void pin(Pin p) {
        synchronized (lock) {
            List<Pin> all = pins();
            all.removeIf(x -> x.key().equals(p.key()));
            all.add(0, p);
            List<Object> arr = new ArrayList<>();
            for (Pin x : all)
                arr.add(Json.obj("name", x.name, "relayUrl", x.relayUrl, "communityId", x.communityId));
            saveArr("pinned.json", arr);
        }
    }

    public void unpin(String relayUrl, String communityId) {
        synchronized (lock) {
            String key = relayUrl + "|" + communityId;
            List<Pin> all = pins();
            all.removeIf(x -> x.key().equals(key));
            List<Object> arr = new ArrayList<>();
            for (Pin x : all)
                arr.add(Json.obj("name", x.name, "relayUrl", x.relayUrl, "communityId", x.communityId));
            saveArr("pinned.json", arr);
        }
    }

    public boolean isPinned(String relayUrl, String communityId) {
        String key = relayUrl + "|" + communityId;
        for (Pin p : pins())
            if (p.key().equals(key)) return true;
        return false;
    }

    // ── Community password cache ──────────────────────────────────────

    /** Cached password for a community, or null. */
    public String password(String communityId) {
        synchronized (lock) {
            return Json.str(loadObj("passwords.json"), communityId);
        }
    }

    public void rememberPassword(String communityId, String password) {
        synchronized (lock) {
            Map<String, Object> m = loadObj("passwords.json");
            m.put(communityId, password);
            saveObj("passwords.json", m);
        }
    }

    public void forgetPassword(String communityId) {
        synchronized (lock) {
            Map<String, Object> m = loadObj("passwords.json");
            m.remove(communityId);
            saveObj("passwords.json", m);
        }
    }

    // ── Recent hosts ──────────────────────────────────────────────────

    /** Most-recent-first list of relay URLs we've connected to. */
    public List<String> hosts() {
        synchronized (lock) {
            List<String> out = new ArrayList<>();
            for (Object o : loadArr("hosts.json"))
                if (o instanceof String s) out.add(s);
            return out;
        }
    }

    public void rememberHost(String relayUrl) {
        synchronized (lock) {
            List<String> all = hosts();
            all.remove(relayUrl);
            all.add(0, relayUrl);
            while (all.size() > MAX_HOSTS) all.remove(all.size() - 1);
            saveArr("hosts.json", new ArrayList<>(all));
        }
    }

    // ── Plumbing: atomic JSON files, 0600 ─────────────────────────────

    private List<Object> loadArr(String file) {
        Object v = load(file);
        List<Object> arr = Json.asArr(v);
        return arr != null ? arr : new ArrayList<>();
    }

    private Map<String, Object> loadObj(String file) {
        Object v = load(file);
        Map<String, Object> m = Json.asObj(v);
        return m != null ? new LinkedHashMap<>(m) : new LinkedHashMap<>();
    }

    private Object load(String file) {
        Path p = dir.resolve(file);
        try {
            if (!Files.exists(p)) return null;
            return Json.parse(Files.readString(p, StandardCharsets.UTF_8));
        } catch (IOException | RuntimeException e) {
            return null; // unreadable/corrupt → behave as empty, don't crash
        }
    }

    private void saveArr(String file, List<Object> arr) { save(file, Json.write(arr)); }
    private void saveObj(String file, Map<String, Object> obj) { save(file, Json.write(obj)); }

    private void save(String file, String json) {
        try {
            Files.createDirectories(dir);
            Path target = dir.resolve(file);
            Path tmp = dir.resolve(file + ".tmp");
            Files.writeString(tmp, json, StandardCharsets.UTF_8);
            restrict(tmp);
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new RuntimeException("local store write failed: " + file, e);
        }
    }

    private static void restrict(Path p) {
        try {
            Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException | IOException ignored) {
            // non-POSIX platform
        }
    }
}
