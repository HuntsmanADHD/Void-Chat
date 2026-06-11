/*
 * Store.java — community + channel directory storage. Replaces rusqlite/
 * SQLite (db.rs) with a single JSON file, loaded at startup and written
 * atomically (temp file + ATOMIC_MOVE) after each mutation. All access
 * serialized through one lock. Friend-group scale — a handful of writes
 * per minute — so this is more than fast enough and has zero dependencies.
 *
 * Semantics preserved from db.rs:
 *   - 16-random-byte base58 IDs
 *   - ISO-8601 millisecond UTC timestamps
 *   - unique community name; unique (communityId, channelName)
 *   - creating a community also creates its default "general" channel
 *   - deleting a community cascades to its channels
 *   - listings: communities by createdAt DESC; channels by isDefault DESC
 *     then createdAt ASC
 */
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Store {
    private static final SecureRandom RNG = new SecureRandom();
    private static final DateTimeFormatter ISO_MS =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private final Path file;
    private final Object lock = new Object();
    // community id → Community; insertion order is creation order
    private final LinkedHashMap<String, Community> communities = new LinkedHashMap<>();
    // channel id → Channel
    private final LinkedHashMap<String, Channel> channels = new LinkedHashMap<>();

    public Store(Path file) {
        this.file = file;
    }

    // ── Records ───────────────────────────────────────────────────────

    public static final class Community {
        public String id;
        public String name;
        public String description;   // nullable
        public String avatar;        // nullable
        public String passwordHash;  // nullable, never serialized to clients
        public String deleteTokenHash; // nullable, never serialized to clients
        public String createdAt;
        public boolean isPrivate() { return passwordHash != null; }
    }

    public static final class Channel {
        public String id;
        public String name;
        public String description;   // nullable
        public String communityId;
        public boolean isDefault;
        public String createdAt;
    }

    public static final class Conflict extends RuntimeException {
        public Conflict(String m) { super(m); }
    }
    public static final class NotFound extends RuntimeException {
        public NotFound() { super("not found"); }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────

    public void open() throws IOException {
        Path parent = file.getParent();
        if (parent != null)
            Files.createDirectories(parent);
        if (Files.exists(file)) {
            load();
        }
    }

    @SuppressWarnings("unchecked")
    private void load() throws IOException {
        String text = Files.readString(file, StandardCharsets.UTF_8);
        if (text.isBlank())
            return;
        Map<String, Object> root = Json.asObj(Json.parse(text));
        if (root == null)
            throw new IOException("corrupt store: root is not an object");
        List<Object> comms = Json.asArr(root.get("communities"));
        if (comms != null) {
            for (Object o : comms) {
                Map<String, Object> m = Json.asObj(o);
                Community c = new Community();
                c.id = Json.str(m, "id");
                c.name = Json.str(m, "name");
                c.description = Json.str(m, "description");
                c.avatar = Json.str(m, "avatar");
                c.passwordHash = Json.str(m, "passwordHash");
                c.deleteTokenHash = Json.str(m, "deleteTokenHash");
                c.createdAt = Json.str(m, "createdAt");
                communities.put(c.id, c);
            }
        }
        List<Object> chans = Json.asArr(root.get("channels"));
        if (chans != null) {
            for (Object o : chans) {
                Map<String, Object> m = Json.asObj(o);
                Channel c = new Channel();
                c.id = Json.str(m, "id");
                c.name = Json.str(m, "name");
                c.description = Json.str(m, "description");
                c.communityId = Json.str(m, "communityId");
                Object def = m.get("isDefault");
                c.isDefault = Boolean.TRUE.equals(def);
                c.createdAt = Json.str(m, "createdAt");
                channels.put(c.id, c);
            }
        }
        Log.info("loaded " + communities.size() + " communities, " + channels.size() + " channels");
    }

    /** Persist the whole store atomically. Caller holds `lock`. */
    private void persist() {
        List<Object> commArr = new ArrayList<>();
        for (Community c : communities.values()) {
            commArr.add(Json.obj(
                "id", c.id, "name", c.name, "description", nz(c.description),
                "avatar", nz(c.avatar), "passwordHash", nz(c.passwordHash),
                "deleteTokenHash", nz(c.deleteTokenHash), "createdAt", c.createdAt));
        }
        List<Object> chanArr = new ArrayList<>();
        for (Channel c : channels.values()) {
            chanArr.add(Json.obj(
                "id", c.id, "name", c.name, "description", nz(c.description),
                "communityId", c.communityId, "isDefault", c.isDefault,
                "createdAt", c.createdAt));
        }
        String text = Json.write(Json.obj("communities", commArr, "channels", chanArr));
        try {
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, text, StandardCharsets.UTF_8);
            restrict(tmp); // owner-only before it carries password/token hashes
            try {
                Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
            }
            restrict(file);
        } catch (IOException e) {
            Log.error("persist failed: " + e);
            throw new RuntimeException("persist failed", e);
        }
    }

    private static void restrict(Path p) {
        try {
            Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException | IOException ignored) {
            // non-POSIX filesystem (e.g. Windows) — best effort
        }
    }

    private static Object nz(String s) { return s == null ? Json.NULL : s; }

    // ── Communities ───────────────────────────────────────────────────

    public List<Community> listCommunities() {
        synchronized (lock) {
            List<Community> out = new ArrayList<>(communities.values());
            // createdAt DESC — ties broken by reverse insertion order (newest first)
            out.sort(Comparator.comparing((Community c) -> c.createdAt).reversed());
            return out;
        }
    }

    public Community getCommunity(String id) {
        synchronized (lock) {
            Community c = communities.get(id);
            if (c == null)
                throw new NotFound();
            return copy(c);
        }
    }

    /** Returns the created community + its default channel. */
    public Object[] createCommunity(String name, String description, String avatar,
            String passwordHash, String deleteTokenHash) {
        synchronized (lock) {
            for (Community existing : communities.values()) {
                if (existing.name.equals(name))
                    throw new Conflict("community name already taken");
            }
            String now = isoNow();
            Community c = new Community();
            c.id = newId();
            c.name = name;
            c.description = description;
            c.avatar = avatar;
            c.passwordHash = passwordHash;
            c.deleteTokenHash = deleteTokenHash;
            c.createdAt = now;
            communities.put(c.id, c);

            Channel ch = new Channel();
            ch.id = newId();
            ch.name = "general";
            ch.description = null;
            ch.communityId = c.id;
            ch.isDefault = true;
            ch.createdAt = now;
            channels.put(ch.id, ch);

            persist();
            return new Object[] { copy(c), copy(ch) };
        }
    }

    public void updateCommunityPasswordHash(String id, String newHash) {
        synchronized (lock) {
            Community c = communities.get(id);
            if (c == null)
                return;
            c.passwordHash = newHash;
            persist();
        }
    }

    public void deleteCommunity(String id) {
        synchronized (lock) {
            if (communities.remove(id) == null)
                throw new NotFound();
            channels.values().removeIf(ch -> ch.communityId.equals(id)); // cascade
            persist();
        }
    }

    // ── Channels ──────────────────────────────────────────────────────

    public List<Channel> listChannels(String communityId) {
        synchronized (lock) {
            List<Channel> out = new ArrayList<>();
            for (Channel c : channels.values())
                if (c.communityId.equals(communityId))
                    out.add(copy(c));
            // isDefault DESC, then createdAt ASC
            out.sort(Comparator.comparing((Channel c) -> !c.isDefault)
                    .thenComparing(c -> c.createdAt));
            return out;
        }
    }

    public Channel createChannel(String communityId, String name, String description) {
        synchronized (lock) {
            if (!communities.containsKey(communityId))
                throw new NotFound();
            for (Channel c : channels.values())
                if (c.communityId.equals(communityId) && c.name.equals(name))
                    throw new Conflict("channel name already taken in this community");
            Channel c = new Channel();
            c.id = newId();
            c.name = name;
            c.description = description;
            c.communityId = communityId;
            c.isDefault = false;
            c.createdAt = isoNow();
            channels.put(c.id, c);
            persist();
            return copy(c);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private static Community copy(Community c) {
        Community n = new Community();
        n.id = c.id; n.name = c.name; n.description = c.description;
        n.avatar = c.avatar; n.passwordHash = c.passwordHash;
        n.deleteTokenHash = c.deleteTokenHash; n.createdAt = c.createdAt;
        return n;
    }

    private static Channel copy(Channel c) {
        Channel n = new Channel();
        n.id = c.id; n.name = c.name; n.description = c.description;
        n.communityId = c.communityId; n.isDefault = c.isDefault;
        n.createdAt = c.createdAt;
        return n;
    }

    static String newId() {
        byte[] b = new byte[16];
        RNG.nextBytes(b);
        return Base58.encode(b);
    }

    private static String isoNow() {
        return ISO_MS.format(Instant.now());
    }
}
