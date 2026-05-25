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
