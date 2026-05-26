/**
 * Module-level realtime client. One socket per tab, shared across every
 * page that mounts `useRealtime`. Owns connection state, per-channel
 * rosters, and the encrypt-on-send / decrypt-on-receive pipeline so
 * pages can deal in plaintext only.
 *
 * State machine:
 *   disconnected → connecting → handshaking → ready
 *                         ↑                       │
 *                         └─── reconnect ─────────┘
 *
 * `handshaking` covers everything from socket-connect through awaiting
 * session:ack: receiving the server nonce, signing the announce, sending
 * it, and waiting for the ack. The connection is not usable to consumers
 * until state becomes `ready`.
 */

import { io as ioClient, type Socket } from 'socket.io-client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import { MAX_PLAINTEXT_BYTES, openFromSender, sealForRecipient } from './encryption';
import { appendChannel as storeAppendChannel, appendDM as storeAppendDM, setActiveSession } from './messageStore';
import type { Session } from '@/types/session';
import {
  WIRE,
  type ChannelMemberJoinedMessage,
  type ChannelMemberLeftMessage,
  type ChannelMessageRelay,
  type ChannelRosterMessage,
  type ChannelSendMessage,
  type ConnectionNonceMessage,
  type DMMessageRelay,
  type DMOfflineMessage,
  type DMSendMessage,
  type RosterMember,
  type SessionAnnounceMessage,
  type WireErrorMessage,
} from '@/types/wire';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'ready';

export interface DecryptedChannelMessage {
  channelId: string;
  msgId: string;
  ts: number;
  senderSigningPublicKey: string;
  senderBoxPublicKey: string;
  senderDisplayName: string;
  plaintext: string;
}

export interface DecryptedDMMessage {
  msgId: string;
  ts: number;
  senderSigningPublicKey: string;
  senderBoxPublicKey: string;
  senderDisplayName: string;
  plaintext: string;
}

type ChannelMessageListener = (msg: DecryptedChannelMessage) => void;
type DMMessageListener = (msg: DecryptedDMMessage) => void;
type RosterListener = (channelId: string, roster: RosterMember[]) => void;
type StateListener = (state: ConnectionState) => void;
type OfflineDMListener = (recipientBoxPublicKey: string) => void;

interface ChannelEntry {
  /** Reference count — channel stays joined while any subscriber is mounted. */
  refCount: number;
  roster: Map<string, RosterMember>; // keyed by boxPublicKey
}

const RELAY_PORT = 3001;

/**
 * Verify that a roster entry's `boxPublicKey` was actually chosen by the
 * holder of `signingPublicKey`. The relay re-broadcasts the original
 * announce binding (nonce, ts, sig); we reconstruct the signed payload
 * and run ed25519 verify against the claimed signing key.
 *
 * A roster entry that fails verification means the relay is either
 * misbehaving (substituting box keys to MITM e2ee) or running an old
 * server that doesn't forward sigs yet. Either way, the safe response
 * is to drop the entry — without a verified box key, sending to this
 * "member" would route ciphertext to whatever box the relay chose.
 *
 * Note on freshness: the server enforces the ±5min skew at announce
 * accept, so any sig we receive in a roster was fresh at announce
 * time. Once that holds, the sig is good for as long as the session
 * is alive — re-checking ts client-side would reject anyone who's
 * been connected longer than 5 minutes. A "stale" sig replayed for
 * an offline user is a presence-oracle concern (see audit #9), not
 * an MITM one — the box key is still genuinely that user's.
 */
const rosterTextEncoder = new TextEncoder();

function verifyRosterMember(m: RosterMember): boolean {
  if (
    typeof m.announceNonce !== 'string' ||
    typeof m.announceTs !== 'number' ||
    typeof m.sig !== 'string'
  ) {
    return false;
  }
  try {
    const signed = `${m.announceNonce}|${m.boxPublicKey}|${m.displayName}|${m.announceTs}`;
    const sigBytes = bs58.decode(m.sig);
    const pubBytes = bs58.decode(m.signingPublicKey);
    if (sigBytes.length !== nacl.sign.signatureLength) return false;
    if (pubBytes.length !== nacl.sign.publicKeyLength) return false;
    return nacl.sign.detached.verify(
      rosterTextEncoder.encode(signed),
      sigBytes,
      pubBytes,
    );
  } catch {
    return false;
  }
}

/**
 * Default relay endpoint. Always the local relay on this machine —
 * Tauri builds bundle the relay as a sidecar of the app.
 *
 * Note: the previous version of this function honored a
 * `NEXT_PUBLIC_VOID_RELAY_URL` env override, a leftover from when the
 * project shipped as a Next.js webapp. Vite inlines such values at
 * build time, which would have leaked the *build's* relay URL to every
 * user of that installer — exactly the kind of identity-pinning we run
 * over Tor to avoid. Removed entirely; cross-host routing is plumbed
 * via the per-community `relayBaseFor()` mechanism in relayBase.ts.
 */
function resolveRelayUrl(): string {
  return `http://localhost:${RELAY_PORT}`;
}

class RealtimeClient {
  private socket: Socket | null = null;
  private session: Session | null = null;
  private state: ConnectionState = 'disconnected';
  private pendingNonce: string | null = null;
  private currentUrl: string | null = null;

  private channels = new Map<string, ChannelEntry>();
  /**
   * Long-lived cache of peers we've ever observed (in a channel roster or
   * as a message sender). Lets DM lookups by signing key survive leaving
   * the channel where we discovered them. Capped via LRU eviction — at
   * 500 entries we keep the 500 most-recently-seen peers and let the
   * older ones fall off. Insertion order of `Map` is the iteration order,
   * so re-inserting on touch is enough.
   */
  private peerCache = new Map<string, RosterMember>();
  private static readonly PEER_CACHE_MAX = 500;

  private channelMessageListeners = new Set<ChannelMessageListener>();
  private dmMessageListeners = new Set<DMMessageListener>();
  private rosterListeners = new Set<RosterListener>();
  private stateListeners = new Set<StateListener>();
  private offlineDMListeners = new Set<OfflineDMListener>();

  init(session: Session, urlOverride?: string): void {
    const url = urlOverride ?? resolveRelayUrl();
    const keypairChanged =
      this.session && this.session.boxPublicKey !== session.boxPublicKey;
    const nameChanged =
      this.session &&
      this.session.boxPublicKey === session.boxPublicKey &&
      this.session.displayName !== session.displayName;
    const urlChanged = this.currentUrl !== null && this.currentUrl !== url;

    if (keypairChanged) {
      // Identity change — drop channel state too; the user is now somebody else.
      this.disconnect();
    } else if (urlChanged) {
      // Switching relays (e.g. user navigated from a local community to a
      // remote one). Tear down the socket AND the channel rosters — the
      // refCounts stay so when consumers re-join channels against the new
      // relay, they reattach naturally. Peer cache is dropped too since
      // box-key mappings from the old relay don't apply.
      this.tearDownSocket();
      this.channels.clear();
      this.peerCache.clear();
    } else if (nameChanged) {
      // Same identity, new display name. Kill the socket so we hand back a
      // fresh nonce + announce on reconnect; keep channel refCounts so the
      // SESSION_ACK handler re-joins each one and the server broadcasts the
      // updated roster entry for free.
      this.tearDownSocket();
    }

    this.session = session;
    // Bind the persistence layer to this session. Errors here are
    // non-fatal — the chat works without history in private-mode
    // browsers that block IndexedDB.
    void setActiveSession(session.boxPublicKey).catch((err) => {
      console.warn('[realtime] could not bind messageStore', err);
    });
    if (this.socket) return;

    this.currentUrl = url;
    this.setState('connecting');
    this.socket = ioClient(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
    });
    this.wireSocketEvents(this.socket);
  }

  disconnect(): void {
    this.tearDownSocket();
    this.channels.clear();
    this.peerCache.clear();
  }

  private tearDownSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.pendingNonce = null;
    // Drop rosters but keep refCounts — they describe what consumers still
    // believe they're subscribed to, and the next ack-handler replays joins.
    for (const entry of this.channels.values()) entry.roster.clear();
    this.setState('disconnected');
  }

  getState(): ConnectionState {
    return this.state;
  }

  getRoster(channelId: string): RosterMember[] {
    const entry = this.channels.get(channelId);
    if (!entry) return [];
    return Array.from(entry.roster.values());
  }

  /**
   * Find a known box public key given a signing public key, by scanning
   * every channel roster we currently hold. Returns null if no channel
   * we're in contains this user — DMing them isn't possible until we
   * share a channel with them.
   */
  lookupBoxKey(signingPublicKey: string): string | null {
    for (const entry of this.channels.values()) {
      for (const member of entry.roster.values()) {
        if (member.signingPublicKey === signingPublicKey) return member.boxPublicKey;
      }
    }
    const cached = this.peerCache.get(signingPublicKey);
    if (!cached) return null;
    // Touch on hit so an actively-used peer doesn't get evicted.
    this.peerCache.delete(signingPublicKey);
    this.peerCache.set(signingPublicKey, cached);
    return cached.boxPublicKey;
  }

  private rememberPeer(member: RosterMember): void {
    // Re-insert to push to the back of the iteration order (LRU touch).
    this.peerCache.delete(member.signingPublicKey);
    this.peerCache.set(member.signingPublicKey, member);
    while (this.peerCache.size > RealtimeClient.PEER_CACHE_MAX) {
      const oldest = this.peerCache.keys().next().value;
      if (oldest === undefined) break;
      this.peerCache.delete(oldest);
    }
  }

  /**
   * Refresh-or-skip variant called from message-receive paths
   * (CHANNEL_MESSAGE / DM_MESSAGE) where the announce sig isn't carried
   * inline. Without the sig we can't independently verify the
   * (signing, box) pair, so we only update an EXISTING verified
   * binding (e.g. display-name change). A new binding from a message
   * is rejected — otherwise a malicious relay could craft a message
   * claiming sender = Alice signing key with relay's box key,
   * decrypt-succeed (the relay holds the box secret), and poison the
   * peer cache so Bob's future DMs to Alice get MITM'd.
   */
  private touchExistingPeer(member: RosterMember): void {
    const existing = this.peerCache.get(member.signingPublicKey);
    if (!existing) return;
    if (existing.boxPublicKey !== member.boxPublicKey) {
      // Relay claims this sender's box key changed. Could be a real
      // identity rotation (user re-announced) but indistinguishable
      // from a MITM attempt. The safe default is to drop the cached
      // entry and wait for a fresh verified roster broadcast.
      this.peerCache.delete(member.signingPublicKey);
      return;
    }
    // Same binding — safe to refresh display name + LRU-touch.
    this.peerCache.delete(member.signingPublicKey);
    this.peerCache.set(member.signingPublicKey, {
      ...existing,
      displayName: member.displayName,
    });
  }

  joinChannel(channelId: string): void {
    let entry = this.channels.get(channelId);
    if (!entry) {
      entry = { refCount: 0, roster: new Map() };
      this.channels.set(channelId, entry);
    }
    entry.refCount += 1;
    // Only emit join the first time the ref count goes positive. If we're
    // mid-handshake the SESSION_ACK handler will replay every channel we've
    // got refs for, so a pre-ready join lands on reconnect for free.
    if (entry.refCount === 1 && this.state === 'ready' && this.socket) {
      this.socket.emit(WIRE.CHANNEL_JOIN, { channelId });
    }
  }

  leaveChannel(channelId: string): void {
    const entry = this.channels.get(channelId);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount > 0) return;
    this.channels.delete(channelId);
    if (this.state === 'ready' && this.socket) {
      this.socket.emit(WIRE.CHANNEL_LEAVE, { channelId });
    }
  }

  async sendChannelMessage(channelId: string, plaintext: string): Promise<boolean> {
    const entry = this.channels.get(channelId);
    if (!entry || !this.session || !this.socket || this.state !== 'ready') return false;
    // Reject oversize input once, up front, instead of running the per-recipient
    // seal loop N times and watching every call fail.
    if (new TextEncoder().encode(plaintext).length > MAX_PLAINTEXT_BYTES) return false;

    const sealed: ChannelSendMessage = {
      channelId,
      recipients: [],
    };
    let hadAnyRecipient = false;
    for (const member of entry.roster.values()) {
      if (member.boxPublicKey === this.session.boxPublicKey) continue; // skip self
      hadAnyRecipient = true;
      const out = sealForRecipient(plaintext, member.boxPublicKey, this.session.boxSecretKey);
      if (!out) continue;
      sealed.recipients.push({
        boxPublicKey: member.boxPublicKey,
        ciphertext: out.ciphertext,
        nonce: out.nonce,
      });
    }
    // Channel of one (only us) — nothing to send, but the caller's optimistic
    // append already landed, so report success.
    if (!hadAnyRecipient) return true;
    if (sealed.recipients.length === 0) return false;
    this.socket.emit(WIRE.CHANNEL_SEND, sealed);
    return true;
  }

  async sendDM(recipientBoxPublicKey: string, plaintext: string): Promise<boolean> {
    if (!this.session || !this.socket || this.state !== 'ready') return false;
    const out = sealForRecipient(plaintext, recipientBoxPublicKey, this.session.boxSecretKey);
    if (!out) return false;
    const payload: DMSendMessage = {
      recipientBoxPublicKey,
      ciphertext: out.ciphertext,
      nonce: out.nonce,
    };
    this.socket.emit(WIRE.DM_SEND, payload);
    return true;
  }

  // ── subscriptions ─────────────────────────────────────────────────
  onChannelMessage(fn: ChannelMessageListener): () => void {
    this.channelMessageListeners.add(fn);
    return () => this.channelMessageListeners.delete(fn);
  }
  onDMMessage(fn: DMMessageListener): () => void {
    this.dmMessageListeners.add(fn);
    return () => this.dmMessageListeners.delete(fn);
  }
  onRosterChange(fn: RosterListener): () => void {
    this.rosterListeners.add(fn);
    return () => this.rosterListeners.delete(fn);
  }
  onStateChange(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }
  onDMOffline(fn: OfflineDMListener): () => void {
    this.offlineDMListeners.add(fn);
    return () => this.offlineDMListeners.delete(fn);
  }

  // ── internals ─────────────────────────────────────────────────────

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const fn of this.stateListeners) fn(next);
  }

  private emitRoster(channelId: string): void {
    const entry = this.channels.get(channelId);
    const roster = entry ? Array.from(entry.roster.values()) : [];
    for (const fn of this.rosterListeners) fn(channelId, roster);
  }

  private wireSocketEvents(socket: Socket): void {
    socket.on('connect', () => {
      // Wait for the server's nonce before announcing.
      this.setState('handshaking');
    });

    socket.on('disconnect', () => {
      this.pendingNonce = null;
      // Clear rosters — server will resend on rejoin. Keep channel refCounts.
      for (const entry of this.channels.values()) entry.roster.clear();
      // Notify subscribers that rosters dropped.
      for (const channelId of this.channels.keys()) this.emitRoster(channelId);
      this.setState('connecting');
    });

    socket.on(WIRE.CONNECTION_NONCE, (raw: ConnectionNonceMessage) => {
      this.pendingNonce = raw?.nonce ?? null;
      this.sendAnnounce();
    });

    socket.on(WIRE.SESSION_ACK, () => {
      this.setState('ready');
      // Replay channel joins (covers reconnects too).
      for (const channelId of this.channels.keys()) {
        socket.emit(WIRE.CHANNEL_JOIN, { channelId });
      }
    });

    socket.on(WIRE.CHANNEL_ROSTER, (raw: ChannelRosterMessage) => {
      const entry = this.channels.get(raw.channelId);
      if (!entry) return;
      entry.roster.clear();
      for (const m of raw.members) {
        if (!verifyRosterMember(m)) continue; // drop unverified entries
        entry.roster.set(m.boxPublicKey, m);
        this.rememberPeer(m);
      }
      this.emitRoster(raw.channelId);
    });

    socket.on(WIRE.CHANNEL_MEMBER_JOINED, (raw: ChannelMemberJoinedMessage) => {
      const entry = this.channels.get(raw.channelId);
      if (!entry) return;
      if (!verifyRosterMember(raw.member)) return;
      entry.roster.set(raw.member.boxPublicKey, raw.member);
      this.rememberPeer(raw.member);
      this.emitRoster(raw.channelId);
    });

    socket.on(WIRE.CHANNEL_MEMBER_LEFT, (raw: ChannelMemberLeftMessage) => {
      const entry = this.channels.get(raw.channelId);
      if (!entry) return;
      for (const [box, member] of entry.roster) {
        if (member.signingPublicKey === raw.signingPublicKey) {
          entry.roster.delete(box);
          break;
        }
      }
      this.emitRoster(raw.channelId);
    });

    socket.on(WIRE.CHANNEL_MESSAGE, (raw: ChannelMessageRelay) => {
      if (!this.session) return;
      const plaintext = openFromSender(
        raw.ciphertext,
        raw.nonce,
        raw.senderBoxPublicKey,
        this.session.boxSecretKey,
      );
      if (plaintext === null) return; // drop unauthenticated/tampered messages silently
      // Refresh-only: never adds a new (signing, box) binding to the
      // peer cache from a message — only the verified roster broadcast
      // can do that. See touchExistingPeer for the MITM rationale.
      this.touchExistingPeer({
        signingPublicKey: raw.senderSigningPublicKey,
        boxPublicKey: raw.senderBoxPublicKey,
        displayName: raw.senderDisplayName,
      });
      // Channel-roster cross-check: drop messages that claim a sender
      // (signing, box) pair that doesn't match the verified roster for
      // this channel. Prevents the relay from injecting fake messages
      // attributing them to channel members with a substituted box key.
      const channelEntry = this.channels.get(raw.channelId);
      const rosterMatch = channelEntry &&
        Array.from(channelEntry.roster.values()).some(
          (r) => r.signingPublicKey === raw.senderSigningPublicKey &&
                 r.boxPublicKey === raw.senderBoxPublicKey,
        );
      if (!rosterMatch) {
        // Either the relay is lying or we got the message before the
        // roster update arrived. Either way, don't decode + surface.
        return;
      }
      const decoded: DecryptedChannelMessage = {
        channelId: raw.channelId,
        msgId: raw.msgId,
        ts: raw.ts,
        senderSigningPublicKey: raw.senderSigningPublicKey,
        senderBoxPublicKey: raw.senderBoxPublicKey,
        senderDisplayName: raw.senderDisplayName,
        plaintext,
      };
      void storeAppendChannel(raw.channelId, {
        id: raw.msgId,
        ts: raw.ts,
        senderSigningPublicKey: raw.senderSigningPublicKey,
        senderBoxPublicKey: raw.senderBoxPublicKey,
        senderDisplayName: raw.senderDisplayName,
        plaintext,
      });
      for (const fn of this.channelMessageListeners) fn(decoded);
    });

    socket.on(WIRE.DM_MESSAGE, (raw: DMMessageRelay) => {
      if (!this.session) return;
      const plaintext = openFromSender(
        raw.ciphertext,
        raw.nonce,
        raw.senderBoxPublicKey,
        this.session.boxSecretKey,
      );
      if (plaintext === null) return;
      // Refresh-only: a DM from a peer we don't already have a verified
      // roster binding for is treated as unverified — the relay could
      // be claiming any signing key + its own box key. We accept the
      // message (it decrypted, so somebody who knows our box key sent
      // it) but don't poison the peer cache for future DMs. To reply,
      // the user must share a channel where the sender's binding can
      // be verified via the roster sig path.
      this.touchExistingPeer({
        signingPublicKey: raw.senderSigningPublicKey,
        boxPublicKey: raw.senderBoxPublicKey,
        displayName: raw.senderDisplayName,
      });
      const decoded: DecryptedDMMessage = {
        msgId: raw.msgId,
        ts: raw.ts,
        senderSigningPublicKey: raw.senderSigningPublicKey,
        senderBoxPublicKey: raw.senderBoxPublicKey,
        senderDisplayName: raw.senderDisplayName,
        plaintext,
      };
      void storeAppendDM(raw.senderSigningPublicKey, {
        id: raw.msgId,
        ts: raw.ts,
        senderSigningPublicKey: raw.senderSigningPublicKey,
        senderBoxPublicKey: raw.senderBoxPublicKey,
        senderDisplayName: raw.senderDisplayName,
        plaintext,
      });
      for (const fn of this.dmMessageListeners) fn(decoded);
    });

    socket.on(WIRE.DM_OFFLINE, (raw: DMOfflineMessage) => {
      for (const fn of this.offlineDMListeners) fn(raw.recipientBoxPublicKey);
    });

    socket.on(WIRE.ERROR, (raw: WireErrorMessage) => {
      console.warn('[realtime]', raw.code, raw.message);
    });
  }

  private sendAnnounce(): void {
    if (!this.session || !this.socket || !this.pendingNonce) return;
    // Canonicalize the displayName client-side before signing. The
    // relay rejects an announce whose signed displayName doesn't match
    // its post-trim form (so it can re-broadcast the exact bytes that
    // were signed, enabling other clients to verify the binding). The
    // trim+cap+fallback-to-'anon' here matches the server's expectation
    // exactly — without this, a name with trailing whitespace or >32
    // chars would be rejected with INVALID_PAYLOAD.
    const displayName = (this.session.displayName.trim().slice(0, 32)) || 'anon';
    const ts = Date.now();
    const signedBody = `${this.pendingNonce}|${this.session.boxPublicKey}|${displayName}|${ts}`;
    const sigBytes = nacl.sign.detached(
      new TextEncoder().encode(signedBody),
      this.session.signingSecretKey,
    );
    const payload: SessionAnnounceMessage = {
      signingPublicKey: this.session.signingPublicKey,
      boxPublicKey: this.session.boxPublicKey,
      displayName,
      ts,
      nonce: this.pendingNonce,
      sig: bs58.encode(sigBytes),
    };
    this.pendingNonce = null;
    this.socket.emit(WIRE.SESSION_ANNOUNCE, payload);
  }
}

let _singleton: RealtimeClient | null = null;

export function getRealtimeClient(): RealtimeClient {
  if (!_singleton) _singleton = new RealtimeClient();
  return _singleton;
}

export type { RealtimeClient };
