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
  walletAddress: string;
}

export interface PublicKeyCache {
  publicKey: string;
  walletAddress: string;
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
  walletAddress: string;
  publicKey: string;
  xHandle?: string;
  xVerified?: boolean;
}
