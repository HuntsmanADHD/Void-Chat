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
 * Resolve the relay URL for this client.
 *
 * Priority:
 *   1. `NEXT_PUBLIC_VOID_RELAY_URL` env override (for deploys that proxy
 *      the relay through a non-default host/path, e.g. `wss://alice.tld/ws`).
 *   2. Same-origin + `:3001`. This is the right answer for almost every
 *      self-host setup: the web app and the relay run on the same machine,
 *      so the client just talks to whatever host the browser loaded from.
 *   3. `http://localhost:3001` as the SSR/test fallback (when `window` is
 *      undefined). The real value is recomputed on the client once mounted.
 */
function resolveRelayUrl(): string {
  const override =
    typeof process !== 'undefined' && process.env['NEXT_PUBLIC_VOID_RELAY_URL'];
  if (override) return override;
  if (typeof window === 'undefined') return `http://localhost:${RELAY_PORT}`;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:${RELAY_PORT}`;
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
        entry.roster.set(m.boxPublicKey, m);
        this.rememberPeer(m);
      }
      this.emitRoster(raw.channelId);
    });

    socket.on(WIRE.CHANNEL_MEMBER_JOINED, (raw: ChannelMemberJoinedMessage) => {
      const entry = this.channels.get(raw.channelId);
      if (!entry) return;
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
      // Remember the sender so DM lookups still work after we leave this channel.
      this.rememberPeer({
        signingPublicKey: raw.senderSigningPublicKey,
        boxPublicKey: raw.senderBoxPublicKey,
        displayName: raw.senderDisplayName,
      });
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
      this.rememberPeer({
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
    const ts = Date.now();
    const signedBody = `${this.pendingNonce}|${this.session.boxPublicKey}|${this.session.displayName}|${ts}`;
    const sigBytes = nacl.sign.detached(
      new TextEncoder().encode(signedBody),
      this.session.signingSecretKey,
    );
    const payload: SessionAnnounceMessage = {
      signingPublicKey: this.session.signingPublicKey,
      boxPublicKey: this.session.boxPublicKey,
      displayName: this.session.displayName,
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
