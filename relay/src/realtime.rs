//! Socket.io realtime layer — port of `server/socket-server.ts`. The
//! relay holds NO persistent state for the realtime path: connect,
//! verify a signed announce against a server-issued nonce, fan out
//! per-recipient ciphertexts, drop everything on disconnect/restart.
//!
//! Wire format is preserved byte-for-byte from the Node implementation
//! so the existing TypeScript client (and its Zod schemas) work
//! unchanged. Every inbound payload is `deny_unknown_fields` — mirrors
//! the Node side's Zod `.strict()` so attackers can't tunnel unsigned
//! data via extra fields adjacent to legitimate ones.
//!
//! Routing model: socket.io rooms.
//!   - "channel:<channelId>" — all sockets currently joined to a channel
//!   - "box:<boxPublicKey>"  — all sockets registered for an identity
//! Per-channel and per-recipient broadcasts use `socket.to(room).emit()`
//! which automatically excludes the calling socket. The roster snapshot
//! data is kept in a separate `Mutex` map because rooms don't carry
//! payload — they're just routing keys.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use socketioxide::{
    extract::{AckSender, Data, SocketRef},
    SocketIo,
};
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
}

fn channel_room(channel_id: &str) -> String {
    format!("channel:{channel_id}")
}
fn box_room(box_public_key: &str) -> String {
    format!("box:{box_public_key}")
}

// ── Tunables (preserved from server/socket-server.ts) ───────────────

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

pub const MAX_BUFFER_SIZE: usize = 1024 * 1024;

// ── Shared mutable state ────────────────────────────────────────────
//
// One big Mutex<Inner>. The realtime relay is event-loop bounded —
// hundreds of clients, sub-ms handlers — so the global lock won't
// bottleneck before the network does. If it ever does, swap to
// dashmap or per-map locks. Don't pre-optimize.

#[derive(Default)]
struct Inner {
    /// socket_id → session metadata captured at announce time
    sessions: HashMap<String, SessionInfo>,
    /// socket_id → server-issued nonce + when it was issued (for TTL)
    nonces: HashMap<String, NonceEntry>,
    /// channel_id → (socket_id → roster member info). Roster payloads
    /// are read from here for snapshots; routing is via rooms.
    channel_rosters: HashMap<String, HashMap<String, RosterMember>>,
    /// channel_id → last activity timestamp (ms epoch) for idle GC
    last_channel_activity: HashMap<String, u128>,
    /// rate-limit bucket keyed by box_public_key, separate counters
    /// for messages vs joins
    rate_buckets: HashMap<String, RateBucket>,
    /// bad-announce counter keyed by socket_id with sliding window —
    /// disconnects flooders that can't pass the bouncer (Tor NATs all
    /// clients to localhost so we can't IP-throttle)
    bad_announce_counts: HashMap<String, BadAnnounceEntry>,
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

// ── Wire DTOs ────────────────────────────────────────────────────────
//
// Every inbound payload uses `deny_unknown_fields` — equivalent to Zod
// `.strict()` on the Node side. Without this an attacker could smuggle
// extra unsigned fields next to legitimate ones; today nothing reads
// them, tomorrow some refactor might, and the signed-binding guarantee
// would silently regress.

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

// ── Entry point ──────────────────────────────────────────────────────

/// Build the SocketIo layer + handle, register the "/" namespace, and
/// spawn the periodic GC sweeper. Returns the tower layer to mount on
/// the axum router.
pub fn build(state: RealtimeState) -> (socketioxide::layer::SocketIoLayer, SocketIo) {
    let (layer, io) = SocketIo::builder()
        .max_buffer_size(MAX_BUFFER_SIZE)
        .ping_interval(Duration::from_secs(25))
        .ping_timeout(Duration::from_secs(60))
        .build_layer();

    let ns_state = state.clone();
    io.ns("/", move |socket: SocketRef| {
        let state = ns_state.clone();
        async move { on_connect(socket, state).await }
    });

    spawn_sweeper(state);
    (layer, io)
}

// ── Connection + per-event handlers ─────────────────────────────────

async fn on_connect(socket: SocketRef, state: RealtimeState) {
    let sid = socket_id_string(&socket);
    let nonce = issue_nonce();
    if let Some(mut inner) = state.lock() {
        inner.nonces.insert(
            sid,
            NonceEntry {
                nonce: nonce.clone(),
                issued_at: now_ms(),
            },
        );
    }
    socket
        .emit(wire::CONNECTION_NONCE, &ConnectionNoncePayload { nonce })
        .ok();

    // Each handler captures its own clone of state — they all share
    // the same Arc<Mutex<Inner>>, just different ownership handles.
    let s1 = state.clone();
    socket.on(
        wire::SESSION_ANNOUNCE,
        move |socket: SocketRef, Data(raw): Data<serde_json::Value>| {
            let state = s1.clone();
            async move { on_session_announce(socket, raw, state).await }
        },
    );
    let s2 = state.clone();
    socket.on(
        wire::CHANNEL_JOIN,
        move |socket: SocketRef, Data(raw): Data<serde_json::Value>| {
            let state = s2.clone();
            async move { on_channel_join(socket, raw, state).await }
        },
    );
    let s3 = state.clone();
    socket.on(
        wire::CHANNEL_LEAVE,
        move |socket: SocketRef, Data(raw): Data<serde_json::Value>| {
            let state = s3.clone();
            async move { on_channel_leave(socket, raw, state).await }
        },
    );
    let s4 = state.clone();
    socket.on(
        wire::CHANNEL_SEND,
        move |socket: SocketRef, Data(raw): Data<serde_json::Value>, ack: AckSender| {
            let state = s4.clone();
            async move { on_channel_send(socket, raw, ack, state).await }
        },
    );
    let s5 = state.clone();
    socket.on(
        wire::DM_SEND,
        move |socket: SocketRef, Data(raw): Data<serde_json::Value>, ack: AckSender| {
            let state = s5.clone();
            async move { on_dm_send(socket, raw, ack, state).await }
        },
    );
    let s6 = state.clone();
    socket.on_disconnect(move |socket: SocketRef| {
        let state = s6.clone();
        async move { on_disconnect(socket, state).await }
    });
}

async fn on_session_announce(socket: SocketRef, raw: serde_json::Value, state: RealtimeState) {
    let parsed: SessionAnnounceIn = match serde_json::from_value(raw) {
        Ok(v) => v,
        Err(_) => return fail_announce(&socket, &state, "INVALID_PAYLOAD", "malformed announce"),
    };

    let now = chrono::Utc::now().timestamp_millis();
    if (now - parsed.ts).abs() > ANNOUNCE_MAX_SKEW_MS {
        return fail_announce(
            &socket,
            &state,
            "STALE_TIMESTAMP",
            "announce timestamp out of skew window",
        );
    }

    // Key shape validation before signature verify.
    let sign_bytes = match bs58::decode(&parsed.signing_public_key).into_vec() {
        Ok(b) if b.len() == 32 => b,
        _ => return fail_announce(&socket, &state, "INVALID_PAYLOAD", "malformed public key"),
    };
    match bs58::decode(&parsed.box_public_key).into_vec() {
        Ok(b) if b.len() == 32 => {}
        _ => return fail_announce(&socket, &state, "INVALID_PAYLOAD", "malformed public key"),
    }

    // Pull the expected nonce (without consuming yet — only consume on
    // successful verify, otherwise a flooder could exhaust the nonce
    // map by hitting bad-announce paths).
    let expected_nonce = state
        .lock()
        .and_then(|inner| inner.nonces.get(&socket_id_string(&socket)).map(|n| n.nonce.clone()));
    let Some(expected) = expected_nonce else {
        return fail_announce(&socket, &state, "BAD_NONCE", "no nonce issued for this socket");
    };
    if parsed.nonce != expected {
        return fail_announce(&socket, &state, "BAD_NONCE", "nonce mismatch");
    }

    let signed = format!(
        "{}|{}|{}|{}",
        parsed.nonce, parsed.box_public_key, parsed.display_name, parsed.ts
    );
    let sig_bytes = match bs58::decode(&parsed.sig).into_vec() {
        Ok(b) if b.len() == 64 => b,
        _ => return fail_announce(&socket, &state, "BAD_SIGNATURE", "announce signature invalid"),
    };
    let sign_arr: [u8; 32] = match sign_bytes.as_slice().try_into() {
        Ok(a) => a,
        Err(_) => return fail_announce(&socket, &state, "BAD_SIGNATURE", "announce signature invalid"),
    };
    let sig_arr: [u8; 64] = match sig_bytes.as_slice().try_into() {
        Ok(a) => a,
        Err(_) => return fail_announce(&socket, &state, "BAD_SIGNATURE", "announce signature invalid"),
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&sign_arr) else {
        return fail_announce(&socket, &state, "BAD_SIGNATURE", "announce signature invalid");
    };
    let signature = Signature::from_bytes(&sig_arr);
    if verifying_key.verify(signed.as_bytes(), &signature).is_err() {
        return fail_announce(&socket, &state, "BAD_SIGNATURE", "announce signature invalid");
    }

    // Display name policy — refuse to trim server-side (audit pt2 H1)
    // because trimming would invalidate the signature. Client must
    // trim then sign the trimmed value.
    let display_name = if parsed.display_name.is_empty() {
        "anon".to_string()
    } else {
        parsed.display_name.clone()
    };
    if display_name.chars().count() > 32 {
        return fail_announce(
            &socket,
            &state,
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

    let sid = socket_id_string(&socket);
    if let Some(mut inner) = state.lock() {
        // Tear down a prior session's box-room registration if the
        // client re-announces with a different identity on the same
        // socket (rare).
        if let Some(prior) = inner.sessions.get(&sid).cloned() {
            if prior.box_public_key != info.box_public_key {
                socket.leave(box_room(&prior.box_public_key));
            }
        }
        inner.sessions.insert(sid.clone(), info.clone());
        inner.nonces.remove(&sid);
    }
    socket.join(box_room(&info.box_public_key));
    socket
        .emit(wire::SESSION_ACK, &SessionAckPayload { ok: true })
        .ok();
}

async fn on_channel_join(socket: SocketRef, raw: serde_json::Value, state: RealtimeState) {
    let Some(session) = session_of(&socket, &state) else {
        return send_error(&socket, "NOT_READY", "announce before joining");
    };
    let parsed: ChannelJoinIn = match serde_json::from_value(raw) {
        Ok(v) => v,
        Err(_) => return send_error(&socket, "INVALID_PAYLOAD", "channelId required"),
    };
    if !rate_allowed(&state, &session.box_public_key, RateKind::Join) {
        return send_error(&socket, "RATE_LIMITED", "too many joins, slow down");
    }

    let sid = socket_id_string(&socket);
    let (members_snapshot, broadcast_member, was_new) = {
        let Some(mut inner) = state.lock() else { return };

        if !inner.channel_rosters.contains_key(&parsed.channel_id) {
            if inner.channel_rosters.len() >= MAX_CHANNELS {
                drop(inner);
                return send_error(
                    &socket,
                    "RATE_LIMITED",
                    "relay is at channel capacity — retry later",
                );
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
            return send_error(&socket, "RATE_LIMITED", "channel is full — retry later");
        }

        let member = RosterMember {
            signing_public_key: session.signing_public_key.clone(),
            box_public_key: session.box_public_key.clone(),
            display_name: session.display_name.clone(),
            announce_nonce: session.announce_nonce.clone(),
            announce_ts: session.announce_ts,
            sig: session.sig.clone(),
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

    // Join the routing room AFTER the roster mutation so the
    // member-joined broadcast goes to existing members, not to the new
    // joiner (socket.to(room) excludes self anyway, but joining first
    // would still make the joiner subject to subsequent broadcasts).
    socket.join(channel_room(&parsed.channel_id));
    socket
        .emit(
            wire::CHANNEL_ROSTER,
            &ChannelRosterPayload {
                channel_id: parsed.channel_id.clone(),
                members: members_snapshot,
            },
        )
        .ok();
    if was_new {
        socket
            .to(channel_room(&parsed.channel_id))
            .emit(
                wire::CHANNEL_MEMBER_JOINED,
                &ChannelMemberJoinedPayload {
                    channel_id: parsed.channel_id,
                    member: broadcast_member,
                },
            )
            .await
            .ok();
    }
}

async fn on_channel_leave(socket: SocketRef, raw: serde_json::Value, state: RealtimeState) {
    let Some(session) = session_of(&socket, &state) else { return };
    let Ok(parsed) = serde_json::from_value::<ChannelLeaveIn>(raw) else {
        return;
    };

    let sid = socket_id_string(&socket);
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

    socket
        .to(channel_room(&parsed.channel_id))
        .emit(
            wire::CHANNEL_MEMBER_LEFT,
            &ChannelMemberLeftPayload {
                channel_id: parsed.channel_id.clone(),
                signing_public_key: session.signing_public_key.clone(),
            },
        )
        .await
        .ok();
    socket.leave(channel_room(&parsed.channel_id));
}

async fn on_channel_send(
    socket: SocketRef,
    raw: serde_json::Value,
    ack: AckSender,
    state: RealtimeState,
) {
    let respond = |ok: bool, err: Option<&str>| {
        ack.send(&AckResp {
            ok,
            error: err.map(|s| s.to_string()),
        })
        .ok();
    };

    let Some(session) = session_of(&socket, &state) else {
        send_error(&socket, "NOT_READY", "announce before sending");
        return respond(false, Some("NOT_READY"));
    };

    let parsed: ChannelSendIn = match serde_json::from_value(raw) {
        Ok(v) => v,
        Err(_) => {
            send_error(&socket, "INVALID_PAYLOAD", "malformed channel:send");
            return respond(false, Some("INVALID_PAYLOAD"));
        }
    };
    if parsed.recipients.is_empty() || parsed.recipients.len() > MAX_CHANNEL_RECIPIENTS {
        send_error(&socket, "INVALID_PAYLOAD", "malformed channel:send");
        return respond(false, Some("INVALID_PAYLOAD"));
    }
    // Pre-check ciphertext sizes — loud-reject the whole send rather
    // than silently dropping oversized recipients (which would lie to
    // the sender's ack-gated optimistic UI).
    for rec in &parsed.recipients {
        if rec.ciphertext.len() > MAX_CIPHERTEXT_BYTES {
            send_error(&socket, "INVALID_PAYLOAD", "recipient ciphertext too large");
            return respond(false, Some("INVALID_PAYLOAD"));
        }
    }

    let sid = socket_id_string(&socket);
    let allowed_boxes: std::collections::HashSet<String> = {
        let Some(mut inner) = state.lock() else { return };
        let Some(roster) = inner.channel_rosters.get(&parsed.channel_id) else {
            drop(inner);
            send_error(&socket, "NOT_IN_CHANNEL", "join the channel before sending");
            return respond(false, Some("NOT_IN_CHANNEL"));
        };
        if !roster.contains_key(&sid) {
            drop(inner);
            send_error(&socket, "NOT_IN_CHANNEL", "join the channel before sending");
            return respond(false, Some("NOT_IN_CHANNEL"));
        }
        if !rate_allowed_locked(&mut inner, &session.box_public_key, RateKind::Message) {
            drop(inner);
            send_error(&socket, "RATE_LIMITED", "message rate exceeded");
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
    for rec in parsed.recipients {
        if rec.box_public_key == session.box_public_key {
            continue; // don't echo to self
        }
        if !allowed_boxes.contains(&rec.box_public_key) {
            // Prevents the relay from being a pubkey-presence oracle:
            // refuse to fan out to box keys that aren't in this
            // channel's roster.
            continue;
        }
        socket
            .to(box_room(&rec.box_public_key))
            .emit(
                wire::CHANNEL_MESSAGE,
                &ChannelMessagePayload {
                    channel_id: parsed.channel_id.clone(),
                    sender_box_public_key: session.box_public_key.clone(),
                    sender_signing_public_key: session.signing_public_key.clone(),
                    sender_display_name: session.display_name.clone(),
                    ciphertext: rec.ciphertext,
                    nonce: rec.nonce,
                    msg_id: msg_id.clone(),
                    ts,
                },
            )
            .await
            .ok();
    }
    respond(true, None);
}

async fn on_dm_send(
    socket: SocketRef,
    raw: serde_json::Value,
    ack: AckSender,
    state: RealtimeState,
) {
    let respond = |ok: bool, err: Option<&str>| {
        ack.send(&AckResp {
            ok,
            error: err.map(|s| s.to_string()),
        })
        .ok();
    };

    let Some(session) = session_of(&socket, &state) else {
        send_error(&socket, "NOT_READY", "announce before sending");
        return respond(false, Some("NOT_READY"));
    };
    let parsed: DmSendIn = match serde_json::from_value(raw) {
        Ok(v) => v,
        Err(_) => {
            send_error(&socket, "INVALID_PAYLOAD", "malformed dm:send");
            return respond(false, Some("INVALID_PAYLOAD"));
        }
    };
    if parsed.ciphertext.len() > MAX_CIPHERTEXT_BYTES {
        send_error(&socket, "INVALID_PAYLOAD", "ciphertext too large");
        return respond(false, Some("INVALID_PAYLOAD"));
    }
    if !rate_allowed(&state, &session.box_public_key, RateKind::Message) {
        send_error(&socket, "RATE_LIMITED", "message rate exceeded");
        return respond(false, Some("RATE_LIMITED"));
    }

    // Audit pt5 M1: do NOT signal whether the recipient is online —
    // that's a presence oracle. Always ack ok=true. The broadcast to
    // an empty box-room is a no-op. From the sender's perspective,
    // "delivered but recipient hasn't replied" is indistinguishable
    // from "recipient offline."
    socket
        .to(box_room(&parsed.recipient_box_public_key))
        .emit(
            wire::DM_MESSAGE,
            &DmMessagePayload {
                sender_box_public_key: session.box_public_key.clone(),
                sender_signing_public_key: session.signing_public_key.clone(),
                sender_display_name: session.display_name.clone(),
                ciphertext: parsed.ciphertext,
                nonce: parsed.nonce,
                msg_id: make_msg_id(),
                ts: chrono::Utc::now().timestamp_millis(),
            },
        )
        .await
        .ok();
    respond(true, None);
}

async fn on_disconnect(socket: SocketRef, state: RealtimeState) {
    let sid = socket_id_string(&socket);
    let (session, member_left_broadcasts) = {
        let Some(mut inner) = state.lock() else { return };
        let session = inner.sessions.remove(&sid);
        inner.nonces.remove(&sid);
        inner.bad_announce_counts.remove(&sid);

        let Some(session) = session else {
            return;
        };

        let mut broadcasts: Vec<String> = Vec::new();
        let mut emptied: Vec<String> = Vec::new();
        for (channel_id, roster) in inner.channel_rosters.iter_mut() {
            if roster.remove(&sid).is_none() {
                continue;
            }
            // Suppress member-left if the same identity still has
            // another socket in this channel (e.g. client re-handshaked
            // for a display name change with overlap).
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
        socket
            .to(channel_room(&channel_id))
            .emit(
                wire::CHANNEL_MEMBER_LEFT,
                &ChannelMemberLeftPayload {
                    channel_id,
                    signing_public_key: session.signing_public_key.clone(),
                },
            )
            .await
            .ok();
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn fail_announce(socket: &SocketRef, state: &RealtimeState, code: &str, message: &str) {
    send_error(socket, code, message);
    let should_disconnect = {
        let Some(mut inner) = state.lock() else { return };
        let sid = socket_id_string(socket);
        let now = now_ms();
        let entry = inner
            .bad_announce_counts
            .entry(sid)
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
        let _ = socket.clone().disconnect();
    }
}

fn send_error(socket: &SocketRef, code: &str, message: &str) {
    socket
        .emit(wire::ERROR, &WireErrorPayload { code, message })
        .ok();
}

fn session_of(socket: &SocketRef, state: &RealtimeState) -> Option<SessionInfo> {
    let inner = state.lock()?;
    inner.sessions.get(&socket_id_string(socket)).cloned()
}

fn socket_id_string(socket: &SocketRef) -> String {
    socket.id.to_string()
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
    let mut buf = [0u8; 6];
    getrandom::getrandom(&mut buf).expect("OS RNG unavailable");
    let ts = chrono::Utc::now().timestamp_millis() as u64;
    // Format mirrors Node's `m_${ts.toString(36)}_${hex6}` closely
    // enough for any client-side prefix check to keep working; exact
    // base of the ts segment is opaque.
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
    removed
}
