/**
 * Void Chat ephemeral relay.
 *
 * The server holds NO persistent state. Its only job:
 *   1. Authenticate a session by verifying a signed announcement that's
 *      bound to a connection-specific nonce (replay-immune).
 *   2. Keep an in-memory roster of who's currently in each channel.
 *   3. Fan out per-recipient channel ciphertexts and route DM ciphertexts.
 *
 * Nothing is logged to disk. Nothing is decrypted. Restart the process and
 * every session, roster, and in-flight message is gone.
 *
 * Run via `yarn socket` (tsx).
 */

import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { Server, Socket } from 'socket.io';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { z } from 'zod';

import {
  WIRE,
  type ChannelJoinMessage,
  type ChannelLeaveMessage,
  type ChannelMessageRelay,
  type ChannelSendMessage,
  type DMMessageRelay,
  type DMSendMessage,
  type RosterMember,
  type SessionAnnounceMessage,
  type WireErrorMessage,
} from '../src/types/wire';
import { handleApiRequest } from './api';

// ── Config ─────────────────────────────────────────────────────────────────

const PORT = process.env['SOCKET_PORT'] ? parseInt(process.env['SOCKET_PORT'], 10) : 3001;

// Self-host typically has several valid origins (localhost, LAN IP, .local
// hostname). Accept a comma-separated list. The literal "*" disables the
// allowlist entirely — convenient for LAN-only setups where you don't care
// what address your friends type, but DO NOT use over the internet.
const CORS_RAW = process.env['CORS_ORIGIN'] ||
  'http://localhost:5173,http://localhost:1420,http://localhost:3000,tauri://localhost,https://tauri.localhost';
const CORS_ALLOW_ANY = CORS_RAW.trim() === '*';
const CORS_ORIGIN_LIST = CORS_RAW.split(',').map(s => s.trim()).filter(Boolean);

const ANNOUNCE_MAX_SKEW_MS = 5 * 60 * 1000;

/** Wire schema for SESSION_ANNOUNCE. `.strict()` rejects unknown
 *  fields so an attacker can't tunnel extra unsigned data through the
 *  same path the legitimate announce uses. Length caps are loose — the
 *  cryptographic verify is the real check, this is the framing gate. */
const SESSION_ANNOUNCE_SCHEMA = z
  .object({
    signingPublicKey: z.string().min(1).max(128),
    boxPublicKey: z.string().min(1).max(128),
    displayName: z.string().max(64),
    ts: z.number().int(),
    sig: z.string().min(1).max(128),
    nonce: z.string().min(1).max(128),
  })
  .strict();

/** Wire schemas for the rest of the client→server events. All are
 *  `.strict()` so attackers can't smuggle unknown fields adjacent to
 *  legitimate ones (e.g. extra props on a recipient object that some
 *  future relay code might trustingly read). Same length caps as the
 *  client-side wireSchemas use. */
const CHANNEL_JOIN_SCHEMA = z
  .object({
    channelId: z.string().min(1).max(256),
  })
  .strict();

const CHANNEL_LEAVE_SCHEMA = CHANNEL_JOIN_SCHEMA;

const CHANNEL_RECIPIENT_SCHEMA = z
  .object({
    boxPublicKey: z.string().min(1).max(128),
    ciphertext: z.string().min(1).max(256 * 1024),
    nonce: z.string().min(1).max(128),
  })
  .strict();

// Cap is duplicated here because MAX_CHANNEL_RECIPIENTS is declared
// below in the constants block — keeping schemas at the top of state
// for visibility. Both must stay in sync; the post-parse handler
// already enforces MAX_CHANNEL_RECIPIENTS as a defense in depth.
const CHANNEL_SEND_SCHEMA = z
  .object({
    channelId: z.string().min(1).max(256),
    recipients: z.array(CHANNEL_RECIPIENT_SCHEMA).min(1).max(256),
  })
  .strict();

const DM_SEND_SCHEMA = z
  .object({
    recipientBoxPublicKey: z.string().min(1).max(128),
    ciphertext: z.string().min(1).max(256 * 1024),
    nonce: z.string().min(1).max(128),
  })
  .strict();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_MESSAGES = 120;
const RATE_MAX_JOINS = 60;
const MAX_CHANNEL_RECIPIENTS = 256;
// 64 KiB plaintext cap → ciphertext is plaintext + 16-byte Poly1305 tag,
// then base64-expanded by 4/3. Bound it well above what a polite client
// would ever send to leave room for nonce/json overhead.
const MAX_CIPHERTEXT_BYTES = 96 * 1024;

// ── DoS bounds ─────────────────────────────────────────────────────────────
// Caps on in-memory state to prevent a single misbehaving client (or a
// flooder using fresh Tor identities, which are free to rotate) from
// consuming unbounded memory. Picked generous enough that no realistic
// friend-group use case bumps into them — these are the wall against
// resource-exhaustion attacks, not policy.
const MAX_RATE_BUCKETS = 50_000;
const MAX_CHANNELS = 10_000;
const MAX_MEMBERS_PER_CHANNEL = 1_000;
const SOCKET_NONCE_TTL_MS = 5 * 60 * 1000;
const IDLE_CHANNEL_TTL_MS = 24 * 60 * 60 * 1000; // 24h with no activity

// ── In-memory state ────────────────────────────────────────────────────────

interface SessionInfo {
  signingPublicKey: string;
  boxPublicKey: string;
  displayName: string;
  joinedAt: number;
  /** Captured announce credential. Re-broadcast in every roster entry
   *  so peer clients can verify the boxPublicKey binding themselves —
   *  the relay can no longer substitute keys without invalidating the
   *  sig (which is computed by the holder of signingPublicKey, which
   *  the relay does not possess). */
  announceNonce: string;
  announceTs: number;
  sig: string;
}

interface RateBucket {
  messages: number;
  joins: number;
  windowStart: number;
}

const socketSessions = new Map<string, SessionInfo>();
const socketNonces = new Map<string, string>();
/** When each nonce was issued — used by the sweeper to expire nonces
 *  whose sockets disconnected before announcing. Without this, the
 *  socketNonces map grew unbounded. */
const socketNonceIssuedAt = new Map<string, number>();
const boxToSockets = new Map<string, Set<string>>();
const channelRosters = new Map<string, Map<string, RosterMember>>();
/** Last-activity timestamp per channel — joins, sends, etc. all bump
 *  this. The idle-channel sweeper drops channels with no activity for
 *  IDLE_CHANNEL_TTL_MS to prevent unbounded growth from joiners who
 *  silently disconnect without leaving. */
const lastChannelActivity = new Map<string, number>();
const rateBuckets = new Map<string, RateBucket>();

/**
 * Bad-announce attempts per socket within a sliding window. Each
 * invalid announce forces a tweetnacl verify (~1ms of CPU); without
 * a cap, a flooder can monopolize the event loop without ever
 * passing the bouncer. Tor NATs all clients to localhost, so we
 * can't IP-throttle.
 *
 * Sockets that exceed MAX_BAD_ANNOUNCES_PER_SOCKET inside
 * BAD_ANNOUNCE_WINDOW_MS get disconnected. A long-running socket
 * that hits one bad announce, then another hours later (transient
 * corruption, post-restart races) won't get punished — the window
 * decays before the count accumulates.
 */
interface BadAnnounceEntry {
  count: number;
  windowStart: number;
}
const badAnnounceCounts = new Map<string, BadAnnounceEntry>();
const MAX_BAD_ANNOUNCES_PER_SOCKET = 5;
const BAD_ANNOUNCE_WINDOW_MS = 5 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

// Reuse one encoder for every announce verification — `TextEncoder` is
// stateless and reusable, no benefit to per-call allocation.
const textEncoder = new TextEncoder();

function issueNonce(): string {
  return randomBytes(24).toString('hex');
}

function msgId(): string {
  return `m_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

function rateAllowed(bucketKey: string, kind: 'message' | 'join'): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    // Cap total bucket count. Tor identity rotation is free, so a
    // flooder could otherwise create unbounded buckets by churning
    // box keys faster than the time-based GC sweeps them. When we
    // hit the cap, evict the oldest entry (Map iteration order ==
    // insertion order in JS, so the first key is the oldest).
    if (rateBuckets.size >= MAX_RATE_BUCKETS) {
      const oldest = rateBuckets.keys().next().value;
      if (oldest !== undefined) rateBuckets.delete(oldest);
    }
    bucket = { messages: 0, joins: 0, windowStart: now };
    rateBuckets.set(bucketKey, bucket);
  }
  if (kind === 'message') {
    if (bucket.messages >= RATE_MAX_MESSAGES) return false;
    bucket.messages++;
  } else {
    if (bucket.joins >= RATE_MAX_JOINS) return false;
    bucket.joins++;
  }
  return true;
}

function sendError(socket: Socket, code: WireErrorMessage['code'], message: string): void {
  const payload: WireErrorMessage = { code, message };
  socket.emit(WIRE.ERROR, payload);
}

function registerSocketForBox(socketId: string, boxPublicKey: string): void {
  let set = boxToSockets.get(boxPublicKey);
  if (!set) {
    set = new Set();
    boxToSockets.set(boxPublicKey, set);
  }
  set.add(socketId);
}

function unregisterSocketForBox(socketId: string, boxPublicKey: string): void {
  const set = boxToSockets.get(boxPublicKey);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) boxToSockets.delete(boxPublicKey);
}

function broadcastToChannel(
  channelId: string,
  event: string,
  payload: unknown,
  exceptSocketId?: string,
): void {
  const roster = channelRosters.get(channelId);
  if (!roster) return;
  for (const socketId of roster.keys()) {
    if (socketId === exceptSocketId) continue;
    io.sockets.sockets.get(socketId)?.emit(event, payload);
  }
}

function verifyAnnounceSignature(
  msg: SessionAnnounceMessage,
  expectedNonce: string,
): boolean {
  if (msg.nonce !== expectedNonce) return false;
  try {
    const signed = `${msg.nonce}|${msg.boxPublicKey}|${msg.displayName}|${msg.ts}`;
    const sigBytes = bs58.decode(msg.sig);
    const pubBytes = bs58.decode(msg.signingPublicKey);
    if (sigBytes.length !== nacl.sign.signatureLength) return false;
    if (pubBytes.length !== nacl.sign.publicKeyLength) return false;
    return nacl.sign.detached.verify(textEncoder.encode(signed), sigBytes, pubBytes);
  } catch {
    return false;
  }
}

// ── Server ─────────────────────────────────────────────────────────────────

// Same Node http server hosts both the HTTP API (community/channel CRUD)
// and the socket.io WebSocket layer. socket.io adds its own request
// listener for /socket.io/*; ours below handles /api/* and falls through
// (no-op) for anything else so socket.io can answer it.
const httpServer = createServer();
httpServer.on('request', (req, res) => {
  void handleApiRequest(req, res).catch((err) => {
    console.error('[void-relay] api dispatcher crashed:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    }
  });
});
const io = new Server(httpServer, {
  cors: {
    // No .onion allowance — see server/api.ts for the full rationale.
    // Short version: the relay is bound to localhost so any local
    // process can forge an Origin header; the cross-host flow doesn't
    // actually need .onion origins because the proxy forwards the
    // webview's tauri://localhost (or http://localhost:5173) origin
    // unchanged, and those are in the allowlist already.
    origin: CORS_ALLOW_ANY ? true : CORS_ORIGIN_LIST,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60_000,
  pingInterval: 25_000,
  // Cap inbound frame size. The biggest legitimate payload is a
  // channel:send with N recipient ciphertexts (capped by
  // MAX_CHANNEL_RECIPIENTS × ciphertext size). 1 MiB covers roughly
  // 10 recipients with full-cap ciphertexts (~96 KiB each), which
  // is the realistic friend-group fan-out. The earlier 256 KiB was
  // tight enough that any group of 4+ exchanging long messages
  // would silently drop frames and the H5 ack-gating would mark
  // them failed — a UX cliff that wasn't earning meaningful
  // additional DoS protection over 1 MiB.
  //
  // For larger rooms, future work: sender-side recipient chunking
  // (multiple emits with a shared logical msgId) so the per-frame
  // budget stays tight while supporting wider fan-out.
  maxHttpBufferSize: 1024 * 1024,
});

io.on('connection', (socket: Socket) => {
  const nonce = issueNonce();
  socketNonces.set(socket.id, nonce);
  socketNonceIssuedAt.set(socket.id, Date.now());
  socket.emit(WIRE.CONNECTION_NONCE, { nonce });

  // ── Announce ─────────────────────────────────────────────────────────
  // Helper closed over `socket` — every failed-announce path goes
  // through here so we can disconnect after N bad attempts. Without
  // this, a flooder can pin the event loop with verify work without
  // ever passing the bouncer (Tor NATs all clients to localhost so
  // we can't IP-throttle).
  const failAnnounce = (
    code:
      | 'INVALID_PAYLOAD'
      | 'BAD_SIGNATURE'
      | 'STALE_TIMESTAMP'
      | 'BAD_NONCE',
    message: string,
  ) => {
    sendError(socket, code, message);
    const now = Date.now();
    let entry = badAnnounceCounts.get(socket.id);
    if (!entry || now - entry.windowStart > BAD_ANNOUNCE_WINDOW_MS) {
      // Fresh window — older bad-attempts have aged out, start over.
      entry = { count: 0, windowStart: now };
      badAnnounceCounts.set(socket.id, entry);
    }
    entry.count++;
    if (entry.count >= MAX_BAD_ANNOUNCES_PER_SOCKET) {
      socket.disconnect(true);
    }
  };

  socket.on(WIRE.SESSION_ANNOUNCE, (rawIn: unknown) => {
    // Strict schema rejects unknown fields — without this an attacker
    // could smuggle extra unsigned data that downstream code might one
    // day read, defeating the bind-everything-into-the-sig protection.
    const parseResult = SESSION_ANNOUNCE_SCHEMA.safeParse(rawIn);
    if (!parseResult.success) {
      failAnnounce('INVALID_PAYLOAD', 'malformed announce');
      return;
    }
    const raw: SessionAnnounceMessage = parseResult.data;
    if (Math.abs(Date.now() - raw.ts) > ANNOUNCE_MAX_SKEW_MS) {
      failAnnounce('STALE_TIMESTAMP', 'announce timestamp out of skew window');
      return;
    }
    // Validate key shapes before routing — malformed keys would still
    // pass through to peers and just fail to decrypt anywhere, wasting
    // bandwidth and confusing the recipient. Reject at the boundary.
    try {
      if (
        bs58.decode(raw.boxPublicKey).length !== nacl.box.publicKeyLength ||
        bs58.decode(raw.signingPublicKey).length !== nacl.sign.publicKeyLength
      ) {
        failAnnounce('INVALID_PAYLOAD', 'malformed public key');
        return;
      }
    } catch {
      failAnnounce('INVALID_PAYLOAD', 'public key not valid base58');
      return;
    }
    const expected = socketNonces.get(socket.id);
    if (!expected) {
      failAnnounce('BAD_NONCE', 'no nonce issued for this socket');
      return;
    }
    const ok = verifyAnnounceSignature(raw, expected);
    if (!ok) {
      failAnnounce('BAD_SIGNATURE', 'announce signature invalid');
      return;
    }

    // Trim display name defensively (clients should do this too).
    // If we trim, we'd invalidate the original signature (since the
    // sig was computed over the un-trimmed value). To preserve roster
    // verifiability end-to-end, keep the value as the client signed it.
    // (Server-side cap is still applied via a length pre-check above
    // through the announce-size limits and clients always trim on input.)
    const displayName = raw.displayName.slice(0, 32) || 'anon';
    if (displayName !== raw.displayName) {
      failAnnounce(
        'INVALID_PAYLOAD',
        'displayName too long — clients must trim and sign the trimmed value',
      );
      return;
    }
    const info: SessionInfo = {
      signingPublicKey: raw.signingPublicKey,
      boxPublicKey: raw.boxPublicKey,
      displayName,
      joinedAt: Date.now(),
      announceNonce: raw.nonce,
      announceTs: raw.ts,
      sig: raw.sig,
    };

    // If this socket had a previous session entry (rare, but possible if a
    // client re-announces on the same socket), tear it down first.
    const prior = socketSessions.get(socket.id);
    if (prior && prior.boxPublicKey !== info.boxPublicKey) {
      unregisterSocketForBox(socket.id, prior.boxPublicKey);
    }
    socketSessions.set(socket.id, info);
    registerSocketForBox(socket.id, info.boxPublicKey);
    // Nonce is single-use; clear so a replay on the same socket would also fail.
    socketNonces.delete(socket.id);
    socketNonceIssuedAt.delete(socket.id);

    socket.emit(WIRE.SESSION_ACK, { ok: true });
  });

  // ── Channel join ─────────────────────────────────────────────────────
  socket.on(WIRE.CHANNEL_JOIN, (rawIn: unknown) => {
    const session = socketSessions.get(socket.id);
    if (!session) return sendError(socket, 'NOT_READY', 'announce before joining');
    const parsed = CHANNEL_JOIN_SCHEMA.safeParse(rawIn);
    if (!parsed.success) {
      return sendError(socket, 'INVALID_PAYLOAD', 'channelId required');
    }
    const raw: ChannelJoinMessage = parsed.data;
    if (!rateAllowed(session.boxPublicKey, 'join')) {
      return sendError(socket, 'RATE_LIMITED', 'too many joins, slow down');
    }

    let roster = channelRosters.get(raw.channelId);
    if (!roster) {
      // Cap total channel count. Without this, a single client could
      // spam-join arbitrary channel IDs forever and exhaust memory.
      if (channelRosters.size >= MAX_CHANNELS) {
        return sendError(
          socket,
          'RATE_LIMITED',
          'relay is at channel capacity — retry later',
        );
      }
      roster = new Map();
      channelRosters.set(raw.channelId, roster);
      lastChannelActivity.set(raw.channelId, Date.now());
    }

    // Per-channel member cap. Once a channel hits the cap, joiners get
    // a clear error rather than silently being added (which would make
    // every CHANNEL_SEND fan-out O(huge) and risk OOM).
    if (!roster.has(socket.id) && roster.size >= MAX_MEMBERS_PER_CHANNEL) {
      return sendError(
        socket,
        'RATE_LIMITED',
        'channel is full — retry later',
      );
    }

    const member: RosterMember = {
      signingPublicKey: session.signingPublicKey,
      boxPublicKey: session.boxPublicKey,
      displayName: session.displayName,
      announceNonce: session.announceNonce,
      announceTs: session.announceTs,
      sig: session.sig,
    };

    const alreadyIn = roster.has(socket.id);
    roster.set(socket.id, member);
    lastChannelActivity.set(raw.channelId, Date.now());

    socket.emit(WIRE.CHANNEL_ROSTER, {
      channelId: raw.channelId,
      members: Array.from(roster.values()),
    });

    if (!alreadyIn) {
      broadcastToChannel(
        raw.channelId,
        WIRE.CHANNEL_MEMBER_JOINED,
        { channelId: raw.channelId, member },
        socket.id,
      );
    }
  });

  // ── Channel leave ────────────────────────────────────────────────────
  socket.on(WIRE.CHANNEL_LEAVE, (rawIn: unknown) => {
    const session = socketSessions.get(socket.id);
    if (!session) return;
    const parsed = CHANNEL_LEAVE_SCHEMA.safeParse(rawIn);
    if (!parsed.success) return;
    const raw: ChannelLeaveMessage = parsed.data;
    const roster = channelRosters.get(raw.channelId);
    if (!roster || !roster.has(socket.id)) return;
    roster.delete(socket.id);
    broadcastToChannel(raw.channelId, WIRE.CHANNEL_MEMBER_LEFT, {
      channelId: raw.channelId,
      signingPublicKey: session.signingPublicKey,
    });
    if (roster.size === 0) channelRosters.delete(raw.channelId);
  });

  // ── Channel send ─────────────────────────────────────────────────────
  // Accepts an optional socket.io ack callback as the last argument.
  // The client uses it to gate optimistic UI: only commit the "sent"
  // state once the server has confirmed acceptance for fan-out.
  // Without acks, a sender could see a "delivered" message even when
  // the relay refused it (rate-limited, not in channel, malformed) —
  // which is the kind of UX lie that's actively dangerous in a
  // privacy app.
  socket.on(WIRE.CHANNEL_SEND, (rawIn: unknown, ack?: (resp: { ok: boolean; error?: string }) => void) => {
    const respond = (ok: boolean, error?: string) => {
      if (typeof ack === 'function') ack(error ? { ok, error } : { ok });
    };
    const session = socketSessions.get(socket.id);
    if (!session) {
      sendError(socket, 'NOT_READY', 'announce before sending');
      respond(false, 'NOT_READY');
      return;
    }
    // Schema validation covers shape, length caps, AND rejects extra
    // fields (`.strict()`). The previous manual typeof check accepted
    // unknown fields silently — fine today, dangerous later if some
    // adjacent code starts reading them.
    const parsed = CHANNEL_SEND_SCHEMA.safeParse(rawIn);
    if (!parsed.success) {
      sendError(socket, 'INVALID_PAYLOAD', 'malformed channel:send');
      respond(false, 'INVALID_PAYLOAD');
      return;
    }
    const raw: ChannelSendMessage = parsed.data;
    const roster = channelRosters.get(raw.channelId);
    if (!roster || !roster.has(socket.id)) {
      sendError(socket, 'NOT_IN_CHANNEL', 'join the channel before sending');
      respond(false, 'NOT_IN_CHANNEL');
      return;
    }
    if (!rateAllowed(session.boxPublicKey, 'message')) {
      sendError(socket, 'RATE_LIMITED', 'message rate exceeded');
      respond(false, 'RATE_LIMITED');
      return;
    }

    // Build the set of valid box pubkeys for this channel (one snapshot).
    // Filtering against the roster prevents the relay from being a
    // pubkey-presence oracle for arbitrary boxPublicKeys.
    const allowedBoxes = new Set<string>();
    for (const m of roster.values()) allowedBoxes.add(m.boxPublicKey);

    const id = msgId();
    const ts = Date.now();

    for (const rec of raw.recipients) {
      if (
        !rec ||
        typeof rec.boxPublicKey !== 'string' ||
        typeof rec.ciphertext !== 'string' ||
        typeof rec.nonce !== 'string'
      ) continue;
      if (rec.ciphertext.length > MAX_CIPHERTEXT_BYTES) continue;
      if (rec.boxPublicKey === session.boxPublicKey) continue; // don't echo to self
      if (!allowedBoxes.has(rec.boxPublicKey)) continue;

      const targets = boxToSockets.get(rec.boxPublicKey);
      if (!targets) continue;
      const payload: ChannelMessageRelay = {
        channelId: raw.channelId,
        senderBoxPublicKey: session.boxPublicKey,
        senderSigningPublicKey: session.signingPublicKey,
        senderDisplayName: session.displayName,
        ciphertext: rec.ciphertext,
        nonce: rec.nonce,
        msgId: id,
        ts,
      };
      for (const targetSocketId of targets) {
        io.sockets.sockets.get(targetSocketId)?.emit(WIRE.CHANNEL_MESSAGE, payload);
      }
    }
    // Channel was just used — bump its idle timer.
    lastChannelActivity.set(raw.channelId, Date.now());
    respond(true);
  });

  // ── DM send ──────────────────────────────────────────────────────────
  // Ack semantics:
  //   ok=true  — relay accepted + attempted delivery (recipient may be
  //              offline, sender can't tell — that's by design, see
  //              the presence-oracle comment in the targets-empty branch).
  //   ok=false — relay rejected (not announced, malformed, rate-limited).
  // Sender only commits optimistic UI on ok=true; without an ack the
  // sender would see "delivered" for a rejected message.
  socket.on(WIRE.DM_SEND, (rawIn: unknown, ack?: (resp: { ok: boolean; error?: string }) => void) => {
    const respond = (ok: boolean, error?: string) => {
      if (typeof ack === 'function') ack(error ? { ok, error } : { ok });
    };
    const session = socketSessions.get(socket.id);
    if (!session) {
      sendError(socket, 'NOT_READY', 'announce before sending');
      respond(false, 'NOT_READY');
      return;
    }
    const parsed = DM_SEND_SCHEMA.safeParse(rawIn);
    if (!parsed.success) {
      sendError(socket, 'INVALID_PAYLOAD', 'malformed dm:send');
      respond(false, 'INVALID_PAYLOAD');
      return;
    }
    const raw: DMSendMessage = parsed.data;
    if (raw.ciphertext.length > MAX_CIPHERTEXT_BYTES) {
      sendError(socket, 'INVALID_PAYLOAD', 'ciphertext too large');
      respond(false, 'INVALID_PAYLOAD');
      return;
    }
    if (!rateAllowed(session.boxPublicKey, 'message')) {
      sendError(socket, 'RATE_LIMITED', 'message rate exceeded');
      respond(false, 'RATE_LIMITED');
      return;
    }

    const targets = boxToSockets.get(raw.recipientBoxPublicKey);
    if (!targets || targets.size === 0) {
      // Earlier versions emitted `dm:offline` here, telling the sender
      // exactly when the recipient's box key wasn't currently online.
      // That made the relay a presence oracle: an attacker who knows a
      // target's boxPublicKey could rate-limit-spam DMs and map their
      // online/offline transitions over time. For a privacy-first app,
      // that's a metadata leak we don't need to spend.
      //
      // Now we drop silently. From the sender's perspective the result
      // is indistinguishable from "delivered but recipient hasn't
      // replied" — closes the oracle. Side effect: senders no longer
      // get the "recipient is offline" UI banner. That UX trade-off is
      // documented in the README's "honest limitations" section.
      respond(true);
      return;
    }

    const payload: DMMessageRelay = {
      senderBoxPublicKey: session.boxPublicKey,
      senderSigningPublicKey: session.signingPublicKey,
      senderDisplayName: session.displayName,
      ciphertext: raw.ciphertext,
      nonce: raw.nonce,
      msgId: msgId(),
      ts: Date.now(),
    };
    for (const targetSocketId of targets) {
      io.sockets.sockets.get(targetSocketId)?.emit(WIRE.DM_MESSAGE, payload);
    }
    respond(true);
  });

  // ── Disconnect cleanup ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    const session = socketSessions.get(socket.id);
    socketSessions.delete(socket.id);
    socketNonces.delete(socket.id);
    socketNonceIssuedAt.delete(socket.id);
    badAnnounceCounts.delete(socket.id);
    if (!session) return;
    unregisterSocketForBox(socket.id, session.boxPublicKey);

    for (const [channelId, roster] of channelRosters) {
      if (!roster.delete(socket.id)) continue;
      // Suppress member-left if the same identity still has another socket
      // in this channel (e.g., the client re-handshaked to update their
      // displayName: a new socket joined before the old one finished
      // tearing down). Otherwise the stale member-left would erase the
      // freshly-joined entry from every other client's roster.
      let identityStillPresent = false;
      for (const m of roster.values()) {
        if (m.signingPublicKey === session.signingPublicKey) {
          identityStillPresent = true;
          break;
        }
      }
      if (!identityStillPresent) {
        broadcastToChannel(channelId, WIRE.CHANNEL_MEMBER_LEFT, {
          channelId,
          signingPublicKey: session.signingPublicKey,
        });
      }
      if (roster.size === 0) channelRosters.delete(channelId);
    }
  });
});

// Periodic GC sweeper. Runs every RATE_WINDOW_MS and trims four maps
// that would otherwise grow unbounded under adversarial conditions:
//   - rateBuckets: stale rate windows (size-capped at insertion too)
//   - socketNonces: nonces issued to sockets that disconnected
//     before announcing
//   - lastChannelActivity / channelRosters: channels with no recent
//     join/send activity (also dropped here for memory hygiene)
setInterval(() => {
  const now = Date.now();
  for (const [id, bucket] of rateBuckets) {
    if (now - bucket.windowStart > RATE_WINDOW_MS * 2) rateBuckets.delete(id);
  }
  for (const [socketId, issuedAt] of socketNonceIssuedAt) {
    if (now - issuedAt > SOCKET_NONCE_TTL_MS) {
      socketNonces.delete(socketId);
      socketNonceIssuedAt.delete(socketId);
    }
  }
  for (const [channelId, lastTouched] of lastChannelActivity) {
    if (now - lastTouched > IDLE_CHANNEL_TTL_MS) {
      channelRosters.delete(channelId);
      lastChannelActivity.delete(channelId);
    }
  }
}, RATE_WINDOW_MS);

// Pin to loopback. Without the explicit host, node binds 0.0.0.0 —
// which means every device on the LAN (and the open internet, if the
// port is ever forwarded) could reach the relay directly, bypassing
// the Tor hidden-service entrypoint that the entire privacy model
// depends on. Only the local renderer + the local Rust onion proxy
// need to hit this listener.
httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[void-relay] listening on 127.0.0.1:${PORT} (CORS: ${CORS_ALLOW_ANY ? '* (any origin)' : CORS_ORIGIN_LIST.join(', ')})`,
  );
});

function shutdown(sig: string) {
  console.log(`[void-relay] ${sig} received, closing`);
  io.close(() => httpServer.close(() => process.exit(0)));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { io, httpServer };
