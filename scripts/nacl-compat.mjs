/**
 * Cross-implementation equivalence proof for the noble-backed crypto shims.
 *
 * Proves that `src/lib/nacl.ts` and `src/lib/base58.ts` are byte-for-byte
 * compatible with the original `tweetnacl` / `bs58` they replaced — so the
 * tweetnacl→noble migration cannot silently change ciphertext, signatures,
 * key derivation, or encoding (existing identities + the Rust relay's
 * ed25519 sig checks keep working).
 *
 * tweetnacl and bs58 are intentionally NOT project dependencies anymore, so
 * install them ad-hoc to run this proof:
 *
 *   npm i --no-save tweetnacl bs58
 *   node scripts/nacl-compat.mjs
 *
 * Node strips the TS types when importing the shims directly (Node >= 22).
 * Exits non-zero on any mismatch.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nacl0 = require('tweetnacl');
const bs0 = require('bs58').default || require('bs58');
const { default: nacl } = await import('../src/lib/nacl.ts');
const { default: bs58 } = await import('../src/lib/base58.ts');

const hex = (b) => Buffer.from(b).toString('hex');
const eq = (a, b) => a.length === b.length && hex(a) === hex(b);
let fails = 0;
const fail = (m) => { console.log('FAIL:', m); fails++; };

// box: byte-equal to tweetnacl, opens interop both ways, rejects tampering
for (let t = 0; t < 400; t++) {
  const a = nacl0.box.keyPair(), b = nacl0.box.keyPair();
  const n = nacl0.randomBytes(24), m = nacl0.randomBytes((t * 11) % 160);
  const ref = nacl0.box(m, n, b.publicKey, a.secretKey);
  const got = nacl.box(m, n, b.publicKey, a.secretKey);
  if (!eq(ref, got)) { fail('box ciphertext mismatch len=' + m.length); break; }
  if (!eq(nacl0.box.open(got, n, a.publicKey, b.secretKey), m)) { fail('tweetnacl cannot open shim box'); break; }
  const op = nacl.box.open(ref, n, a.publicKey, b.secretKey);
  if (!op || !eq(op, m)) { fail('shim cannot open tweetnacl box'); break; }
  const bad = got.slice(); bad[5] ^= 2;
  if (nacl.box.open(bad, n, a.publicKey, b.secretKey) !== null) { fail('shim opened tampered box'); break; }
}
// x25519 public-key derivation matches (identity preservation)
for (let t = 0; t < 100; t++) {
  const sk = nacl0.randomBytes(32);
  if (!eq(nacl0.box.keyPair.fromSecretKey(sk).publicKey, nacl.box.keyPair.fromSecretKey(sk).publicKey)) {
    fail('box pubkey derivation mismatch'); break;
  }
}
// ed25519: shim sigs verify in tweetnacl and vice-versa; key format = seed||pub
for (let t = 0; t < 300; t++) {
  const kp = nacl0.sign.keyPair(), m = nacl0.randomBytes((t * 7) % 150);
  const ref = nacl0.sign.detached(m, kp.secretKey), got = nacl.sign.detached(m, kp.secretKey);
  if (!eq(ref, got)) { fail('signature mismatch'); break; }
  if (!nacl0.sign.detached.verify(m, got, kp.publicKey)) { fail('tweetnacl rejects shim sig'); break; }
  if (!nacl.sign.detached.verify(m, ref, kp.publicKey)) { fail('shim rejects tweetnacl sig'); break; }
}
{
  const kp = nacl.sign.keyPair();
  if (kp.secretKey.length !== 64 || kp.publicKey.length !== 32) fail('shim sign keyPair sizes');
  if (!eq(kp.secretKey.subarray(32), kp.publicKey)) fail('shim secretKey is not seed||pub');
}
// API constants
if (nacl.box.nonceLength !== 24 || nacl.box.publicKeyLength !== 32 || nacl.box.secretKeyLength !== 32 ||
    nacl.sign.signatureLength !== 64 || nacl.sign.publicKeyLength !== 32 || nacl.sign.secretKeyLength !== 64) {
  fail('length constants');
}
// base58 == bs58 (incl. leading-zero edge cases)
for (let t = 0; t < 300; t++) {
  const len = t % 40, arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = (Math.random() * 256) | 0;
  if (t % 4 === 0 && len > 1) arr[0] = 0;
  if (bs0.encode(arr) !== bs58.encode(arr)) { fail('base58 encode mismatch'); break; }
  if (hex(bs58.decode(bs0.encode(arr))) !== hex(arr)) { fail('base58 decode roundtrip'); break; }
}

console.log(fails === 0 ? '✅ shims match tweetnacl/bs58 across all vectors' : `❌ ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
