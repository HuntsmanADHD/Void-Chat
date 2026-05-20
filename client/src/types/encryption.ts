/**
 * Encryption types for Void Chat
 */

export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

export interface EncryptedMessage {
  encrypted: string;
  nonce: string;
}

export interface StoredKeyPair {
  encryptedSecretKey: string;
  publicKey: string;
  nonce: string;
  publicId: string;
}

export interface PublicKeyCache {
  publicKey: string;
  publicId: string;
  fetchedAt: number;
}

export interface ChannelKeyEntry {
  channelId: string;
  encryptedKey: string;
  nonce: string;
  createdAt: number;
}

export interface KeyOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface UserKeyInfo {
  publicId: string;
  publicKey: string;
}
