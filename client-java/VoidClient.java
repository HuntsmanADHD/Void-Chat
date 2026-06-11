/*
 * VoidClient.java — headless Void Chat client core. Connects to the relay
 * over WebSocket (JDK java.net.http.WebSocket), performs the signed announce
 * handshake, joins channels, and sends/receives end-to-end encrypted channel
 * messages and DMs. Pure JDK + the seal-java crypto (Box, Ed25519Sign).
 *
 * This is the protocol + crypto engine the UI sits on. It owns the security
 * policy the relay can't enforce:
 *   - every roster member's per-channel join sig is verified (audit pt6 H8);
 *     members that fail are dropped from the local roster.
 *   - every DM's sender sig is verified over the canonical tuple (audit pt6
 *     C1) and cross-checked against the peer-binding cache before delivery.
 *   - (signingPub ↔ boxPub) bindings are learned only from verified roster
 *     members, so the relay can't re-attribute a ciphertext to another
 *     identity.
 *
 * Wire format + signed payloads mirror the TS client exactly (see
 * encryption.ts / realtime.rs), so this interoperates with existing peers.
 */
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

public final class VoidClient {
    // Wire event names (mirror Realtime.java / wire.ts)
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
    static final String ACK = "$ack";

    private static final String DM_SIG_TAG = "void/dm/v1";
    private static final String JOIN_SIG_TAG = "void/join/v1";
    private static final int MAX_CHANNEL_RECIPIENTS = 256;

    // ── Identity ──────────────────────────────────────────────────────
    public final byte[] signSecret;   // 64 bytes (seed‖pub)
    public final String signPubB58;
    public final byte[] boxSecret;    // 32 bytes
    public final String boxPubB58;
    public volatile String displayName;

    // ── Connection / state ────────────────────────────────────────────
    private final HttpClient http = HttpClient.newHttpClient();
    private volatile WebSocket ws;
    private volatile String currentNonce;
    private volatile boolean announced = false;
    private final AtomicLong ackSeq = new AtomicLong(1);
    private final StringBuilder partial = new StringBuilder();

    // Heartbeat + auto-reconnect.
    private static final long HEARTBEAT_MS = 20_000;   // relay drops at 60s idle
    private static final long RECONNECT_BASE_MS = 1_000;
    private static final long RECONNECT_MAX_MS = 30_000;
    private volatile String wsUri;
    private volatile boolean shouldReconnect = false;
    private volatile long reconnectDelayMs = RECONNECT_BASE_MS;
    private volatile boolean heartbeatStarted = false;
    /** Channels the user wants to be in — replayed on every (re)announce. */
    private final Set<String> joinedChannels = ConcurrentHashMap.newKeySet();
    private final ScheduledExecutorService scheduler =
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "voidclient-sched");
            t.setDaemon(true);
            return t;
        });

    /** channelId → (boxPub → verified roster member) */
    private final Map<String, Map<String, Member>> rosters = new ConcurrentHashMap<>();
    /** signingPub → boxPub, learned only from verified roster members */
    private final Map<String, String> bindingSignToBox = new ConcurrentHashMap<>();
    private final Map<String, String> bindingBoxToSign = new ConcurrentHashMap<>();

    /**
     * Recently-delivered message ids (LRU-bounded), so a message delivered
     * twice — relay re-fan-out, a duplicate frame, or re-receipt around a
     * reconnect — is shown once. The relay's msgId is 128 bits of randomness,
     * unique per send, so it's a sound dedup key.
     */
    private static final int MAX_SEEN_MSG_IDS = 4096;
    private final Map<String, Boolean> seenMsgIds = java.util.Collections.synchronizedMap(
        new java.util.LinkedHashMap<>(512, 0.75f, false) {
            @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> e) {
                return size() > MAX_SEEN_MSG_IDS;
            }
        });

    private volatile Listener listener = new Listener() {};

    public interface Listener {
        default void onReady() {}
        default void onChannelMessage(String channelId, String senderName, String senderBoxPub,
                String text, String msgId, long ts) {}
        default void onDM(String senderBoxPub, String senderName, String text,
                boolean signatureValid, String msgId, long ts) {}
        default void onRoster(String channelId, List<String> memberNames) {}
        default void onError(String code, String message) {}
        default void onClosed() {}
    }

    public static final class Member {
        public final String signingPub, boxPub, displayName;
        Member(String s, String b, String d) { signingPub = s; boxPub = b; displayName = d; }
    }

    /** Use a persistent identity (keys survive restarts). */
    public VoidClient(Identity identity) {
        this.displayName = identity.displayName;
        this.signSecret = identity.signSecret;
        this.signPubB58 = identity.signPubB58;
        this.boxSecret = identity.boxSecret;
        this.boxPubB58 = identity.boxPubB58;
    }

    /** Convenience: a fresh ephemeral identity (tests / throwaway sessions). */
    public VoidClient(String displayName) {
        this(Identity.generate(displayName));
    }

    public void setListener(Listener l) {
        this.listener = l == null ? new Listener() {} : l;
    }

    // ── Connect + handshake ───────────────────────────────────────────

    /**
     * Connect to the relay ws endpoint (e.g. ws://127.0.0.1:3001/ws). Blocks
     * for the initial connection (throws if the relay is unreachable), then
     * keeps the link alive with a heartbeat and auto-reconnects with backoff
     * on any later drop — re-announcing and re-joining the channels you were
     * in. Call close() to stop.
     */
    public void connect(String wsUri) throws Exception {
        this.wsUri = wsUri;
        this.shouldReconnect = true;
        announced = false;
        ws = http.newWebSocketBuilder()
                .buildAsync(URI.create(wsUri), new WsListener())
                .get();
        startHeartbeat();
    }

    private void reconnect() {
        if (!shouldReconnect) return;
        announced = false;
        http.newWebSocketBuilder()
                .buildAsync(URI.create(wsUri), new WsListener())
                .whenComplete((w, ex) -> {
                    if (ex != null) {
                        scheduleReconnect(); // relay still down — try again
                    } else {
                        ws = w;
                        startHeartbeat();
                    }
                });
    }

    private void scheduleReconnect() {
        if (!shouldReconnect) return;
        long delay = reconnectDelayMs;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
        scheduler.schedule(this::reconnect, delay, TimeUnit.MILLISECONDS);
    }

    private void startHeartbeat() {
        if (heartbeatStarted) return;
        heartbeatStarted = true;
        scheduler.scheduleAtFixedRate(() -> {
            WebSocket w = ws;
            if (w != null && !w.isOutputClosed()) {
                try { w.sendText("{\"t\":\"" + PING + "\"}", true); } catch (RuntimeException ignored) {}
            }
        }, HEARTBEAT_MS, HEARTBEAT_MS, TimeUnit.MILLISECONDS);
    }

    private void handleDisconnect() {
        trace("handleDisconnect (wasAnnounced=" + announced + ")");
        boolean wasAnnounced = announced;
        announced = false;
        rosters.clear();           // stale after a drop; refilled on re-join
        if (wasAnnounced) listener.onClosed();
        scheduleReconnect();
    }

    private static final boolean TRACE = "1".equals(System.getenv("VOIDCLIENT_TRACE"));
    private void trace(String s) {
        if (TRACE) System.err.println((System.currentTimeMillis() % 100000) + " [" + displayName + "] " + s);
    }

    private final class WsListener implements WebSocket.Listener {
        @Override public void onOpen(WebSocket webSocket) {
            // Assign ws HERE, not after buildAsync().get() returns: the JDK can
            // deliver the first message (connection:nonce → doAnnounce → send)
            // before .get() completes, and a null ws would silently drop the
            // announce. onOpen is guaranteed to run before any onText.
            ws = webSocket;
            webSocket.request(1);
        }
        @Override public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            partial.append(data);
            if (last) {
                String msg = partial.toString();
                partial.setLength(0);
                try { dispatch(msg); } catch (RuntimeException e) { /* ignore malformed */ }
            }
            webSocket.request(1);
            return null;
        }
        @Override public void onError(WebSocket webSocket, Throwable error) {
            handleDisconnect();
        }
        @Override public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            handleDisconnect();
            return null;
        }
    }

    /** Handle one inbound wire frame. Package-private so tests can inject frames. */
    void dispatch(String text) {
        Map<String, Object> frame = Json.asObj(Json.parse(text));
        if (frame == null) return;
        String t = Json.str(frame, "t");
        if (t == null) return;
        Map<String, Object> d = Json.asObj(frame.get("d"));
        switch (t) {
            case CONNECTION_NONCE -> { trace("nonce recv"); currentNonce = Json.str(d, "nonce"); doAnnounce(); }
            case SESSION_ACK -> {
                trace("session:ack recv");
                reconnectDelayMs = RECONNECT_BASE_MS; // healthy link — reset backoff
                List<String> toFlush;
                synchronized (joinLock) {
                    announced = true;
                    toFlush = new ArrayList<>(pendingJoins);
                    pendingJoins.clear();
                }
                // Replay queued joins AND re-join channels we were in before a
                // reconnect (joinedChannels survives drops).
                for (String ch : joinedChannels)
                    if (!toFlush.contains(ch)) toFlush.add(ch);
                for (String ch : toFlush) sendJoin(ch);
                listener.onReady();
            }
            case CHANNEL_ROSTER -> onRoster(d);
            case CHANNEL_MEMBER_JOINED -> onMemberJoined(d);
            case CHANNEL_MEMBER_LEFT -> onMemberLeft(d);
            case CHANNEL_MESSAGE -> onChannelMessage(d);
            case DM_MESSAGE -> onDmMessage(d);
            case ERROR -> { trace("ERROR " + Json.str(d, "code") + ": " + Json.str(d, "message")); listener.onError(Json.str(d, "code"), Json.str(d, "message")); }
            default -> { /* $pong, $ack handled inline elsewhere; ignore */ }
        }
    }

    private void doAnnounce() {
        trace("sending announce");
        long ts = System.currentTimeMillis();
        String signed = currentNonce + "|" + boxPubB58 + "|" + displayName + "|" + ts;
        String sig = Base58.encode(Ed25519Sign.signDetached(signed.getBytes(StandardCharsets.UTF_8), signSecret));
        send(Json.obj("t", SESSION_ANNOUNCE, "d", Json.obj(
            "signingPublicKey", signPubB58,
            "boxPublicKey", boxPubB58,
            "displayName", displayName,
            "ts", ts,
            "sig", sig,
            "nonce", currentNonce)));
    }

    // ── Channels ──────────────────────────────────────────────────────

    /** Channels join()ed before the announce handshake completes, replayed on ack. */
    private final java.util.Set<String> pendingJoins = new java.util.LinkedHashSet<>();
    private final Object joinLock = new Object();

    public void join(String channelId) {
        // The relay rejects channel:join until session:announce is acked. If
        // the caller (e.g. a fast UI click) joins before we're announced,
        // queue it and replay on session:ack instead of getting NOT_READY.
        // The lock makes "check announced + queue" atomic against the ack
        // handler's "set announced + flush" — otherwise a join queued just
        // after the flush would be stranded forever (this raced across the
        // Swing and WebSocket threads).
        joinedChannels.add(channelId); // remembered across reconnects
        synchronized (joinLock) {
            if (!announced) {
                pendingJoins.add(channelId);
                return;
            }
        }
        sendJoin(channelId);
    }

    private void sendJoin(String channelId) {
        long joinTs = System.currentTimeMillis();
        String joinSig = signJoin(channelId, signPubB58, boxPubB58, joinTs);
        send(Json.obj("t", CHANNEL_JOIN, "d", Json.obj(
            "channelId", channelId, "joinSig", joinSig, "joinTs", joinTs)));
    }

    public void leave(String channelId) {
        joinedChannels.remove(channelId);
        rosters.remove(channelId);
        send(Json.obj("t", CHANNEL_LEAVE, "d", Json.obj("channelId", channelId)));
    }

    /** Seal `text` to every verified roster member of the channel and send. */
    public void sendToChannel(String channelId, String text) {
        Map<String, Member> roster = rosters.get(channelId);
        if (roster == null || roster.isEmpty()) return;
        List<Object> recipients = new ArrayList<>();
        for (Member m : roster.values()) {
            if (m.boxPub.equals(boxPubB58)) continue; // no self
            Box.Sealed sealed = Box.sealForRecipient(text, m.boxPub, boxSecret);
            if (sealed == null) continue;
            recipients.add(Json.obj("boxPublicKey", m.boxPub,
                "ciphertext", sealed.ciphertext, "nonce", sealed.nonce));
            if (recipients.size() >= MAX_CHANNEL_RECIPIENTS) break;
        }
        if (recipients.isEmpty()) return;
        send(Json.obj("t", CHANNEL_SEND, "id", ackSeq.getAndIncrement(),
            "d", Json.obj("channelId", channelId, "recipients", recipients)));
    }

    private void onRoster(Map<String, Object> d) {
        String channelId = Json.str(d, "channelId");
        List<Object> members = Json.asArr(d.get("members"));
        if (channelId == null || members == null) return;
        Map<String, Member> verified = new ConcurrentHashMap<>();
        for (Object o : members) {
            Member m = verifyRosterMember(channelId, Json.asObj(o));
            if (m != null) verified.put(m.boxPub, m);
        }
        rosters.put(channelId, verified);
        emitRoster(channelId, verified);
    }

    private void onMemberJoined(Map<String, Object> d) {
        String channelId = Json.str(d, "channelId");
        Member m = verifyRosterMember(channelId, Json.asObj(d.get("member")));
        if (m == null) return;
        rosters.computeIfAbsent(channelId, k -> new ConcurrentHashMap<>()).put(m.boxPub, m);
        emitRoster(channelId, rosters.get(channelId));
    }

    private void onMemberLeft(Map<String, Object> d) {
        String channelId = Json.str(d, "channelId");
        String signingPub = Json.str(d, "signingPublicKey");
        Map<String, Member> roster = rosters.get(channelId);
        if (roster == null || signingPub == null) return;
        roster.values().removeIf(m -> m.signingPub.equals(signingPub));
        emitRoster(channelId, roster);
    }

    /** Verify a roster member's join sig binds to THIS channel; learn binding. */
    private Member verifyRosterMember(String channelId, Map<String, Object> mo) {
        if (channelId == null || mo == null) return null;
        String signingPub = Json.str(mo, "signingPublicKey");
        String boxPub = Json.str(mo, "boxPublicKey");
        String name = Json.str(mo, "displayName");
        String joinSig = Json.str(mo, "joinSig");
        Long joinTs = Json.integer(mo, "joinTs");
        if (signingPub == null || boxPub == null || name == null || joinSig == null || joinTs == null)
            return null;
        if (!verifyJoin(channelId, signingPub, boxPub, joinTs, joinSig))
            return null; // audit pt6 H8: drop members with bad/replayed join sigs
        learnBinding(signingPub, boxPub);
        return new Member(signingPub, boxPub, name);
    }

    private void onChannelMessage(Map<String, Object> d) {
        String channelId = Json.str(d, "channelId");
        String senderBoxPub = Json.str(d, "senderBoxPublicKey");
        String senderName = Json.str(d, "senderDisplayName");
        String ct = Json.str(d, "ciphertext");
        String nonce = Json.str(d, "nonce");
        String msgId = Json.str(d, "msgId");
        long ts = orZero(Json.integer(d, "ts"));
        if (senderBoxPub == null || ct == null || nonce == null) return;
        String text = Box.openFromSender(ct, nonce, senderBoxPub, boxSecret);
        if (text == null) return;        // not for us / tampered
        if (alreadySeen(msgId)) return;  // duplicate delivery — show once
        listener.onChannelMessage(channelId, senderName, senderBoxPub, text, msgId, ts);
    }

    // ── DMs ───────────────────────────────────────────────────────────

    public void sendDM(String recipientBoxPubB58, String text) {
        Box.Sealed sealed = Box.sealForRecipient(text, recipientBoxPubB58, boxSecret);
        if (sealed == null) return;
        String sig = signDM(signPubB58, boxPubB58, recipientBoxPubB58, sealed.nonce, sealed.ciphertext);
        send(Json.obj("t", DM_SEND, "id", ackSeq.getAndIncrement(), "d", Json.obj(
            "recipientBoxPublicKey", recipientBoxPubB58,
            "ciphertext", sealed.ciphertext,
            "nonce", sealed.nonce,
            "senderSig", sig)));
    }

    private void onDmMessage(Map<String, Object> d) {
        String senderBoxPub = Json.str(d, "senderBoxPublicKey");
        String senderSignPub = Json.str(d, "senderSigningPublicKey");
        String senderName = Json.str(d, "senderDisplayName");
        String ct = Json.str(d, "ciphertext");
        String nonce = Json.str(d, "nonce");
        String senderSig = Json.str(d, "senderSig");
        String msgId = Json.str(d, "msgId");
        long ts = orZero(Json.integer(d, "ts"));
        if (senderBoxPub == null || ct == null || nonce == null) return;
        String text = Box.openFromSender(ct, nonce, senderBoxPub, boxSecret);
        if (text == null) return;
        if (alreadySeen(msgId)) return; // duplicate delivery — show once
        // audit pt6 C1: verify the sender sig binds signing↔box↔this message,
        // and that (signingPub,boxPub) matches a binding we learned from a
        // verified roster (so the relay can't re-attribute the ciphertext).
        boolean sigOk = senderSig != null && senderSignPub != null
                && verifyDM(senderSignPub, senderBoxPub, boxPubB58, nonce, ct, senderSig)
                && senderBoxPub.equals(bindingSignToBox.get(senderSignPub));
        listener.onDM(senderBoxPub, senderName, text, sigOk, msgId, ts);
    }

    /** True if msgId was already delivered; records it as seen otherwise. */
    private boolean alreadySeen(String msgId) {
        if (msgId == null) return false; // no id → can't dedup, deliver it
        synchronized (seenMsgIds) {
            if (seenMsgIds.containsKey(msgId)) return true;
            seenMsgIds.put(msgId, Boolean.TRUE);
            return false;
        }
    }

    private static long orZero(Long v) { return v == null ? 0L : v; }

    // ── Signature payloads (mirror encryption.ts byte-for-byte) ───────

    private String signJoin(String channelId, String signPub, String boxPub, long joinTs) {
        String canonical = String.join("|", JOIN_SIG_TAG, channelId, signPub, boxPub, String.valueOf(joinTs));
        return Base58.encode(Ed25519Sign.signDetached(canonical.getBytes(StandardCharsets.UTF_8), signSecret));
    }

    private boolean verifyJoin(String channelId, String signPub, String boxPub, long joinTs, String sigB58) {
        String canonical = String.join("|", JOIN_SIG_TAG, channelId, signPub, boxPub, String.valueOf(joinTs));
        byte[] sig = Base58.decode(sigB58);
        byte[] pub = Base58.decode(signPub);
        if (sig == null || pub == null) return false;
        return Ed25519Sign.verifyDetached(canonical.getBytes(StandardCharsets.UTF_8), sig, pub);
    }

    private String signDM(String signPub, String boxPub, String recipBoxPub, String nonceB64, String ctB64) {
        String canonical = String.join("|", DM_SIG_TAG, signPub, boxPub, recipBoxPub, nonceB64, ctB64);
        return Base58.encode(Ed25519Sign.signDetached(canonical.getBytes(StandardCharsets.UTF_8), signSecret));
    }

    private boolean verifyDM(String signPub, String boxPub, String recipBoxPub,
            String nonceB64, String ctB64, String sigB58) {
        String canonical = String.join("|", DM_SIG_TAG, signPub, boxPub, recipBoxPub, nonceB64, ctB64);
        byte[] sig = Base58.decode(sigB58);
        byte[] pub = Base58.decode(signPub);
        if (sig == null || pub == null) return false;
        return Ed25519Sign.verifyDetached(canonical.getBytes(StandardCharsets.UTF_8), sig, pub);
    }

    private void learnBinding(String signingPub, String boxPub) {
        bindingSignToBox.put(signingPub, boxPub);
        bindingBoxToSign.put(boxPub, signingPub);
    }

    private void emitRoster(String channelId, Map<String, Member> roster) {
        List<String> names = new ArrayList<>();
        for (Member m : roster.values()) names.add(m.displayName);
        listener.onRoster(channelId, names);
    }

    private void send(Object frame) {
        WebSocket w = ws;
        if (w != null) w.sendText(Json.write(frame), true);
    }

    public boolean isAnnounced() { return announced; }

    /** Snapshot of the verified roster members for a channel (for the UI). */
    public List<Member> rosterOf(String channelId) {
        Map<String, Member> r = rosters.get(channelId);
        return r == null ? List.of() : new ArrayList<>(r.values());
    }

    public void close() {
        shouldReconnect = false;        // stop the reconnect loop
        scheduler.shutdownNow();        // stop heartbeat
        WebSocket w = ws;
        if (w != null) w.sendClose(WebSocket.NORMAL_CLOSURE, "bye");
    }
}
