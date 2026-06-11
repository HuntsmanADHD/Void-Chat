/*
 * Api.java — HTTP API for community + channel CRUD. Faithful port of
 * http.rs: same routes, JSON shapes, status codes, error strings, rate
 * limits, gates, and defensive validation, so the existing frontend works
 * unchanged.
 *
 * Routes:
 *   GET    /api/communities
 *   POST   /api/communities
 *   GET    /api/communities/:id
 *   DELETE /api/communities/:id
 *   GET    /api/communities/:id/channels
 *   POST   /api/communities/:id/channels
 *   GET    /healthz
 */
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static java.util.Objects.requireNonNullElse;

public final class Api {
    // Tunables (preserved from http.rs)
    private static final long RATE_WINDOW_MS = 60_000;
    private static final int RATE_MAX = 60;
    private static final int MAX_AVATAR_BYTES = 256 * 1024;
    private static final long AVATAR_DAILY_BUDGET = 50L * 1024 * 1024;
    private static final long AVATAR_BUDGET_WINDOW_MS = 24L * 60 * 60 * 1000;
    private static final int MAX_RATE_BUCKETS = 50_000;

    private final Store store;
    private final Config cfg;
    private final java.security.SecureRandom rng = new java.security.SecureRandom();

    private final Map<String, RateBucket> rateBuckets = new ConcurrentHashMap<>();
    private long avatarBytesUsed = 0;
    private long avatarWindowStart = System.currentTimeMillis();
    private final Object avatarLock = new Object();

    public Api(Store store, Config cfg) {
        this.store = store;
        this.cfg = cfg;
    }

    public void mount(HttpServer server) {
        server.route("GET", "/healthz", req -> HttpServer.Response.text(200, "ok\n"));
        server.route("GET", "/api/communities", this::listCommunities);
        server.route("POST", "/api/communities", this::createCommunity);
        server.route("GET", "/api/communities/:id", this::getCommunity);
        server.route("DELETE", "/api/communities/:id", this::deleteCommunity);
        server.route("GET", "/api/communities/:id/channels", this::listChannels);
        server.route("POST", "/api/communities/:id/channels", this::createChannel);
    }

    // ── Handlers ──────────────────────────────────────────────────────

    private HttpServer.Response listCommunities(HttpServer.Request req) {
        applyCors(req);
        int page = Math.max(1, parseInt(req.query("page"), 1));
        int limit = clamp(parseInt(req.query("limit"), 50), 1, 100);

        List<Store.Community> all = store.listCommunities();
        int total = all.size();
        int start = (page - 1) * limit;
        int end = Math.min(start + limit, total);
        List<Object> out = new java.util.ArrayList<>();
        if (start < total) {
            for (Store.Community c : all.subList(start, end)) {
                out.add(Json.obj(
                    "id", c.id, "name", c.name,
                    "description", nz(c.description), "avatar", nz(c.avatar),
                    "isPrivate", c.isPrivate(), "createdAt", c.createdAt));
            }
        }
        return HttpServer.Response.json(200, Json.obj("communities", out, "total", (long) total));
    }

    private HttpServer.Response createCommunity(HttpServer.Request req) {
        applyCors(req);
        rateLimit(req, "community-create");

        Map<String, Object> body = parseBody(req);
        String name = sanitize(requireNonNullElse(Json.str(body, "name"), ""), 64);
        String description = filterEmpty(sanitizeOpt(Json.str(body, "description"), 500));
        String avatar = filterEmpty(sanitizeAvatar(Json.str(body, "avatar")));

        int nameChars = codePointCount(name);
        if (nameChars < 2 || nameChars > 64)
            throw new HttpServer.BadRequest(400, "Community name must be 2–64 characters");
        if (!isValidCommunityName(name))
            throw new HttpServer.BadRequest(400, "Community name may only contain letters, numbers, spaces, _ and -");

        if (avatar != null) {
            if (!isAllowedDataImageUri(avatar))
                throw new HttpServer.BadRequest(400, "Avatar must be an inline data:image/(png|jpeg|webp|gif);base64 URI");
            if (avatar.length() > MAX_AVATAR_BYTES)
                throw new HttpServer.BadRequest(413, "Avatar too large");
            if (!avatarBudgetAllows(avatar.length()))
                throw new HttpServer.BadRequest(429, "Avatar storage budget reached — retry tomorrow or create without an avatar");
        }

        String passwordHash = null;
        String pw = Json.str(body, "password");
        if (pw != null && !pw.isEmpty()) {
            int len = pw.getBytes(StandardCharsets.UTF_8).length;
            if (len < Argon2.MIN_LEN || len > Argon2.MAX_LEN)
                throw new HttpServer.BadRequest(400,
                    "Password must be " + Argon2.MIN_LEN + "–" + Argon2.MAX_LEN + " characters");
            passwordHash = Argon2.hashPassword(pw);
        }

        // Audit pt6 C2: password-less communities get a delete-token so only
        // the creator can DELETE later. Plaintext returned once, hash stored.
        String deleteTokenPlain = null, deleteTokenHash = null;
        if (passwordHash == null) {
            deleteTokenPlain = mintToken(32);
            deleteTokenHash = Argon2.hashPassword(deleteTokenPlain);
        }

        Object[] created = store.createCommunity(name, description, avatar, passwordHash, deleteTokenHash);
        Store.Community c = (Store.Community) created[0];
        Store.Channel ch = (Store.Channel) created[1];

        Map<String, Object> resp = Json.obj(
            "id", c.id, "name", c.name, "description", nz(c.description),
            "avatar", nz(c.avatar), "isPrivate", c.isPrivate(),
            "channels", Json.arr(Json.obj("id", ch.id, "name", ch.name, "isDefault", ch.isDefault)),
            "createdAt", c.createdAt);
        if (deleteTokenPlain != null)
            resp.put("deleteToken", deleteTokenPlain);
        return HttpServer.Response.json(201, resp);
    }

    private HttpServer.Response getCommunity(HttpServer.Request req) {
        applyCors(req);
        Store.Community c = community(req.param("id"));
        gateCommunity(c, req);
        List<Store.Channel> channels = store.listChannels(c.id);
        List<Object> chOut = new java.util.ArrayList<>();
        for (Store.Channel ch : channels)
            chOut.add(Json.obj("id", ch.id, "name", ch.name,
                "description", nz(ch.description), "isDefault", ch.isDefault));
        return HttpServer.Response.json(200, Json.obj(
            "id", c.id, "name", c.name, "description", nz(c.description),
            "avatar", nz(c.avatar), "isPrivate", c.isPrivate(),
            "channels", chOut, "createdAt", c.createdAt));
    }

    private HttpServer.Response deleteCommunity(HttpServer.Request req) {
        applyCors(req);
        rateLimit(req, "community-delete");
        Store.Community c = community(req.param("id"));
        // password (if set) OR delete-token (if not) is the credential.
        String stored = c.passwordHash != null ? c.passwordHash : c.deleteTokenHash;
        if (stored == null)
            throw new HttpServer.BadRequest(403,
                "this community predates delete-auth migration — cannot delete via API");
        verifyCredential(stored, req);
        store.deleteCommunity(c.id);
        return HttpServer.Response.json(200, Json.obj("deleted", c.id));
    }

    private HttpServer.Response listChannels(HttpServer.Request req) {
        applyCors(req);
        Store.Community c = community(req.param("id"));
        gateCommunity(c, req);
        List<Object> out = new java.util.ArrayList<>();
        for (Store.Channel ch : store.listChannels(c.id))
            out.add(Json.obj("id", ch.id, "name", ch.name,
                "description", nz(ch.description), "isDefault", ch.isDefault,
                "createdAt", ch.createdAt));
        return HttpServer.Response.json(200, Json.obj("channels", out));
    }

    private HttpServer.Response createChannel(HttpServer.Request req) {
        applyCors(req);
        rateLimit(req, "channel-create");
        Store.Community c = community(req.param("id"));
        gateCommunity(c, req);

        Map<String, Object> body = parseBody(req);
        String name = sanitize(requireNonNullElse(Json.str(body, "name"), ""), 32);
        String description = filterEmpty(sanitizeOpt(Json.str(body, "description"), 200));

        int nameChars = codePointCount(name);
        if (nameChars == 0 || nameChars > 32)
            throw new HttpServer.BadRequest(400, "Channel name must be 1–32 characters");
        if (!isValidChannelName(name))
            throw new HttpServer.BadRequest(400, "Channel name may only contain letters, numbers, _ and -");

        Store.Channel ch = store.createChannel(c.id, name, description);
        return HttpServer.Response.json(201, Json.obj(
            "id", ch.id, "name", ch.name, "description", nz(ch.description),
            "isDefault", ch.isDefault, "createdAt", ch.createdAt));
    }

    // ── Gates ─────────────────────────────────────────────────────────

    private void gateCommunity(Store.Community c, HttpServer.Request req) {
        if (c.passwordHash == null)
            return;
        String provided = requireNonNullElse(req.header("x-community-password"), "");
        if (provided.isEmpty())
            throw new HttpServer.BadRequest(401, "Password required");
        boolean isArgon = c.passwordHash.startsWith("$argon2");
        boolean valid;
        boolean needsRehash = false;
        if (isArgon) {
            valid = Argon2.verify(provided, c.passwordHash);
        } else {
            Boolean legacy = Scrypt.verifyLegacy(provided, c.passwordHash);
            valid = Boolean.TRUE.equals(legacy);
            needsRehash = valid; // migrate scrypt → argon2id on success
        }
        if (!valid)
            throw new HttpServer.BadRequest(401, "Invalid password");
        if (needsRehash) {
            // Fire-and-forget rehash forward (matches the Rust relay).
            final String pw = provided, id = c.id;
            Thread.ofVirtual().start(() -> {
                try {
                    store.updateCommunityPasswordHash(id, Argon2.hashPassword(pw));
                } catch (RuntimeException e) {
                    Log.warn("rehash on login failed: " + e);
                }
            });
        }
    }

    private void verifyCredential(String stored, HttpServer.Request req) {
        String provided = requireNonNullElse(req.header("x-community-password"), "");
        if (provided.isEmpty())
            throw new HttpServer.BadRequest(401,
                "delete requires the password (or delete-token if no password was set)");
        boolean valid = stored.startsWith("$argon2")
                ? Argon2.verify(provided, stored)
                : Boolean.TRUE.equals(Scrypt.verifyLegacy(provided, stored));
        if (!valid)
            throw new HttpServer.BadRequest(401, "invalid credential");
    }

    // ── Rate limiting ─────────────────────────────────────────────────

    private void rateLimit(HttpServer.Request req, String action) {
        String key = action + ":" + rateBucketKey(req);
        long now = System.currentTimeMillis();
        if (!rateBuckets.containsKey(key) && rateBuckets.size() >= MAX_RATE_BUCKETS) {
            var it = rateBuckets.keySet().iterator();
            if (it.hasNext()) { it.next(); it.remove(); }
        }
        RateBucket bucket = rateBuckets.computeIfAbsent(key, k -> new RateBucket(now + RATE_WINDOW_MS));
        synchronized (bucket) {
            if (bucket.resetAt <= now) {
                bucket.count = 0;
                bucket.resetAt = now + RATE_WINDOW_MS;
            }
            if (bucket.count >= RATE_MAX) {
                long retry = Math.max(0, (bucket.resetAt - now)) / 1000;
                throw new HttpServer.BadRequest(429, "Rate limit exceeded. Retry after " + retry + " seconds");
            }
            bucket.count++;
        }
    }

    /**
     * Audit pt2 H6 / pt6 H2: never trust X-Forwarded-For. Use the per-circuit
     * token the local onion proxy injects (so cross-host visitors don't share
     * one 127.0.0.1 bucket), else the connection peer IP.
     */
    private static String rateBucketKey(HttpServer.Request req) {
        String circuit = req.header("x-voidchat-proxy-circuit");
        if (circuit != null && !circuit.isEmpty() && circuit.length() <= 128)
            return "circuit:" + circuit;
        return req.peerIp();
    }

    private boolean avatarBudgetAllows(int size) {
        synchronized (avatarLock) {
            long now = System.currentTimeMillis();
            if (now - avatarWindowStart > AVATAR_BUDGET_WINDOW_MS) {
                avatarBytesUsed = 0;
                avatarWindowStart = now;
            }
            if (avatarBytesUsed + size > AVATAR_DAILY_BUDGET)
                return false;
            avatarBytesUsed += size;
            return true;
        }
    }

    // ── CORS ──────────────────────────────────────────────────────────

    private void applyCors(HttpServer.Request req) {
        String origin = req.header("origin");
        if (origin == null)
            return;
        if (cfg.corsAllowAny || cfg.corsOrigins.contains(origin))
            req.corsOrigin = cfg.corsAllowAny ? "*" : origin;
    }

    // ── Validation helpers (mirror http.rs) ───────────────────────────

    private Store.Community community(String id) {
        try {
            return store.getCommunity(id);
        } catch (Store.NotFound e) {
            throw new HttpServer.BadRequest(404, "Not found");
        }
    }

    private Map<String, Object> parseBody(HttpServer.Request req) {
        if (req.body().length == 0)
            return new HashMap<>();
        try {
            Map<String, Object> m = Json.asObj(Json.parse(req.bodyString()));
            return m != null ? m : new HashMap<>();
        } catch (Json.JsonException e) {
            throw new HttpServer.BadRequest(400, "Invalid JSON body");
        }
    }

    /** Strip \0, trim, cap length in CODE POINTS (matches Rust char counting). */
    static String sanitize(String s, int maxCodePoints) {
        String cleaned = s.replace("\0", "").strip();
        if (codePointCount(cleaned) <= maxCodePoints)
            return cleaned;
        int[] cps = cleaned.codePoints().limit(maxCodePoints).toArray();
        return new String(cps, 0, cps.length);
    }

    static String sanitizeOpt(String s, int maxCodePoints) {
        return s == null ? null : sanitize(s, maxCodePoints);
    }

    static String sanitizeAvatar(String s) {
        return s == null ? null : s.replace("\0", "").strip();
    }

    private static String filterEmpty(String s) {
        return (s == null || s.isEmpty()) ? null : s;
    }

    static int codePointCount(String s) {
        return s.codePointCount(0, s.length());
    }

    static boolean isValidCommunityName(String name) {
        return name.codePoints().allMatch(c ->
            isAsciiAlnum(c) || c == ' ' || c == '_' || c == '-');
    }

    static boolean isValidChannelName(String name) {
        return name.codePoints().allMatch(c -> isAsciiAlnum(c) || c == '_' || c == '-');
    }

    private static boolean isAsciiAlnum(int c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    /** data:image/(png|jpeg|webp|gif);base64,<bytes> with magic-byte sniff. */
    static boolean isAllowedDataImageUri(String value) {
        String prefix = "data:image/";
        if (!value.startsWith(prefix))
            return false;
        String rest = value.substring(prefix.length());
        int sep = rest.indexOf(";base64,");
        if (sep < 0)
            return false;
        String mime = rest.substring(0, sep);
        String payload = rest.substring(sep + ";base64,".length());
        if (!(mime.equals("png") || mime.equals("jpeg") || mime.equals("webp") || mime.equals("gif")))
            return false;
        if (payload.isEmpty())
            return false;
        for (int i = 0; i < payload.length(); i++) {
            char ch = payload.charAt(i);
            boolean ok = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')
                    || (ch >= '0' && ch <= '9') || ch == '+' || ch == '/' || ch == '=';
            if (!ok)
                return false;
        }
        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(payload);
        } catch (IllegalArgumentException e) {
            return false;
        }
        return imageMagicMatchesMime(decoded, mime);
    }

    static boolean imageMagicMatchesMime(byte[] b, String mime) {
        switch (mime) {
            case "png":
                return b.length >= 8 && b[0] == (byte) 0x89 && b[1] == 'P' && b[2] == 'N'
                    && b[3] == 'G' && b[4] == '\r' && b[5] == '\n' && b[6] == 0x1a && b[7] == '\n';
            case "jpeg":
                return b.length >= 3 && b[0] == (byte) 0xff && b[1] == (byte) 0xd8 && b[2] == (byte) 0xff;
            case "gif":
                return b.length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8'
                    && (b[4] == '7' || b[4] == '9') && b[5] == 'a';
            case "webp":
                return b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                    && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P';
            default:
                return false;
        }
    }

    private String mintToken(int bytes) {
        byte[] buf = new byte[bytes];
        rng.nextBytes(buf);
        return Base58.encode(buf);
    }

    private static Object nz(String s) { return s == null ? Json.NULL : s; }

    private static int parseInt(String s, int def) {
        if (s == null) return def;
        try { return Integer.parseInt(s.trim()); } catch (NumberFormatException e) { return def; }
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static final class RateBucket {
        int count = 0;
        long resetAt;
        RateBucket(long resetAt) { this.resetAt = resetAt; }
    }
}
