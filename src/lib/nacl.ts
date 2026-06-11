/**
 * tweetnacl-compatible crypto, implemented on Paul Millr's audited noble
 * stack (`@noble/curves` + `@noble/ciphers`). This is the single audited
 * boundary for the app's e2ee primitives — every call site keeps using the
 * exact `nacl.*` surface it always did, so storage formats and identities
 * are unchanged.
 *
 * Compatibility is not assumed, it is PROVEN: a cross-impl harness checks
 * byte-equality against the original `tweetnacl` for box (both directions +
 * the canonical NaCl test vector), ed25519 sign/verify (with the seed
 * mapping below), and x25519 public-key derivation. See DEPENDENCY_AUDIT.md
 * Phase 3 + `scripts/nacl-compat.mjs`.
 *
 * Key formats (identical to tweetnacl, so existing sessions keep working):
 *   - sign secretKey  = 64 bytes = seed(32) ‖ publicKey(32)
 *   - sign publicKey  = 32 bytes
 *   - box  secretKey  = 32 bytes (raw X25519 scalar)
 *   - box  publicKey  = 32 bytes
 *
 * NaCl `crypto_box` construction reproduced exactly:
 *   shared   = X25519(mySecret, theirPublic)         // raw scalarmult
 *   boxKey   = HSalsa20(sigma, shared, zeroNonce)     // crypto_box_beforenm
 *   sealed   = XSalsa20-Poly1305(boxKey, nonce24, m)  // crypto_box_afternm
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa.js';

const BOX_PUBLIC_KEY_LENGTH = 32;
const BOX_SECRET_KEY_LENGTH = 32;
const BOX_NONCE_LENGTH = 24;
const SIGN_PUBLIC_KEY_LENGTH = 32;
const SIGN_SECRET_KEY_LENGTH = 64;
const SIGN_SEED_LENGTH = 32;
const SIGN_SIGNATURE_LENGTH = 64;

/** Salsa "expand 32-byte k" constant as four little-endian words. */
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // getRandomValues caps at 65536 bytes/call; loop for safety (callers use ≤64).
  for (let off = 0; off < n; off += 65536) {
    crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, n)));
  }
  return out;
}

/** crypto_box_beforenm: X25519 ECDH → HSalsa20 key derivation. */
function beforenm(theirPublic: Uint8Array, mySecret: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(mySecret, theirPublic);
  const dv = new DataView(shared.buffer, shared.byteOffset, 32);
  const k = new Uint32Array(8);
  for (let i = 0; i < 8; i++) k[i] = dv.getUint32(i * 4, true);
  const out = new Uint32Array(8);
  hsalsa(SIGMA, k, new Uint32Array(4), out);
  const key = new Uint8Array(32);
  const odv = new DataView(key.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, out[i], true);
  return key;
}

function boxFn(
  message: Uint8Array,
  nonce: Uint8Array,
  theirPublic: Uint8Array,
  mySecret: Uint8Array,
): Uint8Array {
  return xsalsa20poly1305(beforenm(theirPublic, mySecret), nonce).encrypt(message);
}

function boxOpen(
  sealed: Uint8Array,
  nonce: Uint8Array,
  theirPublic: Uint8Array,
  mySecret: Uint8Array,
): Uint8Array | null {
  try {
    return xsalsa20poly1305(beforenm(theirPublic, mySecret), nonce).decrypt(sealed);
  } catch {
    return null; // bad key / tampered ciphertext — matches tweetnacl's null
  }
}

function boxKeyPairFromSecretKey(secretKey: Uint8Array): KeyPair {
  return { publicKey: x25519.getPublicKey(secretKey), secretKey };
}

function boxKeyPair(): KeyPair {
  return boxKeyPairFromSecretKey(randomBytes(BOX_SECRET_KEY_LENGTH));
}

const box = Object.assign(boxFn, {
  open: boxOpen,
  keyPair: Object.assign(boxKeyPair, { fromSecretKey: boxKeyPairFromSecretKey }),
  publicKeyLength: BOX_PUBLIC_KEY_LENGTH,
  secretKeyLength: BOX_SECRET_KEY_LENGTH,
  nonceLength: BOX_NONCE_LENGTH,
});

function signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  // tweetnacl secretKey is seed(32)‖pub(32); noble signs from the 32-byte seed.
  return ed25519.sign(message, secretKey.subarray(0, SIGN_SEED_LENGTH));
}

function signDetachedVerify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false; // malformed sig/key → false, matching tweetnacl (never throws)
  }
}

function signKeyPair(): KeyPair {
  const seed = randomBytes(SIGN_SEED_LENGTH);
  const publicKey = ed25519.getPublicKey(seed);
  const secretKey = new Uint8Array(SIGN_SECRET_KEY_LENGTH);
  secretKey.set(seed, 0);
  secretKey.set(publicKey, SIGN_SEED_LENGTH);
  return { publicKey, secretKey };
}

const sign = {
  keyPair: signKeyPair,
  detached: Object.assign(signDetached, { verify: signDetachedVerify }),
  publicKeyLength: SIGN_PUBLIC_KEY_LENGTH,
  secretKeyLength: SIGN_SECRET_KEY_LENGTH,
  signatureLength: SIGN_SIGNATURE_LENGTH,
};

const nacl = { box, sign, randomBytes };

export default nacl;
