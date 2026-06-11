/*
 * RelayHttpClient.java — thin client for the relay HTTP API
 * (community/channel CRUD), JDK HttpClient only. Returns parsed JSON values
 * (Json maps/lists). Throws ApiException on non-2xx with the relay's error.
 */
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;

public final class RelayHttpClient {
    private final String base; // e.g. http://127.0.0.1:3001
    private final HttpClient http = HttpClient.newHttpClient();

    public RelayHttpClient(String base) {
        this.base = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }

    public static final class ApiException extends RuntimeException {
        public final int status;
        public ApiException(int status, String message) { super(message); this.status = status; }
    }

    /** GET /api/communities → list of community objects. */
    public List<Object> listCommunities() throws Exception {
        Map<String, Object> r = Json.asObj(get("/api/communities"));
        return Json.asArr(r.get("communities"));
    }

    /** POST /api/communities → created community (includes deleteToken if no password). */
    public Map<String, Object> createCommunity(String name, String description, String password) throws Exception {
        Map<String, Object> body = Json.obj("name", name);
        if (description != null) body.put("description", description);
        if (password != null) body.put("password", password);
        return Json.asObj(post("/api/communities", body, null));
    }

    /** GET /api/communities/:id → community + channels (password via header if needed). */
    public Map<String, Object> getCommunity(String id, String password) throws Exception {
        return Json.asObj(get("/api/communities/" + id, password));
    }

    /** POST /api/communities/:id/channels → created channel. */
    public Map<String, Object> createChannel(String communityId, String name, String password) throws Exception {
        return Json.asObj(post("/api/communities/" + communityId + "/channels", Json.obj("name", name), password));
    }

    // ── plumbing ──────────────────────────────────────────────────────

    private Object get(String path) throws Exception { return get(path, null); }

    private Object get(String path, String password) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path)).GET();
        if (password != null) b.header("x-community-password", password);
        return send(b.build());
    }

    private Object post(String path, Object body, String password) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(body)));
        if (password != null) b.header("x-community-password", password);
        return send(b.build());
    }

    private Object send(HttpRequest req) throws Exception {
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        Object parsed = resp.body().isEmpty() ? null : Json.parse(resp.body());
        if (resp.statusCode() / 100 != 2) {
            Map<String, Object> err = Json.asObj(parsed);
            String msg = err != null ? Json.str(err, "error") : "HTTP " + resp.statusCode();
            throw new ApiException(resp.statusCode(), msg);
        }
        return parsed;
    }
}
