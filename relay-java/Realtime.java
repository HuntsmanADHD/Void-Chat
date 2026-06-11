/*
 * Realtime.java — raw-WebSocket realtime layer, faithful port of
 * realtime.rs. The relay holds NO persistent state here: connect, verify a
 * signed announce against a server-issued nonce, fan out per-recipient
 * ciphertexts, drop everything on disconnect.
 *
 * Wire transport (one JSON text frame per WS message):
 *   c → s:  { "t": "<event>", "d": <payload>, "id"?: <number> }
 *   s → c:  { "t": "<event>", "d": <payload> }
 *   ack:    { "t": "$ack", "id": <number>, "d": { "ok": bool, "error"?: str } }
 *   beat:   c → s { "t": "$ping" }   s → c { "t": "$pong" }
 * Event names are unchanged from the Rust/TS contract.
 *
 * Concurrency: one big lock over the shared maps (Inner). Broadcasts collect
 * the target sockets' WebSocket handles under the lock, release it, then
 * send — never holding the lock across a send (matches realtime.rs).
 */
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

public final class Realtime implements WebSocket.Listener {
    // Wire event names (mirror src/types/wire.ts)
    static final String CONNECTION_NONCE = "connection:nonce";
    static final String SESSION_ACK = "session:ack";
    static final String CHANNEL_ROSTER = "channel:roster";
    static final String CHANNEL_MEMBER_JOINED = "channel:member-joined";
    static final String CHANNEL_MEMBER_LEFT = "channel:member-left";
    static final String CHANNEL_MESSAGE = "channel:message";
    static final String DM_MESSAGE = "dm:message";
    static final String ERROR = "wire:error";
    static final String SESSION_ANNOUNCE = "session:announce";
    static final String CHANNEL_JOIN = "channel:join";
    static final String CHANNEL_LEAVE = "channel:leave";
    static final String CHANNEL_SEND = "channel:send";
    static final String DM_SEND = "dm:send";
    static final String PING = "$ping";
    static final String PONG = "$pong";
    static final String ACK = "$ack";

    // Tunables (preserved from realtime.rs)
    private static final long ANNOUNCE_MAX_SKEW_MS = 5L * 60 * 1000;
    private static final int MAX_CIPHERTEXT_BYTES = 96 * 1024;
    private static final long RATE_WINDOW_MS = 60_000;
    private static final int RATE_MAX_MESSAGES = 120;
    private static final int RATE_MAX_JOINS = 60;
    private static final int MAX_CHANNEL_RECIPIENTS = 256;
    private static final int MAX_RATE_BUCKETS = 50_000;
    private static final int MAX_CHANNELS = 10_000;
    private static final int MAX_MEMBERS_PER_CHANNEL = 1_000;
    private static final long SOCKET_NONCE_TTL_MS = 5L * 60 * 1000;
    private static final long IDLE_CHANNEL_TTL_MS = 24L * 60 * 60 * 1000;
    private static final int MAX_BAD_ANNOUNCES_PER_SOCKET = 5;
    private static final long BAD_ANNOUNCE_WINDOW_MS = 5L * 60 * 1000;

    private final java.security.SecureRandom rng = new java.security.SecureRandom();
    private final AtomicLong connSeq = new AtomicLong(1);

    // ── Shared state (guarded by `lock`) ──────────────────────────────
    private final Object lock = new Object();
    private final Map<String, Session> sessions = new HashMap<>();
    private final Map<String, NonceEntry> nonces = new HashMap<>();
    private final Map<String, Map<String, RosterMember>> channelRosters = new HashMap<>();
    private final Map<String, Long> lastChannelActivity = new HashMap<>();
    private final Map<String, RateBucket> rateBuckets = new HashMap<>();
    private final Map<String, BadAnnounce> badAnnounceCounts = new HashMap<>();
    private final Map<String, WebSocket> conns = new HashMap<>();
    private final Map<String, Set<String>> boxRooms = new HashMap<>();
    // conn id is held per WebSocket via this side map (WebSocket has no user slot)
    private final Map<WebSocket, String> connIds = new HashMap<>();

    public Realtime() {
        startSweeper();
    }

    // ── WebSocket.Listener ────────────────────────────────────────────

    @Override
    public void onOpen(WebSocket ws) {
        String id = "c" + connSeq.getAndIncrement();
        String nonce = issueNonce();
        synchronized (lock) {
            connIds.put(ws, id);
            conns.put(id, ws);
            nonces.put(id, new NonceEntry(nonce, now()));
        }
        emit(ws, CONNECTION_NONCE, Json.obj("nonce", nonce));
    }

    @Override
    public void onText(WebSocket ws, String text) {
        Map<String, Object> frame;
        try {
            frame = Json.asObj(Json.parse(text));
        } catch (Json.JsonException e) {
            return;
        }
        if (frame == null)
            return;
        String t = Json.str(frame, "t");
        if (t == null)
            return;
        Object d = frame.get("d");
        Long ackId = Json.integer(frame, "id");
        switch (t) {
            case PING -> ws.send("{\"t\":\"" + PONG + "\"}");
            case SESSION_ANNOUNCE -> onAnnounce(ws, Json.asObj(d));
            case CHANNEL_JOIN -> onJoin(ws, Json.asObj(d));
            case CHANNEL_LEAVE -> onLeave(ws, Json.asObj(d));
            case CHANNEL_SEND -> onChannelSend(ws, Json.asObj(d), ackId);
            case DM_SEND -> onDmSend(ws, Json.asObj(d), ackId);
            default -> { /* unknown event — ignore */ }
        }
    }

    @Override
    public void onClose(WebSocket ws) {
        onDisconnect(ws);
    }

    // ── Announce ──────────────────────────────────────────────────────

    private void onAnnounce(WebSocket ws, Map<String, Object> d) {
        String id = connId(ws);
        if (id == null || d == null) {
            failAnnounce(ws, "INVALID_PAYLOAD", "malformed announce", null);
            return;
        }
        // strict shape: exactly these fields, all the right types
        String signingPub = Json.str(d, "signingPublicKey");
        String boxPub = Json.str(d, "boxPublicKey");
        String displayName = Json.str(d, "displayName");
        Long ts = Json.integer(d, "ts");
        String sig = Json.str(d, "sig");
        String nonce = Json.str(d, "nonce");
        if (signingPub == null || boxPub == null || displayName == null
                || ts == null || sig == null || nonce == null
                || d.size() != 6) {
            failAnnounce(ws, "INVALID_PAYLOAD", "malformed announce", null);
            return;
        }

        long nowMs = System.currentTimeMillis();
        // Reject negative ts first: a ts of Long.MIN_VALUE makes (nowMs - ts)
        // overflow and Math.abs() return a negative value, slipping past the
        // skew check. Non-negative ts can't overflow the subtraction here.
        if (ts < 0 || Math.abs(nowMs - ts) > ANNOUNCE_MAX_SKEW_MS) {
            failAnnounce(ws, "STALE_TIMESTAMP", "announce timestamp out of skew window", null);
            return;
        }

        byte[] signBytes = Base58.decode(signingPub);
        if (signBytes == null || signBytes.length != 32) {
            failAnnounce(ws, "INVALID_PAYLOAD", "malformed public key", null);
            return;
        }
        byte[] boxBytes = Base58.decode(boxPub);
        if (boxBytes == null || boxBytes.length != 32) {
            failAnnounce(ws, "INVALID_PAYLOAD", "malformed public key", null);
            return;
        }
        String claimedBox = boxPub;

        String expected;
        synchronized (lock) {
            NonceEntry n = nonces.get(id);
            expected = n == null ? null : n.nonce;
        }
        if (expected == null) {
            failAnnounce(ws, "BAD_NONCE", "no nonce issued for this socket", claimedBox);
            return;
        }
        if (!MessageDigest.isEqual(nonce.getBytes(StandardCharsets.UTF_8),
                expected.getBytes(StandardCharsets.UTF_8))) {
            failAnnounce(ws, "BAD_NONCE", "nonce mismatch", claimedBox);
            return;
        }

        String signed = nonce + "|" + boxPub + "|" + displayName + "|" + ts;
        byte[] sigBytes = Base58.decode(sig);
        if (sigBytes == null || sigBytes.length != 64
                || !Ed25519Verify.verify(signBytes, signed.getBytes(StandardCharsets.UTF_8), sigBytes)) {
            failAnnounce(ws, "BAD_SIGNATURE", "announce signature invalid", claimedBox);
            return;
        }

        // Display-name policy — reject, never mutate (the sig covers the
        // original bytes; trimming would break peer roster verification).
        if (displayName.isEmpty()) {
            failAnnounce(ws, "INVALID_PAYLOAD",
                "displayName must be non-empty — clients pick a name and sign it", null);
            return;
        }
        if (displayName.codePointCount(0, displayName.length()) > 32) {
            failAnnounce(ws, "INVALID_PAYLOAD",
                "displayName too long — clients must trim and sign the trimmed value", null);
            return;
        }

        Session info = new Session(signingPub, boxPub, displayName, nonce, ts, sig);
        synchronized (lock) {
            Session prior = sessions.get(id);
            if (prior != null && !prior.boxPublicKey.equals(info.boxPublicKey)) {
                Set<String> set = boxRooms.get(prior.boxPublicKey);
                if (set != null) {
                    set.remove(id);
                    if (set.isEmpty())
                        boxRooms.remove(prior.boxPublicKey);
                }
            }
            sessions.put(id, info);
            nonces.remove(id);
            boxRooms.computeIfAbsent(info.boxPublicKey, k -> new HashSet<>()).add(id);
        }
        emit(ws, SESSION_ACK, Json.obj("ok", true));
    }

    // ── Channel join / leave ──────────────────────────────────────────

    private void onJoin(WebSocket ws, Map<String, Object> d) {
        String id = connId(ws);
        Session session = sessionOf(id);
        if (session == null) {
            sendError(ws, "NOT_READY", "announce before joining");
            return;
        }
        if (d == null) {
            sendError(ws, "INVALID_PAYLOAD", "channelId required");
            return;
        }
        String channelId = Json.str(d, "channelId");
        String joinSig = Json.str(d, "joinSig");
        Long joinTs = Json.integer(d, "joinTs");
        if (channelId == null || joinSig == null || joinTs == null || d.size() != 3) {
            sendError(ws, "INVALID_PAYLOAD", "channelId required");
            return;
        }
        if (!rateAllowed(session.boxPublicKey, RateKind.JOIN)) {
            sendError(ws, "RATE_LIMITED", "too many joins, slow down");
            return;
        }

        List<RosterMember> snapshot;
        RosterMember broadcastMember;
        boolean wasNew;
        synchronized (lock) {
            Map<String, RosterMember> roster = channelRosters.get(channelId);
            if (roster == null) {
                if (channelRosters.size() >= MAX_CHANNELS) {
                    sendError(ws, "RATE_LIMITED", "relay is at channel capacity — retry later");
                    return;
                }
                roster = new HashMap<>();
                channelRosters.put(channelId, roster);
            }
            boolean alreadyIn = roster.containsKey(id);
            if (!alreadyIn && roster.size() >= MAX_MEMBERS_PER_CHANNEL) {
                sendError(ws, "RATE_LIMITED", "channel is full — retry later");
                return;
            }
            RosterMember member = new RosterMember(session, joinSig, joinTs);
            roster.put(id, member);
            lastChannelActivity.put(channelId, now());
            snapshot = new ArrayList<>(roster.values());
            broadcastMember = member;
            wasNew = !alreadyIn;
        }

        emit(ws, CHANNEL_ROSTER, Json.obj(
            "channelId", channelId, "members", membersJson(snapshot)));
        if (wasNew) {
            String frame = frame(CHANNEL_MEMBER_JOINED, Json.obj(
                "channelId", channelId, "member", memberJson(broadcastMember)));
            emitToChannel(channelId, id, frame);
        }
    }

    private void onLeave(WebSocket ws, Map<String, Object> d) {
        String id = connId(ws);
        Session session = sessionOf(id);
        if (session == null || d == null)
            return;
        String channelId = Json.str(d, "channelId");
        if (channelId == null)
            return;

        boolean wasIn;
        synchronized (lock) {
            Map<String, RosterMember> roster = channelRosters.get(channelId);
            if (roster == null)
                return;
            wasIn = roster.remove(id) != null;
            if (roster.isEmpty())
                channelRosters.remove(channelId);
        }
        if (!wasIn)
            return;
        emitToChannel(channelId, id, frame(CHANNEL_MEMBER_LEFT, Json.obj(
            "channelId", channelId, "signingPublicKey", session.signingPublicKey)));
    }

    // ── Channel send ──────────────────────────────────────────────────

    private void onChannelSend(WebSocket ws, Map<String, Object> d, Long ackId) {
        String id = connId(ws);
        Session session = sessionOf(id);
        if (session == null) {
            sendError(ws, "NOT_READY", "announce before sending");
            ack(ws, ackId, false, "NOT_READY");
            return;
        }
        if (d == null) {
            sendError(ws, "INVALID_PAYLOAD", "malformed channel:send");
            ack(ws, ackId, false, "INVALID_PAYLOAD");
            return;
        }
        String channelId = Json.str(d, "channelId");
        List<Object> recipients = Json.asArr(d.get("recipients"));
        if (channelId == null || recipients == null || d.size() != 2) {
            sendError(ws, "INVALID_PAYLOAD", "malformed channel:send");
            ack(ws, ackId, false, "INVALID_PAYLOAD");
            return;
        }
        if (recipients.isEmpty() || recipients.size() > MAX_CHANNEL_RECIPIENTS) {
            sendError(ws, "INVALID_PAYLOAD", "malformed channel:send");
            ack(ws, ackId, false, "INVALID_PAYLOAD");
            return;
        }
        // Parse + validate each recipient (strict shape).
        List<Recipient> recs = new ArrayList<>();
        for (Object o : recipients) {
            Map<String, Object> r = Json.asObj(o);
            if (r == null) { ackBadChannel(ws, ackId); return; }
            String bp = Json.str(r, "boxPublicKey");
            String ct = Json.str(r, "ciphertext");
            String nc = Json.str(r, "nonce");
            if (bp == null || ct == null || nc == null || r.size() != 3) {
                ackBadChannel(ws, ackId);
                return;
            }
            if (utf8Len(ct) > MAX_CIPHERTEXT_BYTES) {
                sendError(ws, "INVALID_PAYLOAD", "recipient ciphertext too large");
                ack(ws, ackId, false, "INVALID_PAYLOAD");
                return;
            }
            recs.add(new Recipient(bp, ct, nc));
        }

        Set<String> allowedBoxes;
        synchronized (lock) {
            Map<String, RosterMember> roster = channelRosters.get(channelId);
            if (roster == null || !roster.containsKey(id)) {
                sendError(ws, "NOT_IN_CHANNEL", "join the channel before sending");
                ack(ws, ackId, false, "NOT_IN_CHANNEL");
                return;
            }
            if (!rateAllowedLocked(session.boxPublicKey, RateKind.MESSAGE)) {
                sendError(ws, "RATE_LIMITED", "message rate exceeded");
                ack(ws, ackId, false, "RATE_LIMITED");
                return;
            }
            allowedBoxes = new HashSet<>();
            for (RosterMember m : roster.values())
                allowedBoxes.add(m.boxPublicKey);
            lastChannelActivity.put(channelId, now());
        }

        String msgId = makeMsgId();
        long ts = System.currentTimeMillis();
        Set<String> sentTo = new HashSet<>();
        for (Recipient rec : recs) {
            if (rec.boxPublicKey.equals(session.boxPublicKey))
                continue; // no self-echo
            if (!allowedBoxes.contains(rec.boxPublicKey))
                continue; // not in roster — no pubkey-presence oracle
            if (!sentTo.add(rec.boxPublicKey))
                continue; // dedupe (audit pt6 H5)
            String frame = frame(CHANNEL_MESSAGE, Json.obj(
                "channelId", channelId,
                "senderBoxPublicKey", session.boxPublicKey,
                "senderSigningPublicKey", session.signingPublicKey,
                "senderDisplayName", session.displayName,
                "ciphertext", rec.ciphertext,
                "nonce", rec.nonce,
                "msgId", msgId,
                "ts", ts));
            emitToBox(rec.boxPublicKey, id, frame);
        }
        ack(ws, ackId, true, null);
    }

    private void ackBadChannel(WebSocket ws, Long ackId) {
        sendError(ws, "INVALID_PAYLOAD", "malformed channel:send");
        ack(ws, ackId, false, "INVALID_PAYLOAD");
    }

    // ── DM send ───────────────────────────────────────────────────────

    private void onDmSend(WebSocket ws, Map<String, Object> d, Long ackId) {
        String id = connId(ws);
        Session session = sessionOf(id);
        if (session == null) {
            sendError(ws, "NOT_READY", "announce before sending");
            ack(ws, ackId, false, "NOT_READY");
            return;
        }
        if (d == null) {
            sendError(ws, "INVALID_PAYLOAD", "malformed dm:send");
            ack(ws, ackId, false, "INVALID_PAYLOAD");
            return;
        }
        String recipientBox = Json.str(d, "recipientBoxPublicKey");
        String ciphertext = Json.str(d, "ciphertext");
        String nonce = Json.str(d, "nonce");
        String senderSig = Json.str(d, "senderSig");
        if (recipientBox == null || ciphertext == null || nonce == null
                || senderSig == null || d.size() != 4) {
            sendError(ws, "INVALID_PAYLOAD", "malformed dm:send");
            ack(ws, ackId, false, "INVALID_PAYLOAD");
            return;
        }
        if (utf8Len(ciphertext) > MAX_CIPHERTEXT_BYTES) {
            sendError(ws, "INVALID_PAYLOAD", "ciphertext too large");
            ack(ws, ackId, false, "INVALID_PAYLOAD");
            return;
        }
        if (!rateAllowed(session.boxPublicKey, RateKind.MESSAGE)) {
            sendError(ws, "RATE_LIMITED", "message rate exceeded");
            ack(ws, ackId, false, "RATE_LIMITED");
            return;
        }
        // Audit pt5 M1: never signal recipient presence. Always ack ok=true;
        // a broadcast to an empty box-room is a no-op.
        String frame = frame(DM_MESSAGE, Json.obj(
            "senderBoxPublicKey", session.boxPublicKey,
            "senderSigningPublicKey", session.signingPublicKey,
            "senderDisplayName", session.displayName,
            "ciphertext", ciphertext,
            "nonce", nonce,
            "msgId", makeMsgId(),
            "ts", System.currentTimeMillis(),
            "senderSig", senderSig));
        emitToBox(recipientBox, id, frame);
        ack(ws, ackId, true, null);
    }

    // ── Disconnect ────────────────────────────────────────────────────

    private void onDisconnect(WebSocket ws) {
        String id = connId(ws);
        if (id == null)
            return;
        Session session;
        List<String> memberLeftBroadcasts = new ArrayList<>();
        synchronized (lock) {
            connIds.remove(ws);
            conns.remove(id);
            session = sessions.remove(id);
            nonces.remove(id);
            badAnnounceCounts.remove("sock:" + id);
            if (session == null)
                return;

            Set<String> set = boxRooms.get(session.boxPublicKey);
            if (set != null) {
                set.remove(id);
                if (set.isEmpty())
                    boxRooms.remove(session.boxPublicKey);
            }

            List<String> emptied = new ArrayList<>();
            for (Map.Entry<String, Map<String, RosterMember>> e : channelRosters.entrySet()) {
                if (e.getValue().remove(id) == null)
                    continue;
                boolean identityStillPresent = e.getValue().values().stream()
                        .anyMatch(m -> m.signingPublicKey.equals(session.signingPublicKey));
                if (!identityStillPresent)
                    memberLeftBroadcasts.add(e.getKey());
                if (e.getValue().isEmpty())
                    emptied.add(e.getKey());
            }
            for (String c : emptied)
                channelRosters.remove(c);
        }
        for (String channelId : memberLeftBroadcasts) {
            emitToChannel(channelId, id, frame(CHANNEL_MEMBER_LEFT, Json.obj(
                "channelId", channelId, "signingPublicKey", session.signingPublicKey)));
        }
    }

    // ── Broadcast helpers (collect under lock, send after) ────────────

    private void emitToBox(String boxPub, String exclude, String frame) {
        List<WebSocket> targets = new ArrayList<>();
        synchronized (lock) {
            Set<String> set = boxRooms.get(boxPub);
            if (set == null)
                return;
            for (String cid : set) {
                if (cid.equals(exclude))
                    continue;
                WebSocket w = conns.get(cid);
                if (w != null)
                    targets.add(w);
            }
        }
        for (WebSocket w : targets)
            w.send(frame);
    }

    private void emitToChannel(String channelId, String exclude, String frame) {
        List<WebSocket> targets = new ArrayList<>();
        synchronized (lock) {
            Map<String, RosterMember> roster = channelRosters.get(channelId);
            if (roster == null)
                return;
            for (String cid : roster.keySet()) {
                if (cid.equals(exclude))
                    continue;
                WebSocket w = conns.get(cid);
                if (w != null)
                    targets.add(w);
            }
        }
        for (WebSocket w : targets)
            w.send(frame);
    }

    // ── Bad-announce bouncer ──────────────────────────────────────────

    private void failAnnounce(WebSocket ws, String code, String message, String claimedBox) {
        sendError(ws, code, message);
        String id = connId(ws);
        boolean shouldDisconnect;
        synchronized (lock) {
            String bucketKey = (claimedBox != null && !claimedBox.isEmpty() && claimedBox.length() <= 128)
                    ? "box:" + claimedBox
                    : "sock:" + id;
            long nowMs = now();
            BadAnnounce entry = badAnnounceCounts.computeIfAbsent(bucketKey, k -> new BadAnnounce(nowMs));
            if (nowMs - entry.windowStart > BAD_ANNOUNCE_WINDOW_MS) {
                entry.count = 0;
                entry.windowStart = nowMs;
            }
            entry.count++;
            shouldDisconnect = entry.count >= MAX_BAD_ANNOUNCES_PER_SOCKET;
        }
        if (shouldDisconnect)
            ws.close();
    }

    // ── Rate limiting ─────────────────────────────────────────────────

    private enum RateKind { MESSAGE, JOIN }

    private boolean rateAllowed(String key, RateKind kind) {
        synchronized (lock) {
            return rateAllowedLocked(key, kind);
        }
    }

    private boolean rateAllowedLocked(String key, RateKind kind) {
        long nowMs = now();
        RateBucket b = rateBuckets.get(key);
        boolean fresh = b != null && nowMs - b.windowStart <= RATE_WINDOW_MS;
        if (!fresh) {
            if (rateBuckets.size() >= MAX_RATE_BUCKETS) {
                var it = rateBuckets.keySet().iterator();
                if (it.hasNext()) { it.next(); it.remove(); }
            }
            b = new RateBucket(nowMs);
            rateBuckets.put(key, b);
        }
        if (kind == RateKind.MESSAGE) {
            if (b.messages >= RATE_MAX_MESSAGES) return false;
            b.messages++;
        } else {
            if (b.joins >= RATE_MAX_JOINS) return false;
            b.joins++;
        }
        return true;
    }

    // ── GC sweeper ────────────────────────────────────────────────────

    private void startSweeper() {
        Thread.ofVirtual().name("rt-sweeper").start(() -> {
            for (;;) {
                try {
                    Thread.sleep(RATE_WINDOW_MS);
                } catch (InterruptedException e) {
                    return;
                }
                sweep();
            }
        });
    }

    private void sweep() {
        synchronized (lock) {
            long nowMs = now();
            rateBuckets.values().removeIf(b -> nowMs - b.windowStart > RATE_WINDOW_MS * 2);
            nonces.values().removeIf(n -> nowMs - n.issuedAt > SOCKET_NONCE_TTL_MS);
            List<String> idle = new ArrayList<>();
            for (Map.Entry<String, Long> e : lastChannelActivity.entrySet())
                if (nowMs - e.getValue() > IDLE_CHANNEL_TTL_MS)
                    idle.add(e.getKey());
            for (String k : idle) {
                channelRosters.remove(k);
                lastChannelActivity.remove(k);
            }
            badAnnounceCounts.values().removeIf(e -> nowMs - e.windowStart > BAD_ANNOUNCE_WINDOW_MS);
        }
    }

    // ── Small helpers ─────────────────────────────────────────────────

    private String connId(WebSocket ws) {
        synchronized (lock) {
            return connIds.get(ws);
        }
    }

    private Session sessionOf(String id) {
        if (id == null)
            return null;
        synchronized (lock) {
            return sessions.get(id);
        }
    }

    private void emit(WebSocket ws, String event, Object payload) {
        ws.send(frame(event, payload));
    }

    private void sendError(WebSocket ws, String code, String message) {
        emit(ws, ERROR, Json.obj("code", code, "message", message));
    }

    private void ack(WebSocket ws, Long ackId, boolean ok, String error) {
        if (ackId == null)
            return;
        Map<String, Object> d = ok ? Json.obj("ok", true) : Json.obj("ok", false, "error", error);
        ws.send(Json.write(Json.obj("t", ACK, "id", ackId, "d", d)));
    }

    private static String frame(String event, Object payload) {
        return Json.write(Json.obj("t", event, "d", payload));
    }

    private static List<Object> membersJson(List<RosterMember> members) {
        List<Object> out = new ArrayList<>();
        for (RosterMember m : members)
            out.add(memberJson(m));
        return out;
    }

    private static Map<String, Object> memberJson(RosterMember m) {
        return Json.obj(
            "signingPublicKey", m.signingPublicKey,
            "boxPublicKey", m.boxPublicKey,
            "displayName", m.displayName,
            "announceNonce", m.announceNonce,
            "announceTs", m.announceTs,
            "sig", m.sig,
            "joinSig", m.joinSig,
            "joinTs", m.joinTs);
    }

    private String issueNonce() {
        byte[] buf = new byte[24];
        rng.nextBytes(buf);
        return hex(buf);
    }

    private String makeMsgId() {
        byte[] buf = new byte[16];
        rng.nextBytes(buf);
        return "m_" + Long.toHexString(System.currentTimeMillis()) + "_" + hex(buf);
    }

    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder(b.length * 2);
        for (byte x : b)
            s.append(Character.forDigit((x >> 4) & 0xf, 16)).append(Character.forDigit(x & 0xf, 16));
        return s.toString();
    }

    private static int utf8Len(String s) {
        return s.getBytes(StandardCharsets.UTF_8).length;
    }

    private static long now() {
        return System.currentTimeMillis();
    }

    // ── Value types ───────────────────────────────────────────────────

    private static final class Session {
        final String signingPublicKey, boxPublicKey, displayName, announceNonce, sig;
        final long announceTs;
        Session(String sp, String bp, String dn, String an, long at, String sig) {
            signingPublicKey = sp; boxPublicKey = bp; displayName = dn;
            announceNonce = an; announceTs = at; this.sig = sig;
        }
    }

    private static final class RosterMember {
        final String signingPublicKey, boxPublicKey, displayName, announceNonce, sig, joinSig;
        final long announceTs, joinTs;
        RosterMember(Session s, String joinSig, long joinTs) {
            signingPublicKey = s.signingPublicKey; boxPublicKey = s.boxPublicKey;
            displayName = s.displayName; announceNonce = s.announceNonce;
            sig = s.sig; announceTs = s.announceTs;
            this.joinSig = joinSig; this.joinTs = joinTs;
        }
    }

    private record Recipient(String boxPublicKey, String ciphertext, String nonce) {}

    private static final class NonceEntry {
        final String nonce;
        final long issuedAt;
        NonceEntry(String nonce, long issuedAt) { this.nonce = nonce; this.issuedAt = issuedAt; }
    }

    private static final class RateBucket {
        int messages = 0, joins = 0;
        long windowStart;
        RateBucket(long windowStart) { this.windowStart = windowStart; }
    }

    private static final class BadAnnounce {
        int count = 0;
        long windowStart;
        BadAnnounce(long windowStart) { this.windowStart = windowStart; }
    }
}
