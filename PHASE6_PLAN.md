# Phase 6 plan — `socket.io` → raw WebSocket

Goal: remove the last non-React, non-crypto runtime dependency (`socket.io-client`)
by replacing the Socket.IO/Engine.IO protocol with a minimal raw-WebSocket
envelope on **both** ends. This is the only phase that is not a client-only
change and that can break **all** connectivity if wrong.

## Surfaces touched (5)

1. `src/lib/realtimeClient.ts` — client transport (the `io()` socket + acks +
   reconnect). Business logic (crypto, roster policy, peer cache) is untouched.
2. `relay/src/realtime.rs` (1121 lines) — replace the socketioxide transport
   wrapper. The handlers' *logic* (validation, sig checks, rate limiting,
   roster bookkeeping) stays; the event/room/ack plumbing is rewritten.
3. `relay/src/http.rs` + `relay/src/main.rs` — drop the `SocketIo` layer, add a
   `GET /ws` axum upgrade route.
4. `relay/Cargo.toml` — drop `socketioxide` (keep `axum` `ws` feature, already on).
5. `src-tauri/src/proxy.rs` — change the cross-host path token `socket.io/` → `ws`
   and drop Socket.IO-specific cookie/sid handling. The proxy is a byte-level
   forwarder, so it tunnels a raw-WS upgrade the same way it tunnels Socket.IO's
   WS transport — expected to be a small change, but must be verified.

## ⚠️ The decision this phase forces: a hard ecosystem flag-day

Unlike the crypto migration (byte-compatible, zero rollout risk), this is a
**breaking wire-protocol change with no interop**. The product model is
cross-host: you connect to *other people's* bundled relays over their `.onion`.
So:

- A new client **cannot** talk to an old remote relay, and vice-versa. The
  handshake won't complete — it's a hard failure, not silent degradation.
- Everyone in a community must be on the new build to talk to each other.

For a pre-1.0 app with a small/no external user base this is fine, but it must
be a conscious call. Alternative (much more work, likely not worth it pre-1.0):
have the relay serve BOTH `/socket.io/` and `/ws` during a transition window so
old and new clients coexist. **Recommendation: flag-day it; do not build dual
support.** ← confirm before implementing.

## Wire envelope (replaces Engine.IO + Socket.IO framing)

One JSON object per WebSocket text frame:

```
client → server:  { "t": "<event>", "d": <payload>, "id"?: <number> }
server → client:  { "t": "<event>", "d": <payload> }
ack    (s → c):   { "t": "$ack", "id": <number>, "d": { "ok": <bool> } }
heartbeat (c→s):  { "t": "$ping" }
heartbeat (s→c):  { "t": "$pong" }
```

Reserved (non-business) frame types: `$ack`, `$ping`, `$pong`. All other `t`
values are existing `WIRE` event names. Nail these reserved names down now.

- `id` is present only on the two ack-gated client sends (`channel:send`,
  `dm:send`); the server echoes it in a `$ack` frame. Preserves `emitWithAck`.
- `<event>` strings are the EXISTING wire names (`session:announce`,
  `connection:nonce`, `channel:join`, `channel:roster`, `channel:message`,
  `dm:message`, `error`, …) — the `WIRE` constants are unchanged, so the
  validation layer (`wireSchemas`) and handler bodies don't move.
- This drops Engine.IO's packet-type prefixes, sid, and upgrade dance entirely.

## Client changes (`realtimeClient.ts`)

Replace the `socket.io-client` import + `ioClient(origin, {...})` with a small
`WsConn` manager (~120 lines) that provides the slice of the `Socket` API this
file uses (`on(event, fn)`, `emit(event, payload)`, `emitWithAck`,
`removeAllListeners`, `disconnect`, `connect`/`disconnect` state events):

- **Connect:** `new WebSocket(wsUrl)`. `wsUrl` is built from the relay URL:
  local → `ws://localhost:3001/ws`; cross-host →
  `ws://localhost:11811/o/<token>/<onion>/ws` (replaces `splitSocketIoUrl`).
- **Dispatch:** `onmessage` → `JSON.parse` → look up `t` → call listeners with
  `d`. `$ack` frames resolve the pending ack promise keyed by `id`.
- **Acks:** maintain `Map<number, {resolve, timer}>`; `emitWithAck` allocates a
  monotonic id, sends `{t,d,id}`, resolves on `$ack` or `false` on the existing
  10 s timeout. Same external contract as today.
- **Reconnect + backoff:** socket.io did this for us (`reconnection`,
  `reconnectionDelay 500ms`, `reconnectionDelayMax 5s`). Reimplement: on
  `onclose`, schedule a redial with exponential backoff (500 ms → 5 s, jittered).
  The existing `SESSION_ACK` handler already replays channel joins on (re)connect,
  so reconnection recovery is mostly free once redial fires `connect`.
- **Heartbeat:** client-initiated, application-level (see below). The client
  sends `{t:"$ping"}` every ~20 s and resets a watchdog on each `{t:"$pong"}`.
- **State events:** synthesize `connect`/`disconnect` from WS `onopen`/`onclose`
  so the existing state machine (`connecting`→`handshaking`→`ready`) is unchanged.

## Relay changes (`realtime.rs` + `http.rs` + `main.rs`)

socketioxide gives us three things we must now own:

1. **The WS upgrade + per-connection task.** `GET /ws` → `WebSocketUpgrade` →
   spawn a task that owns the split sink/stream. Wrap the sink in an
   `mpsc`-fed writer task so multiple broadcasters can push to one connection
   (socketioxide did this internally).
2. **Rooms (the only stateful thing socketioxide managed for us).** Add to
   `Inner` (or a sibling map):
   - `conns: HashMap<ConnId, mpsc::Sender<Message>>` — to push to a connection.
   - `channel_rooms: HashMap<channel_id, HashSet<ConnId>>`
   - `box_rooms: HashMap<box_key, HashSet<ConnId>>`
   Replace `socket.join/leave(room)` with insert/remove on these; replace
   `socket.to(room).emit(ev, p)` with "look up the room's ConnId set, send the
   framed envelope to each (excluding self where socket.io's `to` excluded
   self — channel presence broadcasts rely on this)."
   - **Locking discipline (socketioxide hid this):** broadcast must
     **collect-then-send**. Lock `Inner`, look up the room's ConnIds, clone
     their `mpsc::Sender`s, **drop the guard**, then `try_send` outside the lock.
     Never hold the `std::sync::Mutex` across `.await`; use unbounded/`try_send`
     so one slow or full connection can't stall fan-out (or deadlock) under the
     lock.
3. **Acks.** `AckSender` → if the inbound frame had an `id`, the handler sends a
   `$ack` envelope with that id instead of calling `ack.send`.

Event dispatch: read frame → `JSON` → match `t` → call the SAME handler bodies
(`on_session_announce`, `on_channel_join`, …), which already take
`serde_json::Value`. On connect, send `connection:nonce` (as today). On
disconnect (stream end), run the existing `on_disconnect` cleanup plus remove
the ConnId from all room maps + `conns`.

`http.rs`/`main.rs`: remove `realtime::build` SocketIo layer wiring; mount the
`/ws` route with access to `RealtimeState`.

## Proxy (`src-tauri/src/proxy.rs`)

- Client path becomes `/o/<token>/<onion>/ws`. The existing
  `/o/<token>/<onion>/<rest>` parser already strips the prefix and forwards
  `<rest>` (`ws`) + the WS upgrade.
- **Pre-check DONE (de-risked):** confirmed `proxy.rs` triggers upgrade off the
  `Upgrade:` request header (line 384), **not** the `/socket.io/` path substring
  — the "socket.io" occurrences are comments only. After the 101 it becomes a
  transparent byte tunnel (lines ~556–557). So `/ws` upgrades and tunnels with
  no proxy logic change; only the comments referencing socket.io are stale.
- Optional tidy: drop the Socket.IO `sid` cookie comment (lines ~429–433); the
  pass-through itself is harmless either way.

## Heartbeat / keepalive (Tor-specific, do not skip)

Socket.IO's `pingInterval` (25 s) kept idle Tor circuits + the proxy's circuit
token alive. **It must be application-level, not WS ping/pong** — browser JS
cannot observe or send WebSocket protocol-level ping/pong (no API, no events;
the browser auto-pongs invisibly). A server-sent WS Ping would therefore produce
zero JS-visible frames, so a client "no frame for N s" watchdog would misfire on
a healthy idle connection, and the client still couldn't detect a half-open
server. So:

- **Client-initiated app-level heartbeat:** client sends `{t:"$ping"}` every
  ~20 s; server replies `{t:"$pong"}`. Client resets a ~45 s watchdog on each
  `$pong`; if it expires, close + reconnect.
- One mechanism covers all three needs: bidirectional traffic keeps the Tor
  circuit + proxy circuit-token warm; the client detects a dead/half-open server
  (no `$pong`); the server detects a dead client (no `$ping` in N s → drop the
  connection and run disconnect cleanup).
- (A server-side WS Ping is still fine as a belt-and-suspenders for the server
  to reap dead sockets, but it is NOT the client's liveness signal.)

## Testing plan (and the sandbox gap)

1. **Envelope unit tests** (encode/decode, ack id correlation) — local, full.
2. **Local single-relay smoke**: run the relay, connect one client, drive
   handshake → announce → join → roster → channel send → DM. Doable locally.
3. **Reconnect**: kill+restart the relay, assert client redials with backoff and
   the `SESSION_ACK` handler replays joins and rosters repopulate.
4. **Two-client mesh + cross-host over Tor**: **cannot run in this sandbox.**
   Requires two app instances and a live onion. **User must run this** before
   shipping — it's the real test that the protocol works end-to-end.

**Weaker-green warning:** Phases 1–5 each had an offline byte-equality oracle
that *proved* equivalence. Phase 6 has none — there is no prior wire format to
diff against (we're replacing it). "typecheck + `cargo build` + local
single-relay smoke green" is a genuinely weaker signal than the earlier phases'
green: it shows the new protocol is internally consistent, NOT that the live
two-client-over-Tor mesh works. Treat step 4 as the only real proof of done.

## Implementation order (each a checkpoint)

1. ✅ **DONE.** Landed the `$`-envelope + `WsConn` client manager
   (`src/lib/wsConn.ts`) behind the same `Socket`-shaped API; repointed
   `realtimeClient.ts` (import, `splitSocketIoUrl`→`wsUrlFor`, `ioClient`→
   `new WsConn`, all `Socket` types). client typecheck + build green. Envelope/
   ack-correlation/disconnect/reconnect/`$pong` unit-verified against a mock
   WebSocket in `scripts/wsconn-test.mjs`. `socket.io-client` left in
   `package.json` (unused) until step 4 local smoke passes.
2. ✅ **DONE.** Rewrote `realtime.rs` transport + manual rooms (`conns`,
   `box_rooms`; channel membership derived from roster keys) with collect-then-
   send broadcasts; `GET /ws` route in `main.rs`; dropped `socketioxide`, added
   `futures-util`. `cargo build` green, no warnings.
3. ✅ **DONE (no code change).** Confirmed the proxy upgrades off the `Upgrade:`
   header, so `/ws` tunnels unchanged; only stale `socket.io` comments remain
   (left as-is). Client builds `…/ws` URLs via `wsUrlFor`.
4. ✅ **Local two-client mesh smoke PASSED** (`scripts/relay-mesh-smoke.mjs`):
   signed handshake→session:ack, $ping/$pong, join+roster, member-joined
   broadcast, ack-gated channel send + per-recipient decrypt, DM + sender_sig
   forward + decrypt, bad-announce→wire:error, disconnect→member-left. Then
   dropped `socket.io-client` from the client; typecheck + build green; bundle
   536→460 KB.
   ⏳ **REMAINING (user only): cross-host two-instance test over Tor** — the one
   path the sandbox can't exercise.

The socket.io path was deleted from both sides only after the local mesh smoke
passed.

## Honest cost/benefit

This removes ONE audited, widely-used library at the cost of: rewriting a
1121-line Rust transport, a client transport manager, a proxy tweak, owning
reconnect/heartbeat/room bookkeeping we currently get for free, and an
ecosystem flag-day. The trust-surface win is real but smaller than the crypto
phase's. Worth doing for a "pure, auditable, zero-incidental-deps" goal pre-1.0;
would be hard to justify mid-flight with a live user base.
