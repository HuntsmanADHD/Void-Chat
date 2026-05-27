/**
 * Ephemeral message encryption.
 *
 * Every channel/DM message is encrypted with `nacl.box` from the sender's
 * Curve25519 secret to one recipient's Curve25519 public. Channel sends do
 * this once per recipient (the per-recipient fan-out happens above this
 * layer). The relay never sees plaintext.
 *
 * Public keys on the wire are base58 (matching `Session`). Ciphertext and
 * nonce are base64 (random bytes — base64 is more compact than base58 and
 * encoding choice doesn't matter for opaque blobs).
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from 'tweetnacl-util';

export interface SealedMessage {
  ciphertext: string;
  nonce: string;
}

/**
 * Plaintext size cap. 64 KiB is generous for chat, well under typical
 * WebSocket frame limits, and bounds the per-recipient fan-out blast
 * radius (256 recipients × 64 KiB ≈ 16 MiB max single send).
 */
export const MAX_PLAINTEXT_BYTES = 64 * 1024;

/**
 * Encrypt `plaintext` to a single recipient's box public key (base58),
 * using the sender's session box secret (raw bytes). Returns base64-encoded
 * ciphertext + nonce, or `null` if the recipient pubkey is malformed or
 * the plaintext exceeds MAX_PLAINTEXT_BYTES.
 */
export function sealForRecipient(
  plaintext: string,
  recipientBoxPublicKeyB58: string,
  senderBoxSecretKey: Uint8Array,
): SealedMessage | null {
  const plainBytes = decodeUTF8(plaintext);
  if (plainBytes.length > MAX_PLAINTEXT_BYTES) return null;

  let recipientPub: Uint8Array;
  try {
    recipientPub = bs58.decode(recipientBoxPublicKeyB58);
  } catch {
    return null;
  }
  if (recipientPub.length !== nacl.box.publicKeyLength) return null;
  if (senderBoxSecretKey.length !== nacl.box.secretKeyLength) return null;

  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const sealed = nacl.box(plainBytes, nonce, recipientPub, senderBoxSecretKey);
  if (!sealed) return null;
  return { ciphertext: encodeBase64(sealed), nonce: encodeBase64(nonce) };
}

/**
 * Decrypt a `nacl.box` message addressed to this session, given the
 * sender's box public key (base58). Returns plaintext or `null` if the
 * ciphertext doesn't verify (wrong sender, tampered, or wrong recipient).
 */
export function openFromSender(
  ciphertextB64: string,
  nonceB64: string,
  senderBoxPublicKeyB58: string,
  recipientBoxSecretKey: Uint8Array,
): string | null {
  let senderPub: Uint8Array;
  let ciphertext: Uint8Array;
  let nonce: Uint8Array;
  try {
    senderPub = bs58.decode(senderBoxPublicKeyB58);
    ciphertext = decodeBase64(ciphertextB64);
    nonce = decodeBase64(nonceB64);
  } catch {
    return null;
  }
  if (senderPub.length !== nacl.box.publicKeyLength) return null;
  if (nonce.length !== nacl.box.nonceLength) return null;
  if (recipientBoxSecretKey.length !== nacl.box.secretKeyLength) return null;

  const opened = nacl.box.open(ciphertext, nonce, senderPub, recipientBoxSecretKey);
  if (!opened) return null;
  return encodeUTF8(opened);
}

export function isValidBoxPublicKey(b58: string): boolean {
  try {
    return bs58.decode(b58).length === nacl.box.publicKeyLength;
  } catch {
    return false;
  }
}

// ── DM per-message sender attribution ──────────────────────────────────
//
// Audit pt6 C1 closed: without a per-message sig, a malicious relay can
// re-attribute Alice's real ciphertext to "Mallory" by swapping
// `senderSigningPublicKey` on the outbound `dm:message`. NaCl box only
// authenticates `senderBoxPublicKey` (decryption succeeds → that
// box-key holder produced the ciphertext) — nothing previously bound
// `senderSigningPublicKey` to the message.
//
// The sender signs an ed25519 detached signature over a tagged
// canonical encoding of (sender-signing, sender-box, recipient-box,
// nonce, ciphertext). The `void/dm/v1|` tag domain-separates this from
// the announce sig and any future sig types — a captured sig can never
// be replayed against a different protocol or version.
//
// The receiver MUST also cross-check `(senderSigningPub, senderBoxPub)`
// against the verified peer cache before rendering. Verifying the sig
// alone doesn't help: a relay-acting-as-Mallory can sign with Mallory's
// own secret, and the verification would pass against Mallory's pubkey.
// The binding check (signing-key was previously seen via roster sig
// bound to this box-key) is what attributes the message to a real
// peer. realtimeClient.ts owns that policy.

const DM_SIG_TAG = 'void/dm/v1';

function dmSignedBytes(args: {
  senderSigningPublicKeyB58: string;
  senderBoxPublicKeyB58: string;
  recipientBoxPublicKeyB58: string;
  nonceB64: string;
  ciphertextB64: string;
}): Uint8Array {
  const canonical = [
    DM_SIG_TAG,
    args.senderSigningPublicKeyB58,
    args.senderBoxPublicKeyB58,
    args.recipientBoxPublicKeyB58,
    args.nonceB64,
    args.ciphertextB64,
  ].join('|');
  return new TextEncoder().encode(canonical);
}

/** Sign a DM with the sender's ed25519 signing secret. Returns base58
 *  sig or null if any input is malformed. */
export function signDM(args: {
  senderSigningPublicKeyB58: string;
  senderSigningSecretKey: Uint8Array;
  senderBoxPublicKeyB58: string;
  recipientBoxPublicKeyB58: string;
  nonceB64: string;
  ciphertextB64: string;
}): string | null {
  if (args.senderSigningSecretKey.length !== nacl.sign.secretKeyLength) return null;
  try {
    const message = dmSignedBytes(args);
    const sig = nacl.sign.detached(message, args.senderSigningSecretKey);
    return bs58.encode(sig);
  } catch {
    return null;
  }
}

/** Verify a DM signature. Returns true only if the sig was produced
 *  by the holder of `senderSigningPublicKeyB58`'s secret over the
 *  exact (sender-signing, sender-box, recipient-box, nonce,
 *  ciphertext) tuple of this message. */
export function verifyDM(args: {
  senderSigningPublicKeyB58: string;
  senderBoxPublicKeyB58: string;
  recipientBoxPublicKeyB58: string;
  nonceB64: string;
  ciphertextB64: string;
  sigB58: string;
}): boolean {
  try {
    const sigBytes = bs58.decode(args.sigB58);
    const pubBytes = bs58.decode(args.senderSigningPublicKeyB58);
    if (sigBytes.length !== nacl.sign.signatureLength) return false;
    if (pubBytes.length !== nacl.sign.publicKeyLength) return false;
    const message = dmSignedBytes(args);
    return nacl.sign.detached.verify(message, sigBytes, pubBytes);
  } catch {
    return false;
  }
}
