'use client';

/**
 * useXAuth Hook
 *
 * Custom hook for managing X (Twitter) account linking with Void Chat.
 * Handles OAuth session state, linking/unlinking, and status synchronization.
 *
 * Features:
 * - Get linked X account status
 * - Link X account to wallet
 * - Unlink X account
 * - Session management via next-auth
 * - Error handling and loading states
 */

import { useCallback, useEffect, useState } from 'react';
import { useSession, signOut as nextAuthSignOut } from 'next-auth/react';
import { useWalletAuth } from './useWalletAuth';
import { fetchApi, fetchAuthPost } from '@/lib/apiClient';
import type {
  XAccountStatus,
  XSession,
  LinkXAccountResponse,
  UnlinkXAccountResponse,
} from '@/lib/x-auth';

/**
 * Return type for useXAuth hook
 */
interface UseXAuthReturn {
  /** Current X account status for the connected wallet */
  xAccountStatus: XAccountStatus | null;
  /** NextAuth session with X profile data */
  xSession: XSession | null;
  /** Whether initial status is loading */
  isLoading: boolean;
  /** Whether linking is in progress */
  isLinking: boolean;
  /** Whether unlinking is in progress */
  isUnlinking: boolean;
  /** Whether X is configured (env vars present) */
  isXConfigured: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh X account status from server */
  refreshStatus: () => Promise<void>;
  /** Link X account after OAuth completion */
  linkXAccount: () => Promise<boolean>;
  /** Unlink X account from wallet */
  unlinkXAccount: () => Promise<boolean>;
  /** Clear current error */
  clearError: () => void;
}

/**
 * Custom hook for X (Twitter) authentication management
 *
 * Works alongside wallet authentication to provide optional
 * X account linking for identity transparency.
 *
 * @returns X auth state and functions
 */
export function useXAuth(): UseXAuthReturn {
  // Wallet auth state
  const { wallet, isConnected, isAuthenticated, session: walletSession } = useWalletAuth();

  // NextAuth session for X OAuth
  const { data: nextAuthSession, status: sessionStatus } = useSession();

  // Local state
  const [xAccountStatus, setXAccountStatus] = useState<XAccountStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [isXConfigured, setIsXConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cast NextAuth session to our extended type
  const xSession = nextAuthSession as XSession | null;

  /**
   * Fetch X account status from server
   */
  const refreshStatus = useCallback(async () => {
    if (!wallet || !isConnected) {
      setXAccountStatus(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchApi<XAccountStatus>(`/api/auth/x/status?wallet=${wallet}`);

      if (result.statusCode === 501) {
        // X auth not configured
        setIsXConfigured(false);
        setXAccountStatus({
          linked: false,
          xVerified: false,
        });
        return;
      }

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch X account status');
      }

      setXAccountStatus(result.data);
      setIsXConfigured(true);
    } catch (err) {
      console.error('[useXAuth] Error fetching status:', err);
      setXAccountStatus({
        linked: false,
        xVerified: false,
      });
      // Don't set error for status check - it's not critical
    } finally {
      setIsLoading(false);
    }
  }, [wallet, isConnected]);

  /**
   * Link X account after OAuth completion
   * Called after returning from X OAuth flow
   */
  const linkXAccount = useCallback(async (): Promise<boolean> => {
    if (!wallet || !isAuthenticated || !walletSession) {
      setError('Wallet not authenticated');
      return false;
    }

    if (!xSession?.xProfile) {
      setError('X authentication required first');
      return false;
    }

    setIsLinking(true);
    setError(null);

    try {
      const result = await fetchAuthPost<LinkXAccountResponse>(
        '/api/auth/x/link',
        walletSession,
        {
          xId: xSession.xProfile.id,
          xUsername: xSession.xProfile.username,
          xName: xSession.xProfile.name,
          xImage: xSession.xProfile.image,
        }
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to link X account');
      }

      // Refresh status to get updated data
      await refreshStatus();
      return true;
    } catch (err) {
      console.error('[useXAuth] Error linking account:', err);
      setError(err instanceof Error ? err.message : 'Failed to link X account');
      return false;
    } finally {
      setIsLinking(false);
    }
  }, [wallet, isAuthenticated, walletSession, xSession, refreshStatus]);

  /**
   * Unlink X account from wallet
   */
  const unlinkXAccount = useCallback(async (): Promise<boolean> => {
    if (!wallet || !isAuthenticated || !walletSession) {
      setError('Wallet not authenticated');
      return false;
    }

    setIsUnlinking(true);
    setError(null);

    try {
      const result = await fetchAuthPost<UnlinkXAccountResponse>(
        '/api/auth/x/unlink',
        walletSession,
        {}
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to unlink X account');
      }

      // Clear NextAuth session
      await nextAuthSignOut({ redirect: false });

      // Update local status
      setXAccountStatus({
        linked: false,
        xVerified: false,
      });

      return true;
    } catch (err) {
      console.error('[useXAuth] Error unlinking account:', err);
      setError(err instanceof Error ? err.message : 'Failed to unlink X account');
      return false;
    } finally {
      setIsUnlinking(false);
    }
  }, [wallet, isAuthenticated, walletSession]);

  /**
   * Clear current error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Fetch status when wallet connects/authenticates
   */
  useEffect(() => {
    if (isConnected && isAuthenticated && wallet) {
      refreshStatus();
    } else {
      setXAccountStatus(null);
    }
  }, [isConnected, isAuthenticated, wallet, refreshStatus]);

  /**
   * Auto-link when returning from OAuth with valid session
   * but X is not yet linked in database
   */
  useEffect(() => {
    const autoLink = async () => {
      // Check if we have X session but database shows not linked
      if (
        xSession?.xProfile &&
        isAuthenticated &&
        xAccountStatus &&
        !xAccountStatus.linked &&
        !isLinking
      ) {
        // Check URL for callback indicator
        const urlParams = new URLSearchParams(window.location.search);
        const isCallback = urlParams.has('callbackUrl') || window.location.pathname.includes('/x-link/complete');

        if (isCallback) {
          await linkXAccount();

          // Clean up URL
          if (window.history.replaceState) {
            window.history.replaceState({}, '', window.location.pathname);
          }
        }
      }
    };

    autoLink();
  }, [xSession, isAuthenticated, xAccountStatus, isLinking, linkXAccount]);

  return {
    xAccountStatus,
    xSession,
    isLoading: isLoading || sessionStatus === 'loading',
    isLinking,
    isUnlinking,
    isXConfigured,
    error,
    refreshStatus,
    linkXAccount,
    unlinkXAccount,
    clearError,
  };
}

/**
 * Hook to check if user has verified X account
 * Simpler hook for components that only need verification status
 *
 * @returns Object with verification status
 */
export function useXVerification(): {
  hasLinkedX: boolean;
  xHandle: string | null;
  xVerified: boolean;
  isLoading: boolean;
} {
  const { xAccountStatus, isLoading } = useXAuth();

  return {
    hasLinkedX: xAccountStatus?.linked ?? false,
    xHandle: xAccountStatus?.xHandle ?? null,
    xVerified: xAccountStatus?.xVerified ?? false,
    isLoading,
  };
}

export default useXAuth;
