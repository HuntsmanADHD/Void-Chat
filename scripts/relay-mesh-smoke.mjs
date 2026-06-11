/**
 * Two-client local mesh smoke test for the raw-WebSocket relay (Phase 6).
 * Drives the full realtime protocol over the new `{t,d,id}` envelope: signed
 * handshake → session:ack, $ping/$pong, channel join + roster, member-joined
 * broadcast, ack-gated channel send + per-recipient decrypt, DM + sender_sig
 * forwarding + decrypt, bad-announce → wire:error, disconnect → member-left.
 *
 * Exercises rooms/broadcast/fan-out with two real connections. Does NOT cover
 * cross-host-over-Tor (needs a live onion — see PHASE6_PLAN.md step 4).
 *
 * Run a relay on :3999 (SOCKET_PORT=3999 ./relay/target/debug/voidchat-relay)
 * with tweetnacl+bs58 reachable (byte-identical to the shipping noble shim);
 * adjust the createRequire base path below, then: node scripts/relay-mesh-smoke.mjs
 */
import { createRequire } from 'module';
const require = createRequire('/tmp/nobletest/');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const b64 = (u) => Buffer.from(u).toString('base64');
const utf8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const URL = 'ws://localhost:3999/ws';

function mkClient(name) {
  const box = nacl.box.keyPair(), sign = nacl.sign.keyPair();
  const c = {
    name, box, sign,
    signB58: bs58.encode(sign.publicKey), boxB58: bs58.encode(box.publicKey),
    ws: new WebSocket(URL), q: [], waiters: [],
  };
  c.ws.onmessage = (ev) => {
    const f = JSON.parse(ev.data);
    const w = c.waiters.find((w) => w.t === f.t);
    if (w) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(f); } else c.q.push(f);
  };
  c.next = (t, ms = 3000) => new Promise((resolve, reject) => {
    const hit = c.q.find((f) => f.t === t);
    if (hit) { c.q.splice(c.q.indexOf(hit), 1); return resolve(hit); }
    const to = setTimeout(() => reject(new Error(`${name}: timeout waiting ${t}`)), ms);
    c.waiters.push({ t, resolve: (f) => { clearTimeout(to); resolve(f); } });
  });
  c.send = (t, d, id) => c.ws.send(JSON.stringify(id !== undefined ? { t, d, id } : { t, d }));
  c.open = () => new Promise((r) => { c.ws.onopen = r; });
  return c;
}
function announce(c, nonce) {
  const ts = Date.now(), displayName = c.name;
  const signed = `${nonce}|${c.boxB58}|${displayName}|${ts}`;
  const sig = bs58.encode(nacl.sign.detached(utf8(signed), c.sign.secretKey));
  c.send('session:announce', { signingPublicKey: c.signB58, boxPublicKey: c.boxB58, displayName, ts, sig, nonce });
}
function joinSig(c, channelId, joinTs) {
  const canon = ['void/join/v1', channelId, c.signB58, c.boxB58, String(joinTs)].join('|');
  return bs58.encode(nacl.sign.detached(utf8(canon), c.sign.secretKey));
}
function seal(plaintext, recipientBoxB58, senderBoxSec) {
  const nonce = nacl.randomBytes(24);
  const ct = nacl.box(utf8(plaintext), nonce, bs58.decode(recipientBoxB58), senderBoxSec);
  return { ciphertext: b64(ct), nonce: b64(nonce) };
}
function dmSig(c, recipientBoxB58, nonceB64, ctB64) {
  const canon = ['void/dm/v1', c.signB58, c.boxB58, recipientBoxB58, nonceB64, ctB64].join('|');
  return bs58.encode(nacl.sign.detached(utf8(canon), c.sign.secretKey));
}

let fails = 0; const ok = (c, m) => { if (!c) { console.log('FAIL:', m); fails++; } else console.log('ok:', m); };
const CH = 'smoke-channel';

const A = mkClient('alice'), B = mkClient('bob');
await Promise.all([A.open(), B.open()]);

// 1. handshake: each gets a nonce, announces, gets session:ack
const an = await A.next('connection:nonce'); announce(A, an.d.nonce);
ok((await A.next('session:ack')).d.ok === true, 'alice session:ack');
const bn = await B.next('connection:nonce'); announce(B, bn.d.nonce);
ok((await B.next('session:ack')).d.ok === true, 'bob session:ack');

// 2. heartbeat
A.send('$ping'); ok((await A.next('$pong')).t === '$pong', 'alice $ping→$pong');

// 3. alice joins → roster has just alice
let jt = Date.now(); A.send('channel:join', { channelId: CH, joinSig: joinSig(A, CH, jt), joinTs: jt });
const ar = await A.next('channel:roster');
ok(ar.d.channelId === CH && ar.d.members.length === 1 && ar.d.members[0].signingPublicKey === A.signB58, 'alice roster = [alice]');

// 4. bob joins → bob's roster has alice+bob; alice gets member-joined for bob
jt = Date.now(); B.send('channel:join', { channelId: CH, joinSig: joinSig(B, CH, jt), joinTs: jt });
const br = await B.next('channel:roster');
ok(br.d.members.length === 2, 'bob roster = [alice,bob]');
const mj = await A.next('channel:member-joined');
ok(mj.d.member.signingPublicKey === B.signB58, 'alice notified bob joined (room broadcast)');

// 5. alice → channel message to bob (per-recipient seal); bob receives + decrypts
{ const s = seal('hello channel', B.boxB58, A.box.secretKey);
  A.send('channel:send', { channelId: CH, recipients: [{ boxPublicKey: B.boxB58, ciphertext: s.ciphertext, nonce: s.nonce }] }, 1);
  const ack = await A.next('$ack'); ok(ack.id === 1 && ack.d.ok === true, 'alice channel:send acked');
  const cm = await B.next('channel:message');
  const pt = nacl.box.open(Buffer.from(cm.d.ciphertext,'base64'), Buffer.from(cm.d.nonce,'base64'), bs58.decode(cm.d.senderBoxPublicKey), B.box.secretKey);
  ok(pt && Buffer.from(pt).toString('utf8') === 'hello channel', 'bob received+decrypted channel message');
}

// 6. alice → DM to bob; bob receives + decrypts; sender_sig forwarded
{ const s = seal('secret dm', B.boxB58, A.box.secretKey);
  const sig = dmSig(A, B.boxB58, s.nonce, s.ciphertext);
  A.send('dm:send', { recipientBoxPublicKey: B.boxB58, ciphertext: s.ciphertext, nonce: s.nonce, senderSig: sig }, 2);
  const ack = await A.next('$ack'); ok(ack.id === 2 && ack.d.ok === true, 'alice dm:send acked');
  const dm = await B.next('dm:message');
  ok(dm.d.senderSig === sig, 'dm sender_sig forwarded verbatim');
  const pt = nacl.box.open(Buffer.from(dm.d.ciphertext,'base64'), Buffer.from(dm.d.nonce,'base64'), bs58.decode(dm.d.senderBoxPublicKey), B.box.secretKey);
  ok(pt && Buffer.from(pt).toString('utf8') === 'secret dm', 'bob received+decrypted DM');
}

// 7. bad announce → wire:error; 8. disconnect → member-left broadcast
{ const C = mkClient('mallory'); await C.open(); await C.next('connection:nonce');
  C.send('session:announce', { signingPublicKey: 'x', boxPublicKey: 'y', displayName: 'm', ts: Date.now(), sig: 'z', nonce: 'bad' });
  ok((await C.next('wire:error')).d.code !== undefined, 'bad announce → wire:error'); C.ws.close(); }

// 8. bob disconnects → alice gets member-left
B.ws.close();
const ml = await A.next('channel:member-left');
ok(ml.d.signingPublicKey === B.signB58, 'alice notified bob left (disconnect cleanup)');

A.ws.close();
console.log(fails === 0 ? '\n✅ TWO-CLIENT MESH SMOKE PASSED' : `\n❌ ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
