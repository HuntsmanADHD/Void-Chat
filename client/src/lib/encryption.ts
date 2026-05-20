/**
 * Core encryption utilities for Void Chat
 * Uses TweetNaCl for all cryptographic operations
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import type { KeyPair, EncryptedMessage } from '@/types/encryption';

export function generateKeyPair(): KeyPair | null {
  try {
    const keyPair = nacl.box.keyPair();
    return {
      publicKey: encodeBase64(keyPair.publicKey),
      secretKey: encodeBase64(keyPair.secretKey),
    };
  } catch (error) {
    console.error('[Encryption] Failed to generate keypair:', error);
    return null;
  }
}

export function encryptMessage(
  message: string,
  recipientPublicKey: string,
  senderSecretKey: string
): EncryptedMessage | null {
  try {
    if (!message || !recipientPublicKey || !senderSecretKey) return null;
    const recipientPubKeyBytes = decodeBase64(recipientPublicKey);
    const senderSecKeyBytes = decodeBase64(senderSecretKey);
    if (recipientPubKeyBytes.length !== nacl.box.publicKeyLength) return null;
    if (senderSecKeyBytes.length !== nacl.box.secretKeyLength) return null;
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const messageBytes = decodeUTF8(message);
    const encrypted = nacl.box(messageBytes, nonce, recipientPubKeyBytes, senderSecKeyBytes);
    if (!encrypted) return null;
    return { encrypted: encodeBase64(encrypted), nonce: encodeBase64(nonce) };
  } catch (error) {
    console.error('[Encryption] Failed to encrypt message:', error);
    return null;
  }
}

export function decryptMessage(
  encryptedData: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string
): string | null {
  try {
    if (!encryptedData || !nonce || !senderPublicKey || !recipientSecretKey) return null;
    const encryptedBytes = decodeBase64(encryptedData);
    const nonceBytes = decodeBase64(nonce);
    const senderPubKeyBytes = decodeBase64(senderPublicKey);
    const recipientSecKeyBytes = decodeBase64(recipientSecretKey);
    const decrypted = nacl.box.open(encryptedBytes, nonceBytes, senderPubKeyBytes, recipientSecKeyBytes);
    if (!decrypted) return null;
    return encodeUTF8(decrypted);
  } catch (error) {
    console.error('[Encryption] Failed to decrypt message:', error);
    return null;
  }
}

export function generateChannelKey(): string | null {
  try {
    const key = nacl.randomBytes(nacl.secretbox.keyLength);
    return encodeBase64(key);
  } catch (error) {
    console.error('[Encryption] Failed to generate channel key:', error);
    return null;
  }
}

export function encryptChannelMessage(message: string, channelKey: string): EncryptedMessage | null {
  try {
    if (!message || !channelKey) return null;
    const keyBytes = decodeBase64(channelKey);
    if (keyBytes.length !== nacl.secretbox.keyLength) return null;
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const messageBytes = decodeUTF8(message);
    const encrypted = nacl.secretbox(messageBytes, nonce, keyBytes);
    if (!encrypted) return null;
    return { encrypted: encodeBase64(encrypted), nonce: encodeBase64(nonce) };
  } catch (error) {
    console.error('[Encryption] Failed to encrypt channel message:', error);
    return null;
  }
}

export function decryptChannelMessage(encryptedData: string, nonce: string, channelKey: string): string | null {
  try {
    if (!encryptedData || !nonce || !channelKey) return null;
    const encryptedBytes = decodeBase64(encryptedData);
    const nonceBytes = decodeBase64(nonce);
    const keyBytes = decodeBase64(channelKey);
    const decrypted = nacl.secretbox.open(encryptedBytes, nonceBytes, keyBytes);
    if (!decrypted) return null;
    return encodeUTF8(decrypted);
  } catch (error) {
    console.error('[Encryption] Failed to decrypt channel message:', error);
    return null;
  }
}

export function isValidPublicKey(publicKey: string): boolean {
  try {
    if (!publicKey) return false;
    const keyBytes = decodeBase64(publicKey);
    return keyBytes.length === nacl.box.publicKeyLength;
  } catch {
    return false;
  }
}

export function isValidSecretKey(secretKey: string): boolean {
  try {
    if (!secretKey) return false;
    const keyBytes = decodeBase64(secretKey);
    return keyBytes.length === nacl.box.secretKeyLength;
  } catch {
    return false;
  }
}

/** Salt length for HKDF key derivation (16 bytes) */
const KDF_SALT_LENGTH = 16;

/**
 * Derive a 32-byte symmetric key from a password/signature using HKDF-like
 * construction with a random salt.
 *
 * Uses nacl.hash (SHA-512) over concat(salt, password) and takes the first
 * 32 bytes. The salt prevents rainbow table attacks and ensures that even
 * if the same signature is reused, different encryption operations produce
 * different derived keys.
 *
 * This is a significant improvement over using the raw signature as a key,
 * though not as strong as Argon2/scrypt for password-based KDF. Acceptable
 * here because the input keying material (auth signature) has high entropy.
 *
 * @param password - The input keying material (e.g., auth signature)
 * @param salt - 16-byte random salt (must be stored alongside ciphertext)
 * @returns 32-byte derived key
 */
function deriveKeyWithSalt(password: string, salt: Uint8Array): Uint8Array {
  const passwordBytes = decodeUTF8(password);
  // HKDF-extract equivalent: hash(salt || password)
  const input = new Uint8Array(salt.length + passwordBytes.length);
  input.set(salt, 0);
  input.set(passwordBytes, salt.length);
  const hash = nacl.hash(input); // 64 bytes (SHA-512)
  return hash.slice(0, nacl.secretbox.keyLength); // 32 bytes
}

/**
 * @deprecated Legacy key derivation without salt. Kept only for backward
 * compatibility when decrypting keys stored before the salt migration.
 * New encryptions must use deriveKeyWithSalt().
 */
function deriveKeyFromPasswordLegacy(password: string): Uint8Array {
  const passwordBytes = decodeUTF8(password);
  const hash = nacl.hash(passwordBytes); // 64 bytes (SHA-512)
  return hash.slice(0, nacl.secretbox.keyLength); // 32 bytes
}

/**
 * Encrypt data for key exchange using nacl.box.
 * Returns a base64 string containing nonce + ciphertext concatenated.
 */
export function encryptForKeyExchange(
  data: string,
  recipientPublicKey: string,
  senderSecretKey: string
): string | null {
  try {
    if (!data || !recipientPublicKey || !senderSecretKey) return null;
    const recipientPubKeyBytes = decodeBase64(recipientPublicKey);
    const senderSecKeyBytes = decodeBase64(senderSecretKey);
    if (recipientPubKeyBytes.length !== nacl.box.publicKeyLength) return null;
    if (senderSecKeyBytes.length !== nacl.box.secretKeyLength) return null;
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const messageBytes = decodeUTF8(data);
    const encrypted = nacl.box(messageBytes, nonce, recipientPubKeyBytes, senderSecKeyBytes);
    if (!encrypted) return null;
    // Concatenate nonce + ciphertext and encode as a single base64 string
    const combined = new Uint8Array(nonce.length + encrypted.length);
    combined.set(nonce, 0);
    combined.set(encrypted, nonce.length);
    return encodeBase64(combined);
  } catch (error) {
    console.error('[Encryption] Failed to encrypt for key exchange:', error);
    return null;
  }
}

/**
 * Decrypt data from key exchange using nacl.box.open.
 * Expects a base64 string containing nonce + ciphertext concatenated.
 */
export function decryptFromKeyExchange(
  encrypted: string,
  senderPublicKey: string,
  recipientSecretKey: string
): string | null {
  try {
    if (!encrypted || !senderPublicKey || !recipientSecretKey) return null;
    const combined = decodeBase64(encrypted);
    const senderPubKeyBytes = decodeBase64(senderPublicKey);
    const recipientSecKeyBytes = decodeBase64(recipientSecretKey);
    if (senderPubKeyBytes.length !== nacl.box.publicKeyLength) return null;
    if (recipientSecKeyBytes.length !== nacl.box.secretKeyLength) return null;
    if (combined.length <= nacl.box.nonceLength) return null;
    const nonce = combined.slice(0, nacl.box.nonceLength);
    const ciphertext = combined.slice(nacl.box.nonceLength);
    const decrypted = nacl.box.open(ciphertext, nonce, senderPubKeyBytes, recipientSecKeyBytes);
    if (!decrypted) return null;
    return encodeUTF8(decrypted);
  } catch (error) {
    console.error('[Encryption] Failed to decrypt from key exchange:', error);
    return null;
  }
}

/**
 * Encrypt a secret key for storage using a password/signature.
 * Uses nacl.secretbox with a key derived via HKDF(salt, password).
 * Returns base64(salt + nonce + ciphertext).
 *
 * Format (v2): [16-byte salt][24-byte nonce][ciphertext]
 * Legacy (v1): [24-byte nonce][ciphertext] (no salt, insecure)
 */
export function encryptSecretKey(secretKey: string, password: string): string | null {
  try {
    if (!secretKey || !password) return null;
    const salt = nacl.randomBytes(KDF_SALT_LENGTH);
    const derivedKey = deriveKeyWithSalt(password, salt);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const secretKeyBytes = decodeUTF8(secretKey);
    const encrypted = nacl.secretbox(secretKeyBytes, nonce, derivedKey);
    if (!encrypted) return null;
    // Concatenate salt + nonce + ciphertext
    const combined = new Uint8Array(salt.length + nonce.length + encrypted.length);
    combined.set(salt, 0);
    combined.set(nonce, salt.length);
    combined.set(encrypted, salt.length + nonce.length);
    return encodeBase64(combined);
  } catch (error) {
    console.error('[Encryption] Failed to encrypt secret key:', error);
    return null;
  }
}

/**
 * Decrypt a secret key from storage using a password/signature.
 *
 * Supports both formats:
 *   v2 (current): base64(salt[16] + nonce[24] + ciphertext) — salted HKDF
 *   v1 (legacy):  base64(nonce[24] + ciphertext) — unsalted hash
 *
 * Tries v2 first; if decryption fails, falls back to v1 for backward
 * compatibility with keys stored before the salt migration.
 */
export function decryptSecretKey(encrypted: string, password: string): string | null {
  try {
    if (!encrypted || !password) return null;
    const combined = decodeBase64(encrypted);

    // Try v2 format first: salt(16) + nonce(24) + ciphertext
    if (combined.length > KDF_SALT_LENGTH + nacl.secretbox.nonceLength) {
      const salt = combined.slice(0, KDF_SALT_LENGTH);
      const nonce = combined.slice(KDF_SALT_LENGTH, KDF_SALT_LENGTH + nacl.secretbox.nonceLength);
      const ciphertext = combined.slice(KDF_SALT_LENGTH + nacl.secretbox.nonceLength);
      const derivedKey = deriveKeyWithSalt(password, salt);
      const decrypted = nacl.secretbox.open(ciphertext, nonce, derivedKey);
      if (decrypted) {
        return encodeUTF8(decrypted);
      }
    }

    // Fallback to v1 (legacy unsalted format): nonce(24) + ciphertext
    if (combined.length > nacl.secretbox.nonceLength) {
      const nonce = combined.slice(0, nacl.secretbox.nonceLength);
      const ciphertext = combined.slice(nacl.secretbox.nonceLength);
      const derivedKey = deriveKeyFromPasswordLegacy(password);
      const decrypted = nacl.secretbox.open(ciphertext, nonce, derivedKey);
      if (decrypted) {
        console.warn('[Encryption] Decrypted using legacy unsalted KDF — key should be re-encrypted with salt');
        return encodeUTF8(decrypted);
      }
    }

    return null;
  } catch (error) {
    console.error('[Encryption] Failed to decrypt secret key:', error);
    return null;
  }
}

/**
 * Generate a keypair from a seed using nacl.box.keyPair.fromSecretKey.
 * The seed must be exactly 32 bytes (nacl.box.secretKeyLength).
 */
export function keyPairFromSeed(seed: Uint8Array): { publicKey: string; secretKey: string } | null {
  try {
    if (!seed || seed.length !== nacl.box.secretKeyLength) return null;
    const keyPair = nacl.box.keyPair.fromSecretKey(seed);
    return {
      publicKey: encodeBase64(keyPair.publicKey),
      secretKey: encodeBase64(keyPair.secretKey),
    };
  } catch (error) {
    console.error('[Encryption] Failed to generate keypair from seed:', error);
    return null;
  }
}
