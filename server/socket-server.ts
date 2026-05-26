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
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_MESSAGES = 120;
const RATE_MAX_JOINS = 60;
const MAX_CHANNEL_RECIPIENTS = 256;
// 64 KiB plaintext cap → ciphertext is plaintext + 16-byte Poly1305 tag,
// then base64-expanded by 4/3. Bound it well above what a polite client
// would ever send to leave room for nonce/json overhead.
const MAX_CIPHERTEXT_BYTES = 96 * 1024;

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
const boxToSockets = new Map<string, Set<string>>();
const channelRosters = new Map<string, Map<string, RosterMember>>();
const rateBuckets = new Map<string, RateBucket>();

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
});

io.on('connection', (socket: Socket) => {
  const nonce = issueNonce();
  socketNonces.set(socket.id, nonce);
  socket.emit(WIRE.CONNECTION_NONCE, { nonce });

  // ── Announce ─────────────────────────────────────────────────────────
  socket.on(WIRE.SESSION_ANNOUNCE, (raw: SessionAnnounceMessage) => {
    if (
      !raw ||
      typeof raw.signingPublicKey !== 'string' ||
      typeof raw.boxPublicKey !== 'string' ||
      typeof raw.displayName !== 'string' ||
      typeof raw.ts !== 'number' ||
      typeof raw.sig !== 'string' ||
      typeof raw.nonce !== 'string'
    ) {
      sendError(socket, 'INVALID_PAYLOAD', 'malformed announce');
      return;
    }
    if (Math.abs(Date.now() - raw.ts) > ANNOUNCE_MAX_SKEW_MS) {
      sendError(socket, 'STALE_TIMESTAMP', 'announce timestamp out of skew window');
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
        sendError(socket, 'INVALID_PAYLOAD', 'malformed public key');
        return;
      }
    } catch {
      sendError(socket, 'INVALID_PAYLOAD', 'public key not valid base58');
      return;
    }
    const expected = socketNonces.get(socket.id);
    if (!expected) {
      sendError(socket, 'BAD_NONCE', 'no nonce issued for this socket');
      return;
    }
    const ok = verifyAnnounceSignature(raw, expected);
    if (!ok) {
      sendError(socket, 'BAD_SIGNATURE', 'announce signature invalid');
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
      sendError(
        socket,
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

    socket.emit(WIRE.SESSION_ACK, { ok: true });
  });

  // ── Channel join ─────────────────────────────────────────────────────
  socket.on(WIRE.CHANNEL_JOIN, (raw: ChannelJoinMessage) => {
    const session = socketSessions.get(socket.id);
    if (!session) return sendError(socket, 'NOT_READY', 'announce before joining');
    if (!raw || typeof raw.channelId !== 'string') {
      return sendError(socket, 'INVALID_PAYLOAD', 'channelId required');
    }
    if (!rateAllowed(session.boxPublicKey, 'join')) {
      return sendError(socket, 'RATE_LIMITED', 'too many joins, slow down');
    }

    let roster = channelRosters.get(raw.channelId);
    if (!roster) {
      roster = new Map();
      channelRosters.set(raw.channelId, roster);
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
  socket.on(WIRE.CHANNEL_LEAVE, (raw: ChannelLeaveMessage) => {
    const session = socketSessions.get(socket.id);
    if (!session || !raw || typeof raw.channelId !== 'string') return;
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
  socket.on(WIRE.CHANNEL_SEND, (raw: ChannelSendMessage) => {
    const session = socketSessions.get(socket.id);
    if (!session) return sendError(socket, 'NOT_READY', 'announce before sending');
    if (!raw || typeof raw.channelId !== 'string' || !Array.isArray(raw.recipients)) {
      return sendError(socket, 'INVALID_PAYLOAD', 'malformed channel:send');
    }
    if (raw.recipients.length === 0 || raw.recipients.length > MAX_CHANNEL_RECIPIENTS) {
      return sendError(socket, 'INVALID_PAYLOAD', 'recipients length out of range');
    }
    const roster = channelRosters.get(raw.channelId);
    if (!roster || !roster.has(socket.id)) {
      return sendError(socket, 'NOT_IN_CHANNEL', 'join the channel before sending');
    }
    if (!rateAllowed(session.boxPublicKey, 'message')) {
      return sendError(socket, 'RATE_LIMITED', 'message rate exceeded');
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
  });

  // ── DM send ──────────────────────────────────────────────────────────
  socket.on(WIRE.DM_SEND, (raw: DMSendMessage) => {
    const session = socketSessions.get(socket.id);
    if (!session) return sendError(socket, 'NOT_READY', 'announce before sending');
    if (
      !raw ||
      typeof raw.recipientBoxPublicKey !== 'string' ||
      typeof raw.ciphertext !== 'string' ||
      typeof raw.nonce !== 'string'
    ) {
      return sendError(socket, 'INVALID_PAYLOAD', 'malformed dm:send');
    }
    if (raw.ciphertext.length > MAX_CIPHERTEXT_BYTES) {
      return sendError(socket, 'INVALID_PAYLOAD', 'ciphertext too large');
    }
    if (!rateAllowed(session.boxPublicKey, 'message')) {
      return sendError(socket, 'RATE_LIMITED', 'message rate exceeded');
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
  });

  // ── Disconnect cleanup ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    const session = socketSessions.get(socket.id);
    socketSessions.delete(socket.id);
    socketNonces.delete(socket.id);
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

// Periodic GC of stale rate buckets (sockets that disconnected leave nothing,
// but a long-idle socket could hold a stale bucket past its window).
setInterval(() => {
  const now = Date.now();
  for (const [id, bucket] of rateBuckets) {
    if (now - bucket.windowStart > RATE_WINDOW_MS * 2) rateBuckets.delete(id);
  }
}, RATE_WINDOW_MS);

httpServer.listen(PORT, () => {
  console.log(
    `[void-relay] listening on :${PORT} (CORS: ${CORS_ALLOW_ANY ? '* (any origin)' : CORS_ORIGIN_LIST.join(', ')})`,
  );
});

function shutdown(sig: string) {
  console.log(`[void-relay] ${sig} received, closing`);
  io.close(() => httpServer.close(() => process.exit(0)));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { io, httpServer };
