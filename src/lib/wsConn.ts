/**
 * Minimal raw-WebSocket connection manager — the slice of the socket.io-client
 * `Socket` API that `realtimeClient.ts` uses, reimplemented to drop the
 * `socket.io-client` dependency. See PHASE6_PLAN.md.
 *
 * Wire envelope (one JSON text frame per message):
 *   c → s:  { t: "<event>", d: <payload>, id?: <number> }   // id only on acks
 *   s → c:  { t: "<event>", d: <payload> }
 *   ack:    { t: "$ack",  id: <number>, d: { ok: boolean } }
 *   beat:   c → s { t: "$ping" }   s → c { t: "$pong" }
 *
 * `<event>` strings are the existing `WIRE.*` names, so consumers are unchanged.
 *
 * Reproduces the socket.io behaviors this app relied on:
 *   - synthetic `connect` / `disconnect` events (fired on WS open / close),
 *   - `emit(event, payload, ackCb?)` with ack-id correlation,
 *   - listeners that PERSIST across automatic reconnects (only `removeAllListeners`
 *     clears them); reconnect uses exponential backoff,
 *   - application-level heartbeat (`$ping`/`$pong`) — NOT WS ping/pong, which
 *     browser JS cannot observe or send. Keeps idle Tor circuits warm and lets
 *     each side detect a dead peer.
 */

export interface WsConnOptions {
  /** Initial reconnect backoff in ms (default 500). */
  reconnectionDelay?: number;
  /** Max reconnect backoff in ms (default 5000). */
  reconnectionDelayMax?: number;
}

type Listener = (payload: unknown) => void;
type AckCallback = (resp: { ok?: unknown } | undefined) => void;

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

interface Envelope {
  t: string;
  d?: unknown;
  id?: number;
}

export class WsConn {
  private ws: WebSocket | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pendingAcks = new Map<number, AckCallback>();
  private nextAckId = 1;

  private closedByClient = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly url: string;
  private readonly baseDelay: number;
  private readonly maxDelay: number;

  constructor(url: string, options: WsConnOptions = {}) {
    this.url = url;
    this.baseDelay = options.reconnectionDelay ?? 500;
    this.maxDelay = options.reconnectionDelayMax ?? 5_000;
    this.open();
  }

  // ── socket.io-compatible surface ──────────────────────────────────────

  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
  }

  /**
   * Emit an event. If `ack` is supplied, the frame carries an id and `ack` is
   * invoked with the server's `$ack` payload (or `undefined` if the socket is
   * not open / disconnects first — matching the caller's "resolve false" path).
   */
  emit(event: string, payload?: unknown, ack?: AckCallback): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (ack) ack(undefined);
      return;
    }
    const frame: Envelope = { t: event, d: payload };
    if (ack) {
      const id = this.nextAckId++;
      frame.id = id;
      this.pendingAcks.set(id, ack);
    }
    try {
      this.ws.send(JSON.stringify(frame));
    } catch {
      if (ack && frame.id !== undefined) {
        this.pendingAcks.delete(frame.id);
        ack(undefined);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  /** Intentional close — no reconnect. */
  disconnect(): void {
    this.closedByClient = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.failPendingAcks();
    if (this.ws) {
      this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        // already closing/closed
      }
      this.ws = null;
    }
  }

  // ── internals ─────────────────────────────────────────────────────────

  private open(): void {
    this.closedByClient = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.fire('connect', undefined);
    };

    ws.onmessage = (ev) => {
      this.handleFrame(ev.data);
    };

    ws.onerror = () => {
      // `onclose` always follows; reconnect is handled there.
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.failPendingAcks();
      if (this.ws === ws) this.ws = null;
      this.fire('disconnect', undefined);
      if (!this.closedByClient) this.scheduleReconnect();
    };
  }

  private handleFrame(data: unknown): void {
    if (typeof data !== 'string') return; // we only speak JSON text frames
    let frame: Envelope;
    try {
      frame = JSON.parse(data) as Envelope;
    } catch {
      return; // drop malformed frame
    }
    if (!frame || typeof frame.t !== 'string') return;

    if (frame.t === '$pong') {
      this.armWatchdog();
      return;
    }
    if (frame.t === '$ack') {
      if (typeof frame.id === 'number') {
        const cb = this.pendingAcks.get(frame.id);
        if (cb) {
          this.pendingAcks.delete(frame.id);
          cb(frame.d as { ok?: unknown } | undefined);
        }
      }
      return;
    }
    this.fire(frame.t, frame.d);
  }

  private fire(event: string, payload: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  private scheduleReconnect(): void {
    if (this.closedByClient || this.reconnectTimer) return;
    const delay = Math.min(this.baseDelay * 2 ** this.reconnectAttempts, this.maxDelay);
    this.reconnectAttempts++;
    // Full jitter to avoid thundering-herd redial against a relay that just died.
    const jittered = Math.random() * delay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, jittered);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.armWatchdog();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ t: '$ping' }));
        } catch {
          // send failure → onclose will fire and reconnect
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** Reset the "server is alive" deadline; expiry forces a reconnect. */
  private armWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      // No $pong within the window — treat the socket as half-open. Closing
      // triggers onclose → scheduleReconnect.
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // ignore
        }
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private failPendingAcks(): void {
    if (this.pendingAcks.size === 0) return;
    const cbs = [...this.pendingAcks.values()];
    this.pendingAcks.clear();
    for (const cb of cbs) cb(undefined); // resolves emitWithAck → false
  }
}

/**
 * Build the WebSocket URL from the relay's http(s) URL: swap the scheme and
 * append the `/ws` path, preserving any cross-host onion-proxy prefix
 * (`/o/<token>/<onion>`). Replaces the old socket.io `splitSocketIoUrl`.
 *   http://localhost:3001                 → ws://localhost:3001/ws
 *   http://localhost:11811/o/<tok>/<onion> → ws://localhost:11811/o/<tok>/<onion>/ws
 */
export function wsUrlFor(httpUrl: string): string {
  try {
    const u = new URL(httpUrl);
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = u.pathname.replace(/\/+$/, '');
    return `${wsProto}//${u.host}${base}/ws`;
  } catch {
    return httpUrl;
  }
}
