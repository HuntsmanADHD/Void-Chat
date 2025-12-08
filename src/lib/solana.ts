import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { sign } from 'tweetnacl';
import bs58 from 'bs58';

export const CLAWED_TOKEN_MINT = 'ELusVXzUPHyAuPB3M7qemr2Y2KshiWnGXauK17XYpump';
export const AUTH_MESSAGE_PREFIX = 'Sign this message to authenticate with Void Chat.\n\nThis will not trigger a blockchain transaction or cost any gas fees.\n\nTimestamp: ';

const BALANCE_CACHE_DURATION = 5 * 60 * 1000;
interface BalanceCacheEntry { balance: bigint; timestamp: number; }
const balanceCache = new Map<string, BalanceCacheEntry>();

export function getConnection(): Connection {
  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (heliusApiKey) {
    return new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`, 'confirmed');
  }
  return new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
}

export async function getClawedTokenBalance(walletAddress: string): Promise<bigint> {
  const cached = balanceCache.get(walletAddress);
  if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_DURATION) {
    return cached.balance;
  }
  try {
    const connection = getConnection();
    const walletPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(CLAWED_TOKEN_MINT);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: mintPubkey });
    let totalBalance = BigInt(0);
    for (const account of tokenAccounts.value) {
      const parsedInfo = account.account.data.parsed?.info;
      if (parsedInfo?.tokenAmount?.amount) {
        totalBalance += BigInt(parsedInfo.tokenAmount.amount);
      }
    }
    balanceCache.set(walletAddress, { balance: totalBalance, timestamp: Date.now() });
    return totalBalance;
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return BigInt(0);
  }
}

export function formatTokenBalance(balance: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = balance / divisor;
  const fractionalPart = balance % divisor;
  if (fractionalPart === BigInt(0)) return wholePart.toLocaleString();
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${wholePart.toLocaleString()}.${fractionalStr}`;
}

export function verifyWalletSignature(message: string, signature: string, publicKey: string): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = bs58.decode(publicKey);
    return sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

export function generateAuthMessage(): string {
  return `${AUTH_MESSAGE_PREFIX}${Date.now()}`;
}

export function isAuthMessageValid(message: string): boolean {
  if (!message.startsWith(AUTH_MESSAGE_PREFIX)) return false;
  const timestampStr = message.slice(AUTH_MESSAGE_PREFIX.length);
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;
  return Date.now() - timestamp < 5 * 60 * 1000;
}

export function formatWalletAddress(address: string, startChars: number = 4, endChars: number = 4): string {
  if (!address || address.length <= startChars + endChars + 3) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

export function isValidSolanaAddress(address: string): boolean {
  try { new PublicKey(address); return true; } catch { return false; }
}

export async function checkMinimumTokenHold(walletAddress: string, minRequired: bigint): Promise<boolean> {
  const balance = await getClawedTokenBalance(walletAddress);
  return balance >= minRequired;
}

export function clearBalanceCache(walletAddress: string): void { balanceCache.delete(walletAddress); }
export function clearAllBalanceCache(): void { balanceCache.clear(); }
export function parseAuthMessageTimestamp(message: string): number | null {
  if (!message.startsWith(AUTH_MESSAGE_PREFIX)) return null;
  const timestamp = parseInt(message.slice(AUTH_MESSAGE_PREFIX.length), 10);
  return isNaN(timestamp) ? null : timestamp;
}
