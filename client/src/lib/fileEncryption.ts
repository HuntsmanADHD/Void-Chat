/**
 * File encryption utilities for Void Chat
 *
 * Provides encryption/decryption for P2P file transfers using TweetNaCl.
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_TYPES: Record<string, string[]> = {
  'image': ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  'video': ['video/mp4', 'video/webm'],
  'audio': ['audio/mpeg', 'audio/ogg', 'audio/wav'],
  'document': ['application/pdf', 'text/plain'],
};

const ALL_ALLOWED = Object.values(ALLOWED_TYPES).flat();

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  if (!ALL_ALLOWED.includes(file.type)) {
    return { valid: false, error: 'File type not allowed' };
  }
  return { valid: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Encrypt file data using nacl.secretbox
 * @param data - Raw file bytes
 * @param key - 32-byte symmetric key
 * @returns Encrypted data and base64-encoded nonce, or null on failure
 */
export function encryptFileData(
  data: ArrayBuffer,
  key: Uint8Array
): { encryptedData: Uint8Array; nonce: string } | null {
  try {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const messageBytes = new Uint8Array(data);
    const encryptedData = nacl.secretbox(messageBytes, nonce, key);
    if (!encryptedData) return null;
    return {
      encryptedData,
      nonce: naclUtil.encodeBase64(nonce),
    };
  } catch (error) {
    console.error('[FileEncryption] Encryption failed:', error);
    return null;
  }
}

/**
 * Decrypt file data using nacl.secretbox.open
 * @param encryptedData - Encrypted file bytes
 * @param nonce - Base64-encoded nonce used during encryption
 * @param key - 32-byte symmetric key
 * @returns Decrypted ArrayBuffer or null on failure
 */
export function decryptFileData(
  encryptedData: Uint8Array,
  nonce: string,
  key: Uint8Array
): ArrayBuffer | null {
  try {
    const nonceBytes = naclUtil.decodeBase64(nonce);
    const decrypted = nacl.secretbox.open(encryptedData, nonceBytes, key);
    if (!decrypted) return null;
    // Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer type issues
    const result = new ArrayBuffer(decrypted.byteLength);
    new Uint8Array(result).set(decrypted);
    return result;
  } catch (error) {
    console.error('[FileEncryption] Decryption failed:', error);
    return null;
  }
}

/**
 * Derive a file encryption key from a channel key using SHA-512
 *
 * A random 16-byte salt is generated per file and included in the derivation
 * so that the same channel key produces a unique file key each time.
 *
 * @param channelKey - Base64-encoded channel key
 * @param existingSalt - Optional base64-encoded salt (for decryption; omit to generate a new one)
 * @returns Object with 32-byte key and base64-encoded salt, or null on failure
 */
export async function getFileKeyForChannel(
  channelKey: string,
  existingSalt?: string
): Promise<{ key: Uint8Array; salt: string } | null> {
  try {
    const keyBytes = naclUtil.decodeBase64(channelKey);
    // Generate or decode the per-file salt
    const saltBytes = existingSalt
      ? naclUtil.decodeBase64(existingSalt)
      : nacl.randomBytes(16);
    const salt = existingSalt || naclUtil.encodeBase64(saltBytes);

    // Derive a file-specific key by hashing domain separator + salt + channel key
    const encoder = new TextEncoder();
    const domainSeparator = encoder.encode('void-chat-file-key:');
    const combined = new Uint8Array(domainSeparator.length + saltBytes.length + keyBytes.length);
    combined.set(domainSeparator, 0);
    combined.set(saltBytes, domainSeparator.length);
    combined.set(keyBytes, domainSeparator.length + saltBytes.length);
    // Use nacl.hash (SHA-512) and take first 32 bytes for a 256-bit key
    const fullHash = nacl.hash(combined);
    return { key: fullHash.slice(0, 32), salt };
  } catch (error) {
    console.error('[FileEncryption] Channel key derivation failed:', error);
    return null;
  }
}

/**
 * Derive a shared file encryption key for DMs using nacl.box.before
 * @param senderSecretKey - Base64-encoded sender secret key
 * @param recipientPublicKey - Base64-encoded recipient public key
 * @returns 32-byte shared key suitable for nacl.secretbox, or null on failure
 */
export function deriveFileKeyForDM(
  senderSecretKey: string,
  recipientPublicKey: string
): Uint8Array | null {
  try {
    const secretKeyBytes = naclUtil.decodeBase64(senderSecretKey);
    const publicKeyBytes = naclUtil.decodeBase64(recipientPublicKey);
    return nacl.box.before(publicKeyBytes, secretKeyBytes);
  } catch (error) {
    console.error('[FileEncryption] DM key derivation failed:', error);
    return null;
  }
}
