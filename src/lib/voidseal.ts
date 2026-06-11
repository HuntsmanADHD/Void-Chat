/**
 * VoidSeal box — public-key authenticated message encryption that replaces
 * `nacl.box` in the message path. This is the TS counterpart of the Java
 * seal module (`seal-java/`), the same libsodium construction
 * `crypto_box_curve25519xchacha20poly1305`:
 *
 *   shared = X25519(mySecret, theirPublic)          // ECDH (noble x25519)
 *   boxKey = HChaCha20(key = shared, in = zeros16)   // beforenm
 *   sealed = XChaCha20-Poly1305(boxKey, nonce24, m)  // afternm
 *
 * The AEAD core (ChaCha20 + Poly1305 + RFC 8439 AEAD) is the user's verified
 * VoidSeal, vendored unchanged as `voidchacha.js`. This file adds HChaCha20,
 * the XChaCha20 nonce extension, and the X25519 box, and exposes a surface
 * matching `encryption.ts` (base58 public keys, base64 ciphertext + nonce).
 *
 * ⚠️ WIRE-FORMAT CHANGE: this is NOT compatible with the old `nacl.box`
 * (XSalsa20-Poly1305). Cutover is a flag day. Byte-for-byte equivalence with
 * the Java seal is proven in `scripts/seal-compat.mjs`.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import bs58 from './base58';
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from './naclUtil';
import VoidSeal from './voidchacha.js';

const PUBLIC_KEY_LENGTH = 32;
const SECRET_KEY_LENGTH = 32;
const NONCE_LENGTH = 24;

/** Matches encryption.ts MAX_PLAINTEXT_BYTES (the 64 KiB seal cap). */
export const MAX_PLAINTEXT_BYTES = 64 * 1024;

export interface SealedMessage {
  ciphertext: string; // base64(ct ‖ tag)
  nonce: string; // base64(24-byte nonce)
}

// ── HChaCha20 (draft-irtf-cfrg-xchacha §2.2) ─────────────────────────────

const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function le32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function hchacha20(key: Uint8Array, in16: Uint8Array): Uint8Array {
  let s0 = SIGMA[0], s1 = SIGMA[1], s2 = SIGMA[2], s3 = SIGMA[3];
  let s4 = le32(key, 0), s5 = le32(key, 4), s6 = le32(key, 8), s7 = le32(key, 12);
  let s8 = le32(key, 16), s9 = le32(key, 20), s10 = le32(key, 24), s11 = le32(key, 28);
  let s12 = le32(in16, 0), s13 = le32(in16, 4), s14 = le32(in16, 8), s15 = le32(in16, 12);

  for (let r = 0; r < 10; r++) {
    // column round
    s0 = (s0 + s4) >>> 0; s12 = rotl(s12 ^ s0, 16);
    s8 = (s8 + s12) >>> 0; s4 = rotl(s4 ^ s8, 12);
    s0 = (s0 + s4) >>> 0; s12 = rotl(s12 ^ s0, 8);
    s8 = (s8 + s12) >>> 0; s4 = rotl(s4 ^ s8, 7);
    s1 = (s1 + s5) >>> 0; s13 = rotl(s13 ^ s1, 16);
    s9 = (s9 + s13) >>> 0; s5 = rotl(s5 ^ s9, 12);
    s1 = (s1 + s5) >>> 0; s13 = rotl(s13 ^ s1, 8);
    s9 = (s9 + s13) >>> 0; s5 = rotl(s5 ^ s9, 7);
    s2 = (s2 + s6) >>> 0; s14 = rotl(s14 ^ s2, 16);
    s10 = (s10 + s14) >>> 0; s6 = rotl(s6 ^ s10, 12);
    s2 = (s2 + s6) >>> 0; s14 = rotl(s14 ^ s2, 8);
    s10 = (s10 + s14) >>> 0; s6 = rotl(s6 ^ s10, 7);
    s3 = (s3 + s7) >>> 0; s15 = rotl(s15 ^ s3, 16);
    s11 = (s11 + s15) >>> 0; s7 = rotl(s7 ^ s11, 12);
    s3 = (s3 + s7) >>> 0; s15 = rotl(s15 ^ s3, 8);
    s11 = (s11 + s15) >>> 0; s7 = rotl(s7 ^ s11, 7);
    // diagonal round
    s0 = (s0 + s5) >>> 0; s15 = rotl(s15 ^ s0, 16);
    s10 = (s10 + s15) >>> 0; s5 = rotl(s5 ^ s10, 12);
    s0 = (s0 + s5) >>> 0; s15 = rotl(s15 ^ s0, 8);
    s10 = (s10 + s15) >>> 0; s5 = rotl(s5 ^ s10, 7);
    s1 = (s1 + s6) >>> 0; s12 = rotl(s12 ^ s1, 16);
    s11 = (s11 + s12) >>> 0; s6 = rotl(s6 ^ s11, 12);
    s1 = (s1 + s6) >>> 0; s12 = rotl(s12 ^ s1, 8);
    s11 = (s11 + s12) >>> 0; s6 = rotl(s6 ^ s11, 7);
    s2 = (s2 + s7) >>> 0; s13 = rotl(s13 ^ s2, 16);
    s8 = (s8 + s13) >>> 0; s7 = rotl(s7 ^ s8, 12);
    s2 = (s2 + s7) >>> 0; s13 = rotl(s13 ^ s2, 8);
    s8 = (s8 + s13) >>> 0; s7 = rotl(s7 ^ s8, 7);
    s3 = (s3 + s4) >>> 0; s14 = rotl(s14 ^ s3, 16);
    s9 = (s9 + s14) >>> 0; s4 = rotl(s4 ^ s9, 12);
    s3 = (s3 + s4) >>> 0; s14 = rotl(s14 ^ s3, 8);
    s9 = (s9 + s14) >>> 0; s4 = rotl(s4 ^ s9, 7);
  }

  const out = new Uint8Array(32);
  const words = [s0, s1, s2, s3, s12, s13, s14, s15];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = words[i] & 0xff;
    out[i * 4 + 1] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (words[i] >>> 24) & 0xff;
  }
  return out;
}

// ── XChaCha20-Poly1305 (24-byte nonce) ───────────────────────────────────

function xchachaSubnonce(nonce24: Uint8Array): { subkeyNonce: Uint8Array; n12: Uint8Array } {
  const subkeyNonce = nonce24.subarray(0, 16);
  const n12 = new Uint8Array(12); // 0x00000000 ‖ nonce24[16:24]
  n12.set(nonce24.subarray(16, 24), 4);
  return { subkeyNonce, n12 };
}

function xseal(key: Uint8Array, nonce24: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const { subkeyNonce, n12 } = xchachaSubnonce(nonce24);
  const subkey = hchacha20(key, subkeyNonce);
  const { ciphertext, tag } = VoidSeal.seal(subkey, n12, plaintext);
  const out = new Uint8Array(ciphertext.length + 16);
  out.set(ciphertext, 0);
  out.set(tag, ciphertext.length);
  return out;
}

function xopen(key: Uint8Array, nonce24: Uint8Array, ctWithTag: Uint8Array): Uint8Array | null {
  if (ctWithTag.length < 16) return null;
  const { subkeyNonce, n12 } = xchachaSubnonce(nonce24);
  const subkey = hchacha20(key, subkeyNonce);
  const ct = ctWithTag.subarray(0, ctWithTag.length - 16);
  const tag = ctWithTag.subarray(ctWithTag.length - 16);
  return VoidSeal.open(subkey, n12, ct, tag);
}

// ── X25519 box ───────────────────────────────────────────────────────────

const ZERO16 = new Uint8Array(16);

/** crypto_box beforenm: X25519 ECDH → HChaCha20 key derivation. */
function beforenm(theirPublic: Uint8Array, mySecret: Uint8Array): Uint8Array | null {
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(mySecret, theirPublic);
  } catch {
    return null; // low-order point / invalid
  }
  let acc = 0;
  for (const b of shared) acc |= b;
  if (acc === 0) return null;
  return hchacha20(shared, ZERO16);
}

/**
 * Seal `plaintext` to a recipient box public key (base58) using the sender's
 * box secret (raw 32 bytes). Returns base64 ciphertext + nonce, or null if
 * the recipient key is malformed or plaintext exceeds the cap.
 */
export function sealForRecipient(
  plaintext: string,
  recipientBoxPublicKeyB58: string,
  senderBoxSecretKey: Uint8Array,
): SealedMessage | null {
  const plainBytes = decodeUTF8(plaintext);
  if (plainBytes.length > MAX_PLAINTEXT_BYTES) return null;
  if (senderBoxSecretKey.length !== SECRET_KEY_LENGTH) return null;

  let recipientPub: Uint8Array;
  try {
    recipientPub = bs58.decode(recipientBoxPublicKeyB58);
  } catch {
    return null;
  }
  if (recipientPub.length !== PUBLIC_KEY_LENGTH) return null;

  const boxKey = beforenm(recipientPub, senderBoxSecretKey);
  if (!boxKey) return null;

  const nonce = new Uint8Array(NONCE_LENGTH);
  crypto.getRandomValues(nonce);
  const sealed = xseal(boxKey, nonce, plainBytes);
  return { ciphertext: encodeBase64(sealed), nonce: encodeBase64(nonce) };
}

/**
 * Open a sealed message from a sender box public key (base58). Returns
 * plaintext, or null on malformed input / authentication failure.
 */
export function openFromSender(
  ciphertextB64: string,
  nonceB64: string,
  senderBoxPublicKeyB58: string,
  recipientBoxSecretKey: Uint8Array,
): string | null {
  if (recipientBoxSecretKey.length !== SECRET_KEY_LENGTH) return null;

  let senderPub: Uint8Array;
  let ctWithTag: Uint8Array;
  let nonce: Uint8Array;
  try {
    senderPub = bs58.decode(senderBoxPublicKeyB58);
    ctWithTag = decodeBase64(ciphertextB64);
    nonce = decodeBase64(nonceB64);
  } catch {
    return null;
  }
  if (senderPub.length !== PUBLIC_KEY_LENGTH) return null;
  if (nonce.length !== NONCE_LENGTH) return null;

  const boxKey = beforenm(senderPub, recipientBoxSecretKey);
  if (!boxKey) return null;

  const opened = xopen(boxKey, nonce, ctWithTag);
  if (!opened) return null;
  return encodeUTF8(opened);
}

/** Derive the box public key (raw 32 bytes) from a raw 32-byte secret. */
export function boxPublicKeyFromSecret(secret: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secret);
}

/** Exposed for the cross-impl proof in scripts/seal-compat.mjs. */
export const _internal = { hchacha20, xseal, xopen };
