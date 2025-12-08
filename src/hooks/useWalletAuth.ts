'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import {
  generateAuthMessage,
  getClawedTokenBalance,
  isAuthMessageValid,
  verifyWalletSignature,
} from '@/lib/solana';

/**
 * Session storage key for wallet authentication
 */
const AUTH_SESSION_KEY = 'voidchat_wallet_auth';

/**
 * Authentication session data structure
 */
interface AuthSession {
  walletAddress: string;
  signature: string;
  message: string;
  timestamp: number;
}

/**
 * Return type for useWalletAuth hook
 */
interface UseWalletAuthReturn {
  /** Connected wallet public key as base58 string */
  wallet: string | null;
  /** Whether wallet is connected */
  isConnected: boolean;
  /** Whether wallet is currently connecting */
  isConnecting: boolean;
  /** Whether user is authenticated (signed message) */
  isAuthenticated: boolean;
  /** Whether wallet is blacklisted */
  isBlacklisted: boolean;
  /** Loading state for blacklist check */
  isCheckingBlacklist: boolean;
  /** $CLAWED token balance */
  tokenBalance: bigint;
  /** Loading state for balance */
  isLoadingBalance: boolean;
  /** Current authentication session */
  session: AuthSession | null;
  /** Sign in function - prompts wallet signature */
  signIn: () => Promise<boolean>;
  /** Sign out function - clears session */
  signOut: () => void;
  /** Refresh token balance */
  refreshBalance: () => Promise<void>;
  /** Error message if any */
  error: string | null;
}

/**
 * Custom hook for Solana wallet authentication in Void Chat
 *
 * Features:
 * - Wallet connection status tracking
 * - Message signing for authentication
 * - Session storage for persistent auth
 * - Blacklist status checking
 * - Token balance tracking with caching
 *
 * @returns Wallet auth state and functions
 */
export function useWalletAuth(): UseWalletAuthReturn {
  const { publicKey, connected, connecting, signMessage, disconnect } = useWallet();

  // State
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isBlacklisted, setIsBlacklisted] = useState(false);
  const [isCheckingBlacklist, setIsCheckingBlacklist] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<bigint>(BigInt(0));
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletAddress = publicKey?.toBase58() || null;

  /**
   * Load existing session from storage
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = sessionStorage.getItem(AUTH_SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AuthSession;

        // Verify session matches current wallet and is not expired
        if (
          parsed.walletAddress === walletAddress &&
          isAuthMessageValid(parsed.message)
        ) {
          setSession(parsed);
        } else {
          // Clear invalid session
          sessionStorage.removeItem(AUTH_SESSION_KEY);
          setSession(null);
        }
      }
    } catch (err) {
      console.error('Failed to load auth session:', err);
      sessionStorage.removeItem(AUTH_SESSION_KEY);
    }
  }, [walletAddress]);

  /**
   * Check if wallet is blacklisted
   */
  const checkBlacklist = useCallback(async (address: string) => {
    setIsCheckingBlacklist(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/blacklist?wallet=${address}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to check blacklist status');
      }

      const data = await response.json();
      setIsBlacklisted(data.blacklisted === true);
    } catch (err) {
      console.error('Blacklist check failed:', err);
      // Don't block on blacklist check failure, but log it
      setIsBlacklisted(false);
    } finally {
      setIsCheckingBlacklist(false);
    }
  }, []);

  /**
   * Fetch token balance
   */
  const refreshBalance = useCallback(async () => {
    if (!walletAddress) {
      setTokenBalance(BigInt(0));
      return;
    }

    setIsLoadingBalance(true);
    try {
      const balance = await getClawedTokenBalance(walletAddress);
      setTokenBalance(balance);
    } catch (err) {
      console.error('Failed to fetch balance:', err);
      setTokenBalance(BigInt(0));
    } finally {
      setIsLoadingBalance(false);
    }
  }, [walletAddress]);

  /**
   * Check blacklist and fetch balance when wallet connects
   */
  useEffect(() => {
    if (connected && walletAddress) {
      checkBlacklist(walletAddress);
      refreshBalance();
    } else {
      setIsBlacklisted(false);
      setTokenBalance(BigInt(0));
    }
  }, [connected, walletAddress, checkBlacklist, refreshBalance]);

  /**
   * Sign in - request wallet signature for authentication
   */
  const signIn = useCallback(async (): Promise<boolean> => {
    if (!publicKey || !signMessage) {
      setError('Wallet not connected or does not support signing');
      return false;
    }

    if (isBlacklisted) {
      setError('This wallet has been blacklisted');
      return false;
    }

    setError(null);

    try {
      // Generate auth message with timestamp
      const message = generateAuthMessage();
      const messageBytes = new TextEncoder().encode(message);

      // Request signature from wallet
      const signatureBytes = await signMessage(messageBytes);
      const signature = bs58.encode(signatureBytes);
      const address = publicKey.toBase58();

      // Verify the signature locally before storing
      const isValid = verifyWalletSignature(message, signature, address);

      if (!isValid) {
        setError('Signature verification failed');
        return false;
      }

      // Create and store session
      const newSession: AuthSession = {
        walletAddress: address,
        signature,
        message,
        timestamp: Date.now(),
      };

      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(newSession));
      setSession(newSession);

      // Notify backend of authentication
      try {
        await fetch('/api/auth/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': address,
            'x-wallet-signature': signature,
          },
          body: JSON.stringify({
            message,
            signature,
            walletAddress: address,
          }),
        });
      } catch (err) {
        // Non-blocking - session is stored locally
        console.warn('Failed to notify backend of auth:', err);
      }

      return true;
    } catch (err) {
      console.error('Sign in failed:', err);

      if (err instanceof Error) {
        if (err.message.includes('User rejected')) {
          setError('Signature request was rejected');
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to sign authentication message');
      }

      return false;
    }
  }, [publicKey, signMessage, isBlacklisted]);

  /**
   * Sign out - clear session and disconnect wallet
   */
  const signOut = useCallback(() => {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    setSession(null);
    setError(null);

    // Optionally disconnect wallet
    if (disconnect) {
      disconnect();
    }
  }, [disconnect]);

  return {
    wallet: walletAddress,
    isConnected: connected,
    isConnecting: connecting,
    isAuthenticated: session !== null && isAuthMessageValid(session.message),
    isBlacklisted,
    isCheckingBlacklist,
    tokenBalance,
    isLoadingBalance,
    session,
    signIn,
    signOut,
    refreshBalance,
    error,
  };
}

/**
 * Hook to get authentication headers for API requests
 *
 * @returns Headers object with wallet auth or null if not authenticated
 */
export function useAuthHeaders(): Record<string, string> | null {
  const { session, isAuthenticated } = useWalletAuth();

  if (!isAuthenticated || !session) {
    return null;
  }

  return {
    'x-wallet-address': session.walletAddress,
    'x-wallet-signature': session.signature,
    'x-auth-message': session.message,
  };
}

export default useWalletAuth;
