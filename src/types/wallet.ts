/**
 * Wallet types for Void Chat
 */

export interface WalletAuthSession {
  walletAddress: string;
  signature: string;
  message: string;
  timestamp: number;
}

export interface WalletUser {
  id: string;
  walletAddress: string;
  xHandle: string | null;
  xVerified: boolean;
  publicKey: string;
  tokenBalance: bigint;
  strikes: number;
  blacklisted: boolean;
  createdAt: Date;
}

export interface BlacklistCheckResponse {
  blacklisted: boolean;
  strikes: number;
  reason?: string;
}

export type HolderTier = 'none' | 'holder' | 'whale' | 'diamond';

export function getHolderTier(balance: bigint): HolderTier {
  const DECIMALS = BigInt(10 ** 6);
  const HOLDER_THRESHOLD = BigInt(1_000) * DECIMALS;
  const WHALE_THRESHOLD = BigInt(100_000) * DECIMALS;
  const DIAMOND_THRESHOLD = BigInt(1_000_000) * DECIMALS;

  if (balance >= DIAMOND_THRESHOLD) return 'diamond';
  if (balance >= WHALE_THRESHOLD) return 'whale';
  if (balance >= HOLDER_THRESHOLD) return 'holder';
  return 'none';
}

export const HOLDER_TIER_INFO: Record<HolderTier, { label: string; color: string; bgColor: string }> = {
  none: { label: '', color: 'text-zinc-500', bgColor: 'bg-zinc-800' },
  holder: { label: 'Holder', color: 'text-emerald-400', bgColor: 'bg-emerald-900/30' },
  whale: { label: 'Whale', color: 'text-blue-400', bgColor: 'bg-blue-900/30' },
  diamond: { label: 'Diamond', color: 'text-purple-400', bgColor: 'bg-purple-900/30' },
};

export type SupportedWallet = 'phantom' | 'solflare' | 'backpack';
