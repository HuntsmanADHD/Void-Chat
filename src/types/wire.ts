/**
 * Wire protocol shared between the renderer (`useRealtime`) and the
 * Rust relay sidecar (`relay/src/realtime.rs`). The relay never
 * decrypts; all message bodies are nacl.box-encrypted by the sender
 * to one specific recipient's box public key.
 *
 * Authentication is connection-bound: on connect the server emits
 * `connection:nonce` with a server-issued random nonce. The client signs
 * `nonce | boxPublicKey | displayName | ts` with its session signing key and
 * sends `session:announce`. The server verifies freshness (±5min) and
 * signature, then registers the boxPublicKey → socketId routing entry.
 * Replay of a captured announce on a different socket fails because the
 * nonce belongs to that socket only.
 *
 * All `boxPublicKey` / `signingPublicKey` values are base58-encoded.
 */

// ── Server → Client ────────────────────────────────────────────────────────

export interface ConnectionNonceMessage {
  nonce: string;
}

export interface SessionAckMessage {
  ok: true;
}

export interface RosterMember {
  signingPublicKey: string;
  boxPublicKey: string;
  displayName: string;
  /**
   * The member's announce binding, re-broadcast verbatim by the relay
   * so other clients can verify that this `boxPublicKey` was actually
   * chosen by the holder of `signingPublicKey`. Without these fields a
   * malicious relay could hand out its own `boxPublicKey` for every
   * member and silently MITM the e2ee.
   *
   * To verify, the recipient reconstructs the signed payload as
   * `${announceNonce}|${boxPublicKey}|${displayName}|${announceTs}` and
   * runs ed25519 verify against `signingPublicKey`.
   *
   * Marked optional only for forward-compat with older relays during
   * rollout; new code MUST refuse to use any member missing these fields.
   */
  announceNonce?: string;
  announceTs?: number;
  sig?: string;
}

export interface ChannelRosterMessage {
  channelId: string;
  members: RosterMember[];
}

export interface ChannelMemberJoinedMessage {
  channelId: string;
  member: RosterMember;
}

export interface ChannelMemberLeftMessage {
  channelId: string;
  signingPublicKey: string;
}

export interface ChannelMessageRelay {
  channelId: string;
  senderBoxPublicKey: string;
  senderSigningPublicKey: string;
  senderDisplayName: string;
  ciphertext: string;
  nonce: string;
  msgId: string;
  ts: number;
}

export interface DMMessageRelay {
  senderBoxPublicKey: string;
  senderSigningPublicKey: string;
  senderDisplayName: string;
  ciphertext: string;
  nonce: string;
  msgId: string;
  ts: number;
}

// `DMOfflineMessage` (and the WIRE.DM_OFFLINE constant below) were
// removed in audit pt5 M1. See realtimeClient.ts for the rationale.

export interface WireErrorMessage {
  code:
    | 'NOT_READY'
    | 'BAD_SIGNATURE'
    | 'STALE_TIMESTAMP'
    | 'BAD_NONCE'
    | 'RATE_LIMITED'
    | 'NOT_IN_CHANNEL'
    | 'INVALID_PAYLOAD';
  message: string;
}

// ── Client → Server ────────────────────────────────────────────────────────

export interface SessionAnnounceMessage {
  signingPublicKey: string;
  boxPublicKey: string;
  displayName: string;
  /** Epoch ms — server requires |now - ts| ≤ 5min */
  ts: number;
  /** ed25519 signature of `nonce | boxPublicKey | displayName | ts` */
  sig: string;
  /** The nonce the server issued via `connection:nonce` on this socket */
  nonce: string;
}

export interface ChannelJoinMessage {
  channelId: string;
}

export interface ChannelLeaveMessage {
  channelId: string;
}

export interface ChannelRecipientCiphertext {
  /** Recipient's box public key, base58. */
  boxPublicKey: string;
  /** nacl.box ciphertext, base64. */
  ciphertext: string;
  /** nacl.box nonce, base64. */
  nonce: string;
}

export interface ChannelSendMessage {
  channelId: string;
  recipients: ChannelRecipientCiphertext[];
}

export interface DMSendMessage {
  recipientBoxPublicKey: string;
  ciphertext: string;
  nonce: string;
}

// ── Event name constants (keeps client + server in lockstep) ───────────────

export const WIRE = {
  // server → client
  CONNECTION_NONCE: 'connection:nonce',
  SESSION_ACK: 'session:ack',
  CHANNEL_ROSTER: 'channel:roster',
  CHANNEL_MEMBER_JOINED: 'channel:member-joined',
  CHANNEL_MEMBER_LEFT: 'channel:member-left',
  CHANNEL_MESSAGE: 'channel:message',
  DM_MESSAGE: 'dm:message',
  // DM_OFFLINE removed (audit pt5 M1) — presence oracle.
  ERROR: 'wire:error',
  // client → server
  SESSION_ANNOUNCE: 'session:announce',
  CHANNEL_JOIN: 'channel:join',
  CHANNEL_LEAVE: 'channel:leave',
  CHANNEL_SEND: 'channel:send',
  DM_SEND: 'dm:send',
} as const;
