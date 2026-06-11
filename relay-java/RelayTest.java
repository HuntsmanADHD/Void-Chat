/*
 * RelayTest.java — integration tests against a live relay instance booted on
 * an ephemeral port with a temp data dir. Drives the HTTP API with the JDK
 * HttpClient and the realtime layer with the JDK WebSocket client using real
 * Ed25519 keypairs. java.util.* and java.net.http only — no third-party deps.
 *
 * Run: javac -d out *.java && java -cp out RelayTest
 */
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.EdECPublicKey;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

public final class RelayTest {
    static int passed = 0, failed = 0;
    static String base;
    static String wsBase;
    static HttpClient http = HttpClient.newHttpClient();

    static void check(boolean cond, String name) {
        if (cond) passed++;
        else { failed++; System.err.println("FAIL: " + name); }
    }

    public static void main(String[] args) throws Exception {
        Path dataDir = Files.createTempDirectory("vc-relay-test");
        Config cfg = Config.of(0, dataDir, List.of("http://localhost:5173"), false);
        Store store = new Store(cfg.dbPath());
        store.open();
        Main.Relay relay = Main.start(cfg, store);
        int port = relay.port();
        base = "http://127.0.0.1:" + port;
        wsBase = "ws://127.0.0.1:" + port + "/ws";
        try {
            httpTests();
            wsTests();
        } finally {
            relay.stop();
        }
        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }

    // ── HTTP ──────────────────────────────────────────────────────────

    static void httpTests() throws Exception {
        // healthz
        check(get("/healthz").body().equals("ok\n"), "healthz");

        // create community (no password → delete token)
        var r = post("/api/communities", "{\"name\":\"My Community\",\"description\":\"desc\"}", null);
        check(r.statusCode() == 201, "create community 201");
        Map<String, Object> created = obj(r.body());
        String cid = (String) created.get("id");
        String deleteToken = (String) created.get("deleteToken");
        check(cid != null && deleteToken != null, "create returns id + deleteToken");
        check(Boolean.FALSE.equals(created.get("isPrivate")), "create isPrivate=false");
        check(Json.asArr(created.get("channels")).size() == 1, "create has default channel");

        // duplicate name → 409
        check(post("/api/communities", "{\"name\":\"My Community\"}", null).statusCode() == 409,
            "duplicate name 409");

        // name too short → 400
        check(post("/api/communities", "{\"name\":\"x\"}", null).statusCode() == 400, "short name 400");
        // bad charset → 400
        check(post("/api/communities", "{\"name\":\"bad@name\"}", null).statusCode() == 400, "bad charset 400");
        // bad avatar (wrong magic) → 400
        check(post("/api/communities", "{\"name\":\"AvatarTest\",\"avatar\":\"data:image/png;base64,QUFBQQ==\"}", null)
            .statusCode() == 400, "avatar magic-byte mismatch 400");

        // get community + its channels
        var g = get("/api/communities/" + cid);
        check(g.statusCode() == 200, "get community 200");
        Map<String, Object> got = obj(g.body());
        check("My Community".equals(got.get("name")), "get community name");

        // missing community → 404
        check(get("/api/communities/doesnotexist").statusCode() == 404, "missing community 404");

        // create channel
        var ch = post("/api/communities/" + cid + "/channels", "{\"name\":\"random\"}", null);
        check(ch.statusCode() == 201, "create channel 201");
        check("random".equals(obj(ch.body()).get("name")), "channel name");
        // duplicate channel → 409
        check(post("/api/communities/" + cid + "/channels", "{\"name\":\"random\"}", null).statusCode() == 409,
            "duplicate channel 409");
        // bad channel charset → 400
        check(post("/api/communities/" + cid + "/channels", "{\"name\":\"has space\"}", null).statusCode() == 400,
            "channel bad charset 400");

        // password-gated community
        var p = post("/api/communities", "{\"name\":\"Private\",\"password\":\"secret123\"}", null);
        check(p.statusCode() == 201, "create private 201");
        check(obj(p.body()).get("deleteToken") == null, "private has no deleteToken");
        String pid = (String) obj(p.body()).get("id");
        check(Boolean.TRUE.equals(obj(p.body()).get("isPrivate")), "private isPrivate=true");
        // gated read without password → 401
        check(get("/api/communities/" + pid).statusCode() == 401, "gated read needs password 401");
        // wrong password → 401
        check(getWith("/api/communities/" + pid, "x-community-password", "wrong").statusCode() == 401,
            "wrong password 401");
        // right password → 200
        check(getWith("/api/communities/" + pid, "x-community-password", "secret123").statusCode() == 200,
            "right password 200");

        // delete: wrong token → 401, right token → 200
        check(deleteWith("/api/communities/" + cid, "x-community-password", "wrongtoken").statusCode() == 401,
            "delete wrong token 401");
        check(deleteWith("/api/communities/" + cid, "x-community-password", deleteToken).statusCode() == 200,
            "delete right token 200");
        check(get("/api/communities/" + cid).statusCode() == 404, "deleted community gone 404");

        // delete private community with its password
        check(deleteWith("/api/communities/" + pid, "x-community-password", "secret123").statusCode() == 200,
            "delete private with password 200");

        // oversized body → 413
        StringBuilder big = new StringBuilder("{\"name\":\"x\",\"description\":\"");
        big.append("a".repeat(600 * 1024)).append("\"}");
        check(post("/api/communities", big.toString(), null).statusCode() == 413, "oversized body 413");

        // rate limit: hammer community-create past 60/min
        int got429 = 0;
        for (int i = 0; i < 65; i++) {
            int sc = post("/api/communities", "{\"name\":\"RL" + i + "x\"}", null).statusCode();
            if (sc == 429) { got429++; }
        }
        check(got429 > 0, "rate limit returns 429 after 60/min");

        // CORS: allowed origin echoed back
        var cors = getWith("/api/communities", "Origin", "http://localhost:5173");
        check("http://localhost:5173".equals(cors.headers().firstValue("access-control-allow-origin").orElse(null)),
            "CORS echoes allowed origin");
        var corsBad = getWith("/api/communities", "Origin", "http://evil.example");
        check(corsBad.headers().firstValue("access-control-allow-origin").isEmpty(),
            "CORS omits disallowed origin");
    }

    // ── WebSocket realtime ────────────────────────────────────────────

    static void wsTests() throws Exception {
        // A shared channel for fan-out: two distinct identities join, one sends.
        Peer alice = new Peer("Alice");
        Peer bob = new Peer("Bob");
        alice.connect();
        bob.connect();

        // both receive a connection nonce
        check(alice.awaitEvent(Realtime.CONNECTION_NONCE) != null, "alice gets nonce");
        check(bob.awaitEvent(Realtime.CONNECTION_NONCE) != null, "bob gets nonce");

        // announce
        alice.announce();
        bob.announce();
        check(alice.awaitEvent(Realtime.SESSION_ACK) != null, "alice session ack");
        check(bob.awaitEvent(Realtime.SESSION_ACK) != null, "bob session ack");

        // alice joins channel → gets roster (just her)
        String channelId = "chan-" + Store.newId();
        alice.join(channelId);
        Map<String, Object> roster1 = alice.awaitEvent(Realtime.CHANNEL_ROSTER);
        check(roster1 != null && Json.asArr(d(roster1).get("members")).size() == 1, "alice roster has 1");

        // bob joins → alice gets member-joined, bob gets roster of 2
        bob.join(channelId);
        Map<String, Object> joined = alice.awaitEvent(Realtime.CHANNEL_MEMBER_JOINED);
        check(joined != null, "alice sees member-joined");
        Map<String, Object> roster2 = bob.awaitEvent(Realtime.CHANNEL_ROSTER);
        check(roster2 != null && Json.asArr(d(roster2).get("members")).size() == 2, "bob roster has 2");

        // alice sends to the channel addressed to bob's box key → bob receives
        alice.channelSend(channelId, bob.boxPub, "ciphertext-for-bob", "nonce123");
        Map<String, Object> msg = bob.awaitEvent(Realtime.CHANNEL_MESSAGE);
        check(msg != null, "bob receives channel message");
        check("ciphertext-for-bob".equals(d(msg).get("ciphertext")), "channel message ciphertext intact");
        check(alice.boxPub.equals(d(msg).get("senderBoxPublicKey")), "channel message sender correct");
        check(alice.awaitAck(true), "alice channel send ack ok");

        // sender does NOT receive its own message (no self-echo)
        check(alice.pollEvent(Realtime.CHANNEL_MESSAGE, 300) == null, "no self-echo on channel send");

        // DM from bob to alice
        bob.dmSend(alice.boxPub, "dm-ciphertext", "dmnonce", "dmsig");
        Map<String, Object> dm = alice.awaitEvent(Realtime.DM_MESSAGE);
        check(dm != null && "dm-ciphertext".equals(d(dm).get("ciphertext")), "alice receives DM");
        check(bob.awaitAck(true), "bob dm ack ok");

        // bob leaves → alice sees member-left
        bob.leave(channelId);
        Map<String, Object> left = alice.awaitEvent(Realtime.CHANNEL_MEMBER_LEFT);
        check(left != null && bob.signPub.equals(d(left).get("signingPublicKey")), "alice sees member-left");

        // bad announce: wrong nonce. Fresh peer, tamper the signed nonce.
        Peer mal = new Peer("Mallory");
        mal.connect();
        mal.awaitEvent(Realtime.CONNECTION_NONCE);
        mal.announceWithNonce("deadbeef-not-the-real-nonce");
        Map<String, Object> err = mal.awaitEvent(Realtime.ERROR);
        check(err != null && "BAD_NONCE".equals(d(err).get("code")), "bad nonce rejected");

        // bad signature: right nonce, garbage sig
        Peer mal2 = new Peer("Mallory2");
        mal2.connect();
        mal2.awaitEvent(Realtime.CONNECTION_NONCE);
        mal2.announceBadSig();
        Map<String, Object> err2 = mal2.awaitEvent(Realtime.ERROR);
        check(err2 != null && "BAD_SIGNATURE".equals(d(err2).get("code")), "bad signature rejected");

        // stale timestamp
        Peer mal3 = new Peer("Mallory3");
        mal3.connect();
        mal3.awaitEvent(Realtime.CONNECTION_NONCE);
        mal3.announceStale();
        Map<String, Object> err3 = mal3.awaitEvent(Realtime.ERROR);
        check(err3 != null && "STALE_TIMESTAMP".equals(d(err3).get("code")), "stale timestamp rejected");

        // ping/pong
        alice.sendRaw("{\"t\":\"$ping\"}");
        check(alice.awaitRawContaining("$pong", 1000), "ping → pong");

        // sending before announce → NOT_READY
        Peer quiet = new Peer("Quiet");
        quiet.connect();
        quiet.awaitEvent(Realtime.CONNECTION_NONCE);
        quiet.channelSend("somechan", "box", "ct", "n");
        check(quiet.awaitAck(false), "send before announce → ack ok=false");

        alice.closeConn();
        bob.closeConn();
        mal.closeConn();
        mal2.closeConn();
        mal3.closeConn();
        quiet.closeConn();
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> d(Map<String, Object> frame) {
        return (Map<String, Object>) frame.get("d");
    }

    // ── Peer: a WebSocket client with a real Ed25519 identity ─────────

    static final class Peer {
        final String name;
        final KeyPair signKp;
        final String signPub;
        final String boxPub; // a second random base58 key (relay only checks length)
        WebSocket ws;
        final LinkedBlockingQueue<String> inbox = new LinkedBlockingQueue<>();
        volatile String currentNonce;
        StringBuilder partial = new StringBuilder();

        Peer(String name) throws Exception {
            this.name = name;
            this.signKp = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
            this.signPub = Base58.encode(rawEd(signKp));
            byte[] box = new byte[32];
            new java.security.SecureRandom().nextBytes(box);
            this.boxPub = Base58.encode(box);
        }

        void connect() throws Exception {
            ws = http.newWebSocketBuilder().buildAsync(URI.create(wsBase), new WebSocket.Listener() {
                @Override public CompletionStage<?> onText(WebSocket w, CharSequence data, boolean last) {
                    partial.append(data);
                    if (last) {
                        inbox.offer(partial.toString());
                        partial = new StringBuilder();
                    }
                    w.request(1);
                    return null;
                }
            }).get(5, TimeUnit.SECONDS);
        }

        void announce() throws Exception { announceInternal(currentNonce, false, false, 0); }
        void announceWithNonce(String nonce) throws Exception { announceInternal(nonce, false, false, 0); }
        void announceBadSig() throws Exception { announceInternal(currentNonce, true, false, 0); }
        void announceStale() throws Exception {
            announceInternal(currentNonce, false, true, System.currentTimeMillis() - 10L * 60 * 1000);
        }

        void announceInternal(String nonce, boolean badSig, boolean stale, long forcedTs) throws Exception {
            long ts = stale ? forcedTs : System.currentTimeMillis();
            String signed = nonce + "|" + boxPub + "|" + name + "|" + ts;
            String sig;
            if (badSig) {
                byte[] garbage = new byte[64];
                sig = Base58.encode(garbage);
            } else {
                Signature s = Signature.getInstance("Ed25519");
                s.initSign(signKp.getPrivate());
                s.update(signed.getBytes(StandardCharsets.UTF_8));
                sig = Base58.encode(s.sign());
            }
            sendRaw(Json.write(Json.obj("t", Realtime.SESSION_ANNOUNCE, "d", Json.obj(
                "signingPublicKey", signPub, "boxPublicKey", boxPub, "displayName", name,
                "ts", ts, "sig", sig, "nonce", nonce))));
        }

        void join(String channelId) throws Exception {
            sendRaw(Json.write(Json.obj("t", Realtime.CHANNEL_JOIN, "d", Json.obj(
                "channelId", channelId, "joinSig", "joinsig-" + name, "joinTs", System.currentTimeMillis()))));
        }

        void leave(String channelId) throws Exception {
            sendRaw(Json.write(Json.obj("t", Realtime.CHANNEL_LEAVE, "d", Json.obj("channelId", channelId))));
        }

        void channelSend(String channelId, String toBox, String ct, String nonce) throws Exception {
            sendRaw(Json.write(Json.obj("t", Realtime.CHANNEL_SEND, "id", 1L, "d", Json.obj(
                "channelId", channelId,
                "recipients", Json.arr(Json.obj("boxPublicKey", toBox, "ciphertext", ct, "nonce", nonce))))));
        }

        void dmSend(String toBox, String ct, String nonce, String senderSig) throws Exception {
            sendRaw(Json.write(Json.obj("t", Realtime.DM_SEND, "id", 2L, "d", Json.obj(
                "recipientBoxPublicKey", toBox, "ciphertext", ct, "nonce", nonce, "senderSig", senderSig))));
        }

        void sendRaw(String text) {
            ws.sendText(text, true).join();
        }

        /** Wait for a framed event of type `t`, capturing nonce side-effects. */
        Map<String, Object> awaitEvent(String t) throws Exception {
            return pollEvent(t, 3000);
        }

        Map<String, Object> pollEvent(String t, long timeoutMs) throws Exception {
            long deadline = System.currentTimeMillis() + timeoutMs;
            for (;;) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) return null;
                String s = inbox.poll(remaining, TimeUnit.MILLISECONDS);
                if (s == null) return null;
                Map<String, Object> frame = obj(s);
                String ty = (String) frame.get("t");
                if (Realtime.CONNECTION_NONCE.equals(ty))
                    currentNonce = (String) ((Map<?, ?>) frame.get("d")).get("nonce");
                if (t.equals(ty))
                    return frame;
            }
        }

        boolean awaitAck(boolean wantOk) throws Exception {
            long deadline = System.currentTimeMillis() + 3000;
            for (;;) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) return false;
                String s = inbox.poll(remaining, TimeUnit.MILLISECONDS);
                if (s == null) return false;
                Map<String, Object> frame = obj(s);
                if (Realtime.ACK.equals(frame.get("t"))) {
                    Map<?, ?> dd = (Map<?, ?>) frame.get("d");
                    return Boolean.valueOf(wantOk).equals(dd.get("ok"));
                }
            }
        }

        boolean awaitRawContaining(String needle, long timeoutMs) throws Exception {
            long deadline = System.currentTimeMillis() + timeoutMs;
            for (;;) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) return false;
                String s = inbox.poll(remaining, TimeUnit.MILLISECONDS);
                if (s == null) return false;
                if (s.contains(needle)) return true;
            }
        }

        void closeConn() {
            try { ws.sendClose(WebSocket.NORMAL_CLOSURE, "bye").join(); } catch (Exception ignored) {}
        }
    }

    static byte[] rawEd(KeyPair kp) {
        EdECPublicKey pub = (EdECPublicKey) kp.getPublic();
        var pt = pub.getPoint();
        byte[] be = pt.getY().toByteArray();
        byte[] le = new byte[32];
        for (int i = 0; i < be.length && i < 32; i++)
            le[i] = be[be.length - 1 - i];
        if (pt.isXOdd())
            le[31] |= (byte) 0x80;
        return le;
    }

    // ── HTTP helpers ──────────────────────────────────────────────────

    static HttpResponse<String> get(String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create(base + path)).GET().build(),
            HttpResponse.BodyHandlers.ofString());
    }

    static HttpResponse<String> getWith(String path, String header, String value) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create(base + path)).GET()
            .header(header, value).build(), HttpResponse.BodyHandlers.ofString());
    }

    static HttpResponse<String> post(String path, String body, String pwHeader) throws Exception {
        var b = HttpRequest.newBuilder(URI.create(base + path))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body));
        if (pwHeader != null) b.header("x-community-password", pwHeader);
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    static HttpResponse<String> deleteWith(String path, String header, String value) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create(base + path)).DELETE()
            .header(header, value).build(), HttpResponse.BodyHandlers.ofString());
    }

    static Map<String, Object> obj(String json) {
        return Json.asObj(Json.parse(json));
    }
}
