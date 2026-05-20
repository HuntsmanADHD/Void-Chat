/**
 * Identity types for Void Chat
 * Local keypair-based identity system — no wallets, no blockchain
 */

export interface AuthSession {
  publicId: string;
  publicKey: string;
  signature: string;
  timestamp: number;
}

export interface VoidUser {
  id: string;
  publicId: string;
  publicKey: string;
  artHash: string;
  isBlacklisted: boolean;
  createdAt: string;
}

export interface CreateAccountPayload {
  publicId: string;
  publicKey: string;
  artHash: string;
}
