/**
 * Unit tests for the raw-WebSocket transport manager (`src/lib/wsConn.ts`),
 * the socket.io-client replacement (Phase 6, step 1). Drives WsConn against a
 * mock WebSocket so the envelope encode/decode, ack-id correlation, heartbeat
 * frame, disconnect handling, and reconnect/backoff are deterministic.
 *
 * Self-contained — no dependencies, Node strips the TS types of the imported
 * module:
 *
 *   node scripts/wsconn-test.mjs
 *
 * NOTE: this proves the client transport is internally consistent. It does NOT
 * prove the live protocol works — that needs the relay (step 2) and the
 * two-client-over-Tor smoke test (PHASE6_PLAN.md, step 4).
 */
const OPEN = 1, CLOSED = 3;
let live = null;
class MockWS {
  static OPEN = OPEN;
  static CLOSED = CLOSED;
  constructor(url) {
    this.url = url;
    this.readyState = OPEN;
    this.sent = [];
    this.onopen = this.onclose = this.onerror = this.onmessage = null;
    live = this;
    queueMicrotask(() => { if (this.onopen) this.onopen(); });
  }
  send(s) { if (this.readyState !== OPEN) throw new Error('not open'); this.sent.push(s); }
  close() { if (this.readyState === CLOSED) return; this.readyState = CLOSED; if (this.onclose) this.onclose(); }
  recv(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
}
globalThis.WebSocket = MockWS;

const { WsConn, wsUrlFor } = await import('../src/lib/wsConn.ts');
let fails = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL:', m); fails++; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ok(wsUrlFor('http://localhost:3001') === 'ws://localhost:3001/ws', 'local url');
ok(wsUrlFor('http://localhost:11811/o/tok/onion') === 'ws://localhost:11811/o/tok/onion/ws', 'cross-host url');
ok(wsUrlFor('https://h:1/x/') === 'wss://h:1/x/ws', 'https→wss + trailing slash');

const c = new WsConn('ws://x/ws', { reconnectionDelay: 10, reconnectionDelayMax: 50 });
let connects = 0, disconnects = 0;
const nonces = [];
c.on('connect', () => connects++);
c.on('disconnect', () => disconnects++);
c.on('connection:nonce', (d) => nonces.push(d));
await sleep(0);
ok(connects === 1, 'connect fired on open');

c.emit('channel:join', { channelId: 'c1' });
const f1 = JSON.parse(live.sent.at(-1));
ok(f1.t === 'channel:join' && f1.d.channelId === 'c1' && !('id' in f1), 'plain emit envelope');

live.recv({ t: 'connection:nonce', d: { nonce: 'n1' } });
ok(nonces.length === 1 && nonces[0].nonce === 'n1', 'inbound dispatch by t');

let ackResp = 'unset';
c.emit('channel:send', { x: 1 }, (resp) => { ackResp = resp; });
const f2 = JSON.parse(live.sent.at(-1));
ok(typeof f2.id === 'number', 'ack emit carries id');
live.recv({ t: '$ack', id: f2.id, d: { ok: true } });
ok(ackResp && ackResp.ok === true, 'ack callback resolved with payload');

let ack2 = 'unset';
c.emit('dm:send', {}, (r) => { ack2 = r; });
const f3 = JSON.parse(live.sent.at(-1));
live.recv({ t: '$ack', id: f3.id + 999, d: { ok: true } });
ok(ack2 === 'unset', 'ack with unknown id ignored');
live.recv({ t: '$ack', id: f3.id, d: { ok: false } });
ok(ack2 && ack2.ok === false, 'correct id resolves; ok=false passes through');

let pongLeak = 0;
c.on('$pong', () => pongLeak++);
live.recv({ t: '$pong' });
ok(pongLeak === 0, '$pong not dispatched to listeners');

const c2 = new WsConn('ws://y/ws', { reconnectionDelay: 10, reconnectionDelayMax: 50 });
await sleep(0);
let pend = 'unset';
c2.emit('channel:send', {}, (r) => { pend = r; });
const prevLive = live;
live.close();
ok(pend === undefined, 'pending ack resolved undefined (→false) on disconnect');
await sleep(80);
ok(live !== prevLive, 'reconnect created a new socket after drop');

const c3 = new WsConn('ws://z/ws', { reconnectionDelay: 10, reconnectionDelayMax: 50 });
await sleep(0);
const liveBefore = live;
c3.disconnect();
await sleep(80);
ok(live === liveBefore, 'no reconnect after intentional disconnect()');
ok(liveBefore.readyState === CLOSED, 'disconnect() closed the socket');

console.log(fails === 0 ? '✅ WsConn unit checks pass' : `❌ ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
