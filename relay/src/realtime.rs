//! Realtime layer — raw-WebSocket port of the former socket.io server.
//! The relay holds NO persistent state for the realtime path: connect,
//! verify a signed announce against a server-issued nonce, fan out
//! per-recipient ciphertexts, drop everything on disconnect/restart.
//!
//! Wire transport (Phase 6 — replaced Engine.IO/Socket.IO framing): one
//! JSON text frame per WebSocket message.
//!   c → s:  { "t": "<event>", "d": <payload>, "id"?: <number> }
//!   s → c:  { "t": "<event>", "d": <payload> }
//!   ack:    { "t": "$ack", "id": <number>, "d": { "ok": bool, "error"?: str } }
//!   beat:   c → s { "t": "$ping" }   s → c { "t": "$pong" }
//! `<event>` strings are the existing wire names, so the TypeScript client's
//! validation schemas and handlers are unchanged. Every inbound payload (`d`)
//! still deserializes with `deny_unknown_fields` — mirrors the client's
//! `.strict()` so attackers can't tunnel unsigned data via extra fields.
//!
//! Routing model (replaces socket.io rooms, which we now own):
//!   - channel membership == the keys of `channel_rosters[channelId]` (roster
//!     insert/remove already tracks exactly who is "in" the channel),
//!   - `box_rooms[boxPublicKey]` — the conn ids registered for an identity,
//!     for DM + per-recipient channel fan-out.
//! Broadcasts collect the target conns' senders under the lock, drop the
//! guard, then send — never holding the std Mutex across a send.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Notify};
use tracing::{debug, warn};

// ── Wire event names (mirror src/types/wire.ts) ─────────────────────

pub mod wire {
    // server → client
    pub const CONNECTION_NONCE: &str = "connection:nonce";
    pub const SESSION_ACK: &str = "session:ack";
    pub const CHANNEL_ROSTER: &str = "channel:roster";
    pub const CHANNEL_MEMBER_JOINED: &str = "channel:member-joined";
    pub const CHANNEL_MEMBER_LEFT: &str = "channel:member-left";
    pub const CHANNEL_MESSAGE: &str = "channel:message";
    pub const DM_MESSAGE: &str = "dm:message";
    pub const ERROR: &str = "wire:error";
    // client → server
    pub const SESSION_ANNOUNCE: &str = "session:announce";
    pub const CHANNEL_JOIN: &str = "channel:join";
    pub const CHANNEL_LEAVE: &str = "channel:leave";
    pub const CHANNEL_SEND: &str = "channel:send";
    pub const DM_SEND: &str = "dm:send";
    // reserved (non-business) frame types
    pub const PING: &str = "$ping";
    pub const PONG: &str = "$pong";
    pub const ACK: &str = "$ack";
}

// ── Tunables (preserved from the socket.io version) ─────────────────

const ANNOUNCE_MAX_SKEW_MS: i64 = 5 * 60 * 1000;
const MAX_CIPHERTEXT_BYTES: usize = 96 * 1024;
const RATE_WINDOW_MS: u128 = 60_000;
const RATE_MAX_MESSAGES: u32 = 120;
const RATE_MAX_JOINS: u32 = 60;
const MAX_CHANNEL_RECIPIENTS: usize = 256;
const MAX_RATE_BUCKETS: usize = 50_000;
const MAX_CHANNELS: usize = 10_000;
const MAX_MEMBERS_PER_CHANNEL: usize = 1_000;
const SOCKET_NONCE_TTL_MS: u128 = 5 * 60 * 1000;
const IDLE_CHANNEL_TTL_MS: u128 = 24 * 60 * 60 * 1000;
const MAX_BAD_ANNOUNCES_PER_SOCKET: u32 = 5;
const BAD_ANNOUNCE_WINDOW_MS: u128 = 5 * 60 * 1000;

/// Drop a connection that sends no frame (not even a `$ping`) for this long.
/// The client heartbeats every ~20s, so a healthy client resets it well
/// inside the window; a dead/half-open Tor connection gets reaped.
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

// ── Shared mutable state ────────────────────────────────────────────

#[derive(Default)]
struct Inner {
    /// conn_id → session metadata captured at announce time
    sessions: HashMap<String, SessionInfo>,
    /// conn_id → server-issued nonce + when it was issued (for TTL)
    nonces: HashMap<String, NonceEntry>,
    /// channel_id → (conn_id → roster member info). The KEYS are also the
    /// channel's "room" membership — roster and routing are kept in lockstep.
    channel_rosters: HashMap<String, HashMap<String, RosterMember>>,
    /// channel_id → last activity timestamp (ms epoch) for idle GC
    last_channel_activity: HashMap<String, u128>,
    /// rate-limit bucket keyed by box_public_key
    rate_buckets: HashMap<String, RateBucket>,
    /// bad-announce counter keyed by socket/box with sliding window
    bad_announce_counts: HashMap<String, BadAnnounceEntry>,
    /// conn_id → outbound sink. The writer task drains this conn's mpsc; this
    /// map lets broadcasters reach OTHER connections.
    conns: HashMap<String, mpsc::UnboundedSender<String>>,
    /// box_public_key → set of conn_ids registered for that identity (DM +
    /// per-recipient channel fan-out). Replaces socket.io's `box:` room.
    box_rooms: HashMap<String, HashSet<String>>,
}

#[derive(Clone)]
pub struct RealtimeState {
    inner: Arc<Mutex<Inner>>,
}

impl RealtimeState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
        }
    }

    fn lock(&self) -> Option<std::sync::MutexGuard<'_, Inner>> {
        match self.inner.lock() {
            Ok(g) => Some(g),
            Err(_) => {
                warn!("realtime state mutex poisoned");
                None
            }
        }
    }
}

#[derive(Clone)]
struct SessionInfo {
    signing_public_key: String,
    box_public_key: String,
    display_name: String,
    announce_nonce: String,
    announce_ts: i64,
    sig: String,
}

struct NonceEntry {
    nonce: String,
    issued_at: u128,
}

struct RateBucket {
    messages: u32,
    joins: u32,
    window_start: u128,
}

struct BadAnnounceEntry {
    count: u32,
    window_start: u128,
}

// ── Per-connection handle ───────────────────────────────────────────

/// Lightweight handle handed to every handler in place of socket.io's
/// `SocketRef`. `tx` is this connection's own outbound sink (self-emit, no
/// lock); `close` force-disconnects the read loop; `state` is the shared map.
struct Conn {
    id: String,
    tx: mpsc::UnboundedSender<String>,
    close: Arc<Notify>,
    state: RealtimeState,
}

impl Conn {
    fn emit<T: Serialize>(&self, event: &str, payload: &T) {
        let _ = self.tx.send(frame(event, payload));
    }

    /// Server-initiated disconnect (flood bouncer). Wakes the read loop, which
    /// then runs the normal disconnect cleanup.
    fn disconnect(&self) {
        self.close.notify_one();
    }
}

// ── Wire DTOs (inbound `d` payloads) ────────────────────────────────
//
// `deny_unknown_fields` == the client's `.strict()`: reject smuggled extra
// fields adjacent to legitimate signed ones.

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SessionAnnounceIn {
    signing_public_key: String,
    box_public_key: String,
    display_name: String,
    ts: i64,
    sig: String,
    nonce: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ChannelJoinIn {
    channel_id: String,
    /// Per-channel ed25519 sig from the joiner (audit pt6 H8). The relay never
    /// inspects it — forwards verbatim in roster broadcasts for clients to
    /// verify it binds to the channel they're rendering.
    join_sig: String,
    join_ts: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ChannelLeaveIn {
    channel_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ChannelRecipientIn {
    box_public_key: String,
    ciphertext: String,
    nonce: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ChannelSendIn {
    channel_id: String,
    recipients: Vec<ChannelRecipientIn>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DmSendIn {
    recipient_box_public_key: String,
    ciphertext: String,
    nonce: String,
    /// Per-message ed25519 sig from the sender (audit pt6 C1). Forwarded
    /// unchanged for the receiver to verify; the relay never inspects it.
    sender_sig: String,
}

// ── Outbound payloads ────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RosterMember {
    signing_public_key: String,
    box_public_key: String,
    display_name: String,
    announce_nonce: String,
    announce_ts: i64,
    sig: String,
    join_sig: String,
    join_ts: i64,
}

#[derive(Serialize)]
struct ConnectionNoncePayload {
    nonce: String,
}

#[derive(Serialize)]
struct SessionAckPayload {
    ok: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelRosterPayload {
    channel_id: String,
    members: Vec<RosterMember>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelMemberJoinedPayload {
    channel_id: String,
    member: RosterMember,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelMemberLeftPayload {
    channel_id: String,
    signing_public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelMessagePayload {
    channel_id: String,
    sender_box_public_key: String,
    sender_signing_public_key: String,
    sender_display_name: String,
    ciphertext: String,
    nonce: String,
    msg_id: String,
    ts: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DmMessagePayload {
    sender_box_public_key: String,
    sender_signing_public_key: String,
    sender_display_name: String,
    ciphertext: String,
    nonce: String,
    msg_id: String,
    ts: i64,
    /// Forwarded verbatim from the sender's `dm:send`. See `DmSendIn::sender_sig`.
    sender_sig: String,
}

#[derive(Serialize)]
struct WireErrorPayload<'a> {
    code: &'a str,
    message: &'a str,
}

#[derive(Serialize)]
struct AckResp {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ── Envelope framing ────────────────────────────────────────────────

#[derive(Serialize)]
struct OutFrame<'a, T: Serialize> {
    t: &'a str,
    d: &'a T,
}

/// Serialize an event payload into the outbound `{t,d}` envelope.
fn frame<T: Serialize>(event: &str, payload: &T) -> String {
    serde_json::to_string(&OutFrame { t: event, d: payload }).unwrap_or_else(|_| "{}".to_string())
}

#[derive(Serialize)]
struct AckFrame<'a> {
    t: &'a str,
    id: u64,
    d: AckResp,
}

/// Inbound envelope. Unknown extra top-level fields are tolerated for
/// forward-compat; the strictness lives on the inner `d` payload structs.
#[derive(Deserialize)]
struct InFrame {
    t: String,
    #[serde(default)]
    d: serde_json::Value,
    #[serde(default)]
    id: Option<u64>,
}

static CONN_SEQ: AtomicU64 = AtomicU64::new(1);

fn next_conn_id() -> String {
    format!("c{}", CONN_SEQ.fetch_add(1, Ordering::Relaxed))
}

// ── Broadcast helpers (collect-then-send) ───────────────────────────

/// Send a pre-framed message to every conn registered for `box_pub`, except
/// `exclude`. Collects senders under the lock, drops the guard, then sends.
fn emit_to_box(state: &RealtimeState, box_pub: &str, exclude: &str, frame: &str) {
    let senders: Vec<mpsc::UnboundedSender<String>> = {
        let Some(inner) = state.lock() else { return };
        let Some(set) = inner.box_rooms.get(box_pub) else {
            return;
        };
        set.iter()
            .filter(|id| id.as_str() != exclude)
            .filter_map(|id| inner.conns.get(id).cloned())
            .collect()
    };
    for s in senders {
        let _ = s.send(frame.to_string());
    }
}

/// Send a pre-framed message to every conn in `channel_id`'s roster, except
/// `exclude`. Roster keys ARE the channel's membership.
fn emit_to_channel(state: &RealtimeState, channel_id: &str, exclude: &str, frame: &str) {
    let senders: Vec<mpsc::UnboundedSender<String>> = {
        let Some(inner) = state.lock() else { return };
        let Some(roster) = inner.channel_rosters.get(channel_id) else {
            return;
        };
        roster
            .keys()
            .filter(|id| id.as_str() != exclude)
            .filter_map(|id| inner.conns.get(id).cloned())
            .collect()
    };
    for s in senders {
        let _ = s.send(frame.to_string());
    }
}

// ── Entry points ────────────────────────────────────────────────────

/// Spawn the periodic GC sweeper. The realtime transport is mounted as the
/// axum `GET /ws` route via [`ws_handler`].
pub fn build(state: RealtimeState) {
    spawn_sweeper(state);
}

/// axum handler for `GET /ws` — upgrades to a WebSocket and runs the
/// per-connection task.
pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<RealtimeState>) -> Response {
    ws.on_upgrade(move |socket| handle_conn(socket, state))
}

async fn handle_conn(socket: WebSocket, state: RealtimeState) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let id = next_conn_id();
    let close = Arc::new(Notify::new());

    if let Some(mut inner) = state.lock() {
        inner.conns.insert(id.clone(), tx.clone());
    }

    let conn = Conn {
        id: id.clone(),
        tx: tx.clone(),
        close: close.clone(),
        state: state.clone(),
    };

    // Writer task: drain this conn's outbound queue to the socket.
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    on_connect(&conn);

    loop {
        tokio::select! {
            _ = close.notified() => break,
            read = tokio::time::timeout(READ_IDLE_TIMEOUT, stream.next()) => {
                match read {
                    Err(_) => break,            // idle timeout — reap dead client
                    Ok(None) => break,          // stream ended
                    Ok(Some(Err(_))) => break,  // transport error
                    Ok(Some(Ok(Message::Text(t)))) => dispatch(&conn, &t),
                    Ok(Some(Ok(Message::Close(_)))) => break,
                    Ok(Some(Ok(_))) => {}       // ping/pong/binary — ignore
                }
            }
        }
    }

    on_disconnect(&conn);
    writer.abort();
}

fn dispatch(conn: &Conn, text: &str) {
    let Ok(f) = serde_json::from_str::<InFrame>(text) else {
        return;
    };
    match f.t.as_str() {
        wire::PING => {
            let _ = conn.tx.send(format!("{{\"t\":\"{}\"}}", wire::PONG));
        }
        wire::SESSION_ANNOUNCE => on_session_announce(conn, f.d),
        wire::CHANNEL_JOIN => on_channel_join(conn, f.d),
        wire::CHANNEL_LEAVE => on_channel_leave(conn, f.d),
        wire::CHANNEL_SEND => on_channel_send(conn, f.d, f.id),
        wire::DM_SEND => on_dm_send(conn, f.d, f.id),
        _ => {} // unknown event — ignore, like socket.io
    }
}

// ── Connection + per-event handlers ─────────────────────────────────

fn on_connect(conn: &Conn) {
    let nonce = issue_nonce();
    if let Some(mut inner) = conn.state.lock() {
        inner.nonces.insert(
            conn.id.clone(),
            NonceEntry {
                nonce: nonce.clone(),
                issued_at: now_ms(),
            },
        );
    }
    conn.emit(wire::CONNECTION_NONCE, &ConnectionNoncePayload { nonce });
}

fn on_session_announce(conn: &Conn, raw: serde_json::Value) {
    let state = conn.state.clone();
    let parsed: SessionAnnounceIn = match serde_json::from_value(raw) {
        Ok(v) => v,
        Err(_) => return fail_announce(conn, "INVALID_PAYLOAD", "malformed announce"),
    };

    let now = chrono::Utc::now().timestamp_millis();
    if (now - parsed.ts).abs() > ANNOUNCE_MAX_SKEW_MS {
        return fail_announce(conn, "STALE_TIMESTAMP", "announce timestamp out of skew window");
    }

    // Key shape validation before signature verify.
    let sign_bytes = match bs58::decode(&parsed.signing_public_key).into_vec() {
        Ok(b) if b.len() == 32 => b,
        _ => return fail_announce(conn, "INVALID_PAYLOAD", "malformed public key"),
    };
    match bs58::decode(&parsed.box_public_key).into_vec() {
        Ok(b) if b.len() == 32 => {}
        _ => return fail_announce(conn, "INVALID_PAYLOAD", "malformed public key"),
    }

    // Bind the bad-announce bucket to the claimed box pub (audit pt6 H13).
    let claimed_box = parsed.box_public_key.as_str();

    // Pull the expected nonce (consume only on success — a flooder hitting
    // bad-announce paths shouldn't exhaust the nonce map).
    let expected_nonce = state
        .lock()
        .and_then(|inner| inner.nonces.get(&conn.id).map(|n| n.nonce.clone()));
    let Some(expected) = expected_nonce else {
        return fail_announce_keyed(conn, "BAD_NONCE", "no nonce issued for this socket", Some(claimed_box));
    };
    if parsed.nonce != expected {
        return fail_announce_keyed(conn, "BAD_NONCE", "nonce mismatch", Some(claimed_box));
    }

    let signed = format!(
        "{}|{}|{}|{}",
        parsed.nonce, parsed.box_public_key, parsed.display_name, parsed.ts
    );
    let sig_bytes = match bs58::decode(&parsed.sig).into_vec() {
        Ok(b) if b.len() == 64 => b,
        _ => return fail_announce_keyed(conn, "BAD_SIGNATURE", "announce signature invalid", Some(claimed_box)),
    };
    let sign_arr: [u8; 32] = match sign_bytes.as_slice().try_into() {
        Ok(a) => a,
        Err(_) => return fail_announce_keyed(conn, "BAD_SIGNATURE", "announce signature invalid", Some(claimed_box)),
    };
    let sig_arr: [u8; 64] = match sig_bytes.as_slice().try_into() {
        Ok(a) => a,
        Err(_) => return fail_announce_keyed(conn, "BAD_SIGNATURE", "announce signature invalid", Some(claimed_box)),
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&sign_arr) else {
        return fail_announce_keyed(conn, "BAD_SIGNATURE", "announce signature invalid", Some(claimed_box));
    };
    let signature = Signature::from_bytes(&sig_arr);
    if verifying_key.verify(signed.as_bytes(), &signature).is_err() {
        return fail_announce_keyed(conn, "BAD_SIGNATURE", "announce signature invalid", Some(claimed_box));
    }

    // Display name policy — refuse to trim or coerce (audit pt2 H1 / pt6 H3):
    // the sig was over the original bytes, so reject empty / overlong instead
    // of mutating and breaking the roster sig verification on peers.
    let display_name = parsed.display_name.clone();
    if display_name.is_empty() {
        return fail_announce(
            conn,
            "INVALID_PAYLOAD",
            "displayName must be non-empty — clients pick a name and sign it",
        );
    }
    if display_name.chars().count() > 32 {
        return fail_announce(
            conn,
            "INVALID_PAYLOAD",
            "displayName too long — clients must trim and sign the trimmed value",
        );
    }

    let info = SessionInfo {
        signing_public_key: parsed.signing_public_key.clone(),
        box_public_key: parsed.box_public_key.clone(),
        display_name,
        announce_nonce: parsed.nonce.clone(),
        announce_ts: parsed.ts,
        sig: parsed.sig.clone(),
    };

    let sid = conn.id.clone();
    if let Some(mut inner) = state.lock() {
        // Tear down a prior identity's box-room registration if the client
        // re-announces with a different identity on the same socket.
        if let Some(prior) = inner.sessions.get(&sid).cloned() {
            if prior.box_public_key != info.box_public_key {
                let mut drop_room = false;
                if let Some(set) = inner.box_rooms.get_mut(&prior.box_public_key) {
                    set.remove(&sid);
                    drop_room = set.is_empty();
                }
                if drop_room {
                    inner.box_rooms.remove(&prior.box_public_key);
                }
            }
        }
        inner.sessions.insert(sid.clone(), info.clone());
        inner.nonces.remove(&sid);
        inner
            .box_rooms
            .entry(info.box_public_key.clone())
            .or_default()
            .insert(sid.clone());
    }
    conn.emit(wire::SESSION_ACK, &SessionAckPayload { ok: true });
}

fn on_channel_join(conn: &Conn, raw: serde_json::Value) {
    let state = conn.state.clone();
    let Some(session) = session_of(conn) else {
        return send_error(conn, "NOT_READY", "announce before joining");
    };
    let parsed: ChannelJoinIn = match serde_json::from_value(raw) {
        Ok(v) => v,
        Err(_) => return send_error(conn, "INVALID_PAYLOAD", "channelId required"),
    };
    if !rate_allowed(&state, &session.box_public_key, RateKind::Join) {
        return send_error(conn, "RATE_LIMITED", "too many joins, slow down");
    }

    let sid = conn.id.clone();
    let (members_snapshot, broadcast_member, was_new) = {
        let Some(mut inner) = state.lock() else { return };

        if !inner.channel_rosters.contains_key(&parsed.channel_id) {
            if inner.channel_rosters.len() >= MAX_CHANNELS {
                drop(inner);
                return send_error(conn, "RATE_LIMITED", "relay is at channel capacity — retry later");
            }
            inner
                .channel_rosters
                .insert(parsed.channel_id.clone(), HashMap::new());
        }
        let roster = inner
            .channel_rosters
            .get_mut(&parsed.channel_id)
            .expect("just inserted");

        if !roster.contains_key(&sid) && roster.len() >= MAX_MEMBERS_PER_CHANNEL {
            drop(inner);
            return send_error(conn, "RATE_LIMITED", "channel is full — retry later");
        }

        let member = RosterMember {
            signing_public_key: session.signing_public_key.clone(),
            box_public_key: session.box_public_key.clone(),
            display_name: session.display_name.clone(),
            announce_nonce: session.announce_nonce.clone(),
            announce_ts: session.announce_ts,
            sig: session.sig.clone(),
            join_sig: parsed.join_sig.clone(),
            join_ts: parsed.join_ts,
        };
        let already_in = roster.contains_key(&sid);
        roster.insert(sid.clone(), member.clone());
        inner
            .last_channel_activity
            .insert(parsed.channel_id.clone(), now_ms());

        let snapshot: Vec<RosterMember> =
            inner.channel_rosters[&parsed.channel_id].values().cloned().collect();
        (snapshot, member, !already_in)
    };

    // Send the joiner its roster snapshot, then tell existing members someone
    // joined. `emit_to_channel(exclude = self)` excludes the joiner.
    conn.emit(
        wire::CHANNEL_ROSTER,
        &ChannelRosterPayload {
            channel_id: parsed.channel_id.clone(),
            members: members_snapshot,
        },
    );
    if was_new {
        let payload = ChannelMemberJoinedPayload {
            channel_id: parsed.channel_id.clone(),
            member: broadcast_member,
        };
        emit_to_channel(
            &state,
            &parsed.channel_id,
            &conn.id,
            &frame(wire::CHANNEL_MEMBER_JOINED, &payload),
        );
    }
}

fn on_channel_leave(conn: &Conn, raw: serde_json::Value) {
    let state = conn.state.clone();
    let Some(session) = session_of(conn) else { return };
    let Ok(parsed) = serde_json::from_value::<ChannelLeaveIn>(raw) else {
        return;
    };

    let sid = conn.id.clone();
    let was_in = {
        let Some(mut inner) = state.lock() else { return };
        let Some(roster) = inner.channel_rosters.get_mut(&parsed.channel_id) else {
            return;
        };
        let removed = roster.remove(&sid).is_some();
        if roster.is_empty() {
            inner.channel_rosters.remove(&parsed.channel_id);
        }
        removed
    };
    if !was_in {
        return;
    }

    // The sender is already out of the roster, so this naturally reaches the
    // remaining members only.
    let payload = ChannelMemberLeftPayload {
        channel_id: parsed.channel_id.clone(),
        signing_public_key: session.signing_public_key.clone(),
    };
    emit_to_channel(
        &state,
        &parsed.channel_id,
        &conn.id,
        &frame(wire::CHANNEL_MEMBER_LEFT, &payload),
    );
}

fn on_channel_send(conn: &Conn, raw: serde_json::Value, ack_id: Option<u64>) {
    let state = conn.state.clone();
    let respond = |ok: bool, err: Option<&str>| send_ack(conn, ack_id, ok, err);

    let Some(session) = session_of(conn) else {
        send_error(conn, "NOT_READY", "announce before sending");
        return respond(false, Some("NOT_READY"));
    };

    let parsed: ChannelSendIn = match serde_json::from_value(raw) {
        Ok(v) => v,
        Err(_) => {
            send_error(conn, "INVALID_PAYLOAD", "malformed channel:send");
            return respond(false, Some("INVALID_PAYLOAD"));
        }
    };
    if parsed.recipients.is_empty() || parsed.recipients.len() > MAX_CHANNEL_RECIPIENTS {
        send_error(conn, "INVALID_PAYLOAD", "malformed channel:send");
        return respond(false, Some("INVALID_PAYLOAD"));
    }
    // Pre-check ciphertext sizes — loud-reject the whole send rather than
    // silently dropping oversized recipients (which would lie to the
    // sender's ack-gated optimistic UI).
    for rec in &parsed.recipients {
        if rec.ciphertext.len() > MAX_CIPHERTEXT_BYTES {
            send_error(conn, "INVALID_PAYLOAD", "recipient ciphertext too large");
            return respond(false, Some("INVALID_PAYLOAD"));
        }
    }

    let sid = conn.id.clone();
    let allowed_boxes: HashSet<String> = {
        let Some(mut inner) = state.lock() else { return };
        let Some(roster) = inner.channel_rosters.get(&parsed.channel_id) else {
            drop(inner);
            send_error(conn, "NOT_IN_CHANNEL", "join the channel before sending");
            return respond(false, Some("NOT_IN_CHANNEL"));
        };
        if !roster.contains_key(&sid) {
            drop(inner);
            send_error(conn, "NOT_IN_CHANNEL", "join the channel before sending");
            return respond(false, Some("NOT_IN_CHANNEL"));
        }
        if !rate_allowed_locked(&mut inner, &session.box_public_key, RateKind::Message) {
            drop(inner);
            send_error(conn, "RATE_LIMITED", "message rate exceeded");
            return respond(false, Some("RATE_LIMITED"));
        }
        let allowed = inner.channel_rosters[&parsed.channel_id]
            .values()
            .map(|m| m.box_public_key.clone())
            .collect();
        inner
            .last_channel_activity
            .insert(parsed.channel_id.clone(), now_ms());
        allowed
    };

    let msg_id = make_msg_id();
    let ts = chrono::Utc::now().timestamp_millis();
    // Dedupe recipients by box key (audit pt6 H5: prevents 1:N amplification
    // from a sender repeating a recipient). Last-write-wins.
    let mut sent_to: HashSet<String> = HashSet::with_capacity(parsed.recipients.len());
    for rec in parsed.recipients {
        if rec.box_public_key == session.box_public_key {
            continue; // don't echo to self
        }
        if !allowed_boxes.contains(&rec.box_public_key) {
            // Don't be a pubkey-presence oracle: refuse to fan out to boxes
            // that aren't in this channel's roster.
            continue;
        }
        if !sent_to.insert(rec.box_public_key.clone()) {
            continue; // duplicate — already delivered to this box
        }
        let payload = ChannelMessagePayload {
            channel_id: parsed.channel_id.clone(),
            sender_box_public_key: session.box_public_key.clone(),
            sender_signing_public_key: session.signing_public_key.clone(),
            sender_display_name: session.display_name.clone(),
            ciphertext: rec.ciphertext,
            nonce: rec.nonce,
            msg_id: msg_id.clone(),
            ts,
        };
        emit_to_box(
            &state,
            &rec.box_public_key,
            &conn.id,
            &frame(wire::CHANNEL_MESSAGE, &payload),
        );
    }
    respond(true, None);
}

fn on_dm_send(conn: &Conn, raw: serde_json::Value, ack_id: Option<u64>) {
    let state = conn.state.clone();
    let respond = |ok: bool, err: Option<&str>| send_ack(conn, ack_id, ok, err);

    let Some(session) = session_of(conn) else {
        send_error(conn, "NOT_READY", "announce before sending");
        return respond(false, Some("NOT_READY"));
    };
    let parsed: DmSendIn = match serde_json::from_value(raw) {
        Ok(v) => v,
        Err(_) => {
            send_error(conn, "INVALID_PAYLOAD", "malformed dm:send");
            return respond(false, Some("INVALID_PAYLOAD"));
        }
    };
    if parsed.ciphertext.len() > MAX_CIPHERTEXT_BYTES {
        send_error(conn, "INVALID_PAYLOAD", "ciphertext too large");
        return respond(false, Some("INVALID_PAYLOAD"));
    }
    if !rate_allowed(&state, &session.box_public_key, RateKind::Message) {
        send_error(conn, "RATE_LIMITED", "message rate exceeded");
        return respond(false, Some("RATE_LIMITED"));
    }

    // Audit pt5 M1: never signal whether the recipient is online — that's a
    // presence oracle. Always ack ok=true; a broadcast to an empty box-room
    // is a no-op, indistinguishable from "recipient offline."
    let payload = DmMessagePayload {
        sender_box_public_key: session.box_public_key.clone(),
        sender_signing_public_key: session.signing_public_key.clone(),
        sender_display_name: session.display_name.clone(),
        ciphertext: parsed.ciphertext,
        nonce: parsed.nonce,
        msg_id: make_msg_id(),
        ts: chrono::Utc::now().timestamp_millis(),
        sender_sig: parsed.sender_sig,
    };
    emit_to_box(
        &state,
        &parsed.recipient_box_public_key,
        &conn.id,
        &frame(wire::DM_MESSAGE, &payload),
    );
    respond(true, None);
}

fn on_disconnect(conn: &Conn) {
    let state = conn.state.clone();
    let sid = conn.id.clone();
    let (session, member_left_broadcasts) = {
        let Some(mut inner) = state.lock() else { return };
        // Always drop the outbound sink registration so broadcasts stop
        // targeting this conn, even for never-announced sockets.
        inner.conns.remove(&sid);
        let session = inner.sessions.remove(&sid);
        inner.nonces.remove(&sid);
        // Audit pt6 H13: only the socket-keyed bad-announce bucket gets reaped
        // on disconnect; box-pub-keyed buckets persist until the GC sweep.
        inner.bad_announce_counts.remove(&format!("sock:{sid}"));

        let Some(session) = session else {
            return;
        };

        // Drop the box-room registration for this identity.
        let mut drop_box = false;
        if let Some(set) = inner.box_rooms.get_mut(&session.box_public_key) {
            set.remove(&sid);
            drop_box = set.is_empty();
        }
        if drop_box {
            inner.box_rooms.remove(&session.box_public_key);
        }

        let mut broadcasts: Vec<String> = Vec::new();
        let mut emptied: Vec<String> = Vec::new();
        for (channel_id, roster) in inner.channel_rosters.iter_mut() {
            if roster.remove(&sid).is_none() {
                continue;
            }
            // Suppress member-left if the same identity still has another
            // socket in this channel.
            let identity_still_present = roster
                .values()
                .any(|m| m.signing_public_key == session.signing_public_key);
            if !identity_still_present {
                broadcasts.push(channel_id.clone());
            }
            if roster.is_empty() {
                emptied.push(channel_id.clone());
            }
        }
        for c in emptied {
            inner.channel_rosters.remove(&c);
        }
        (session, broadcasts)
    };

    for channel_id in member_left_broadcasts {
        let payload = ChannelMemberLeftPayload {
            channel_id: channel_id.clone(),
            signing_public_key: session.signing_public_key.clone(),
        };
        emit_to_channel(
            &state,
            &channel_id,
            &conn.id,
            &frame(wire::CHANNEL_MEMBER_LEFT, &payload),
        );
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn send_ack(conn: &Conn, ack_id: Option<u64>, ok: bool, err: Option<&str>) {
    let Some(id) = ack_id else { return };
    let s = serde_json::to_string(&AckFrame {
        t: wire::ACK,
        id,
        d: AckResp {
            ok,
            error: err.map(|s| s.to_string()),
        },
    })
    .unwrap_or_default();
    let _ = conn.tx.send(s);
}

fn fail_announce(conn: &Conn, code: &str, message: &str) {
    fail_announce_keyed(conn, code, message, None);
}

/// Same as [`fail_announce`] but binds the bad-announce bucket to a specific
/// identity claim (audit pt6 H13) so reconnect doesn't reset the counter.
/// Honest limitation: the claimed box pub is attacker-chosen and rotatable;
/// only a single-key bad-signer hits the wall. See THREAT_MODEL.md.
fn fail_announce_keyed(conn: &Conn, code: &str, message: &str, claimed_box_pub: Option<&str>) {
    send_error(conn, code, message);
    let should_disconnect = {
        let Some(mut inner) = conn.state.lock() else { return };
        let bucket_key = match claimed_box_pub {
            Some(box_pub) if !box_pub.is_empty() && box_pub.len() <= 128 => {
                format!("box:{box_pub}")
            }
            _ => format!("sock:{}", conn.id),
        };
        let now = now_ms();
        let entry = inner
            .bad_announce_counts
            .entry(bucket_key)
            .or_insert(BadAnnounceEntry {
                count: 0,
                window_start: now,
            });
        if now - entry.window_start > BAD_ANNOUNCE_WINDOW_MS {
            entry.count = 0;
            entry.window_start = now;
        }
        entry.count += 1;
        entry.count >= MAX_BAD_ANNOUNCES_PER_SOCKET
    };
    if should_disconnect {
        conn.disconnect();
    }
}

fn send_error(conn: &Conn, code: &str, message: &str) {
    conn.emit(wire::ERROR, &WireErrorPayload { code, message });
}

fn session_of(conn: &Conn) -> Option<SessionInfo> {
    let inner = conn.state.lock()?;
    inner.sessions.get(&conn.id).cloned()
}

#[derive(Copy, Clone)]
enum RateKind {
    Message,
    Join,
}

fn rate_allowed(state: &RealtimeState, key: &str, kind: RateKind) -> bool {
    let Some(mut inner) = state.lock() else { return false };
    rate_allowed_locked(&mut inner, key, kind)
}

fn rate_allowed_locked(inner: &mut Inner, key: &str, kind: RateKind) -> bool {
    let now = now_ms();
    let fresh = inner
        .rate_buckets
        .get(key)
        .map(|b| now - b.window_start <= RATE_WINDOW_MS)
        .unwrap_or(false);
    if !fresh {
        if inner.rate_buckets.len() >= MAX_RATE_BUCKETS {
            // Backstop eviction. Friend-group scale won't hit this.
            if let Some(k) = inner.rate_buckets.keys().next().cloned() {
                inner.rate_buckets.remove(&k);
            }
        }
        inner.rate_buckets.insert(
            key.to_string(),
            RateBucket {
                messages: 0,
                joins: 0,
                window_start: now,
            },
        );
    }
    let bucket = inner.rate_buckets.get_mut(key).expect("just inserted");
    match kind {
        RateKind::Message => {
            if bucket.messages >= RATE_MAX_MESSAGES {
                return false;
            }
            bucket.messages += 1;
        }
        RateKind::Join => {
            if bucket.joins >= RATE_MAX_JOINS {
                return false;
            }
            bucket.joins += 1;
        }
    }
    true
}

fn issue_nonce() -> String {
    let mut buf = [0u8; 24];
    getrandom::getrandom(&mut buf).expect("OS RNG unavailable");
    hex_encode(&buf)
}

fn make_msg_id() -> String {
    // Audit pt6 M3: 128 bits of randomness — the client uses msgId as a dedup
    // key, so a collision would silently drop a message.
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).expect("OS RNG unavailable");
    let ts = chrono::Utc::now().timestamp_millis() as u64;
    format!("m_{:x}_{}", ts, hex_encode(&buf))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ── Periodic GC ─────────────────────────────────────────────────────

fn spawn_sweeper(state: RealtimeState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(RATE_WINDOW_MS as u64));
        interval.tick().await; // first tick fires immediately — skip
        loop {
            interval.tick().await;
            let removed = sweep(&state);
            if removed > 0 {
                debug!(removed, "realtime sweep");
            }
        }
    });
}

fn sweep(state: &RealtimeState) -> usize {
    let Some(mut inner) = state.lock() else { return 0 };
    let now = now_ms();
    let mut removed = 0;

    inner.rate_buckets.retain(|_, b| {
        let keep = now - b.window_start <= RATE_WINDOW_MS * 2;
        if !keep {
            removed += 1;
        }
        keep
    });

    let expired_nonces: Vec<String> = inner
        .nonces
        .iter()
        .filter(|(_, n)| now - n.issued_at > SOCKET_NONCE_TTL_MS)
        .map(|(k, _)| k.clone())
        .collect();
    for k in expired_nonces {
        inner.nonces.remove(&k);
        removed += 1;
    }

    let idle: Vec<String> = inner
        .last_channel_activity
        .iter()
        .filter(|(_, &last)| now - last > IDLE_CHANNEL_TTL_MS)
        .map(|(k, _)| k.clone())
        .collect();
    for k in idle {
        inner.channel_rosters.remove(&k);
        inner.last_channel_activity.remove(&k);
        removed += 1;
    }

    // Audit pt6 H13: expire box-pub-keyed bad-announce entries (socket-keyed
    // ones are reaped on disconnect).
    inner.bad_announce_counts.retain(|_, entry| {
        let keep = now - entry.window_start <= BAD_ANNOUNCE_WINDOW_MS;
        if !keep {
            removed += 1;
        }
        keep
    });

    removed
}
