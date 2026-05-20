'use client';

import { useCallback, useEffect, useState } from 'react';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { AuthSession } from '@/types/identity';

/**
 * Session storage keys
 */
const AUTH_TOKEN_KEY = 'voidchat_auth_token';
const AUTH_SESSION_KEY = 'voidchat_auth_session';

/**
 * Return type for useAuth hook
 */
interface UseAuthReturn {
  /** User's public ID (human-readable alias) */
  publicId: string | null;
  /** User's NaCl public key (base58) */
  publicKey: string | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether user is blacklisted */
  isBlacklisted: boolean;
  /** Current auth session */
  session: AuthSession | null;
  /** Login with a private key */
  login: (privateKeyString: string) => Promise<boolean>;
  /** Create a new account */
  createAccount: (privateKeyString: string, publicId: string, artHash: string) => Promise<boolean>;
  /** Logout and clear session */
  logout: () => void;
  /** Error message if any */
  error: string | null;
  /** Loading state */
  isLoading: boolean;
}

/**
 * Derive a NaCl signing keypair from a base58-encoded private key string.
 * Returns { publicKey, secretKey } as base58 strings.
 */
function deriveKeypair(privateKeyString: string): { publicKey: string; secretKey: Uint8Array } {
  const secretKey = bs58.decode(privateKeyString);
  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
  return {
    publicKey: bs58.encode(keypair.publicKey),
    secretKey: keypair.secretKey,
  };
}

/**
 * Custom hook for keypair-based authentication in Void Chat
 *
 * Features:
 * - No wallet adapters, no Solana, no blockchain
 * - Auth via local NaCl keypair: sign a message, server verifies
 * - Session stored in sessionStorage
 * - Account creation with publicId + artHash
 */
export function useAuth(): UseAuthReturn {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isBlacklisted, setIsBlacklisted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Load existing session from sessionStorage on mount
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const storedToken = sessionStorage.getItem(AUTH_TOKEN_KEY);
      const storedSession = sessionStorage.getItem(AUTH_SESSION_KEY);

      if (storedToken && storedSession) {
        const parsed = JSON.parse(storedSession) as AuthSession;
        setSession(parsed);
        setToken(storedToken);
      }
    } catch (err) {
      console.error('Failed to load auth session:', err);
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
      sessionStorage.removeItem(AUTH_SESSION_KEY);
    }
  }, []);

  /**
   * Login with a private key string (base58-encoded NaCl signing secret key)
   */
  const login = useCallback(async (privateKeyString: string): Promise<boolean> => {
    setError(null);
    setIsLoading(true);

    try {
      const { publicKey, secretKey } = deriveKeypair(privateKeyString);

      // Create auth message with timestamp (must match server's validateAuthMessage format)
      const timestamp = Date.now();
      const message = `Void Chat Login\ntimestamp: ${timestamp}`;
      const messageBytes = new TextEncoder().encode(message);

      // Sign the message and encode as base64 (browser-safe)
      const signatureBytes = nacl.sign.detached(messageBytes, secretKey);
      const signature = btoa(String.fromCharCode(...signatureBytes));

      // Call server to verify (lookup by publicKey since user doesn't know their publicId at login)
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey,
          signature,
          message,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Authentication failed' }));
        setError(data.error || 'Authentication failed');
        return false;
      }

      const data = await response.json();

      if (!data.token || !data.user?.publicId) {
        setError('Server returned incomplete authentication data');
        return false;
      }

      // Build session
      const newSession: AuthSession = {
        publicId: data.user?.publicId || '',
        publicKey,
        signature,
        timestamp,
      };

      // Persist
      sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(newSession));
      setToken(data.token);
      setSession(newSession);
      setIsBlacklisted(data.user?.isBlacklisted ?? false);

      return true;
    } catch (err) {
      console.error('Login failed:', err);
      setError(err instanceof Error ? err.message : 'Login failed');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create a new account, then auto-login
   */
  const createAccount = useCallback(
    async (privateKeyString: string, publicId: string, artHash: string): Promise<boolean> => {
      setError(null);
      setIsLoading(true);

      try {
        const { publicKey } = deriveKeypair(privateKeyString);

        // Register
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicId, publicKey, artHash }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'Registration failed' }));
          setError(data.error || 'Registration failed');
          return false;
        }

        // Auto-login after creation
        setIsLoading(false);
        return await login(privateKeyString);
      } catch (err) {
        console.error('Account creation failed:', err);
        setError(err instanceof Error ? err.message : 'Account creation failed');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [login]
  );

  /**
   * Logout — clear all session data
   */
  const logout = useCallback(() => {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    setSession(null);
    setToken(null);
    setIsBlacklisted(false);
    setError(null);
  }, []);

  return {
    publicId: session?.publicId ?? null,
    publicKey: session?.publicKey ?? null,
    isAuthenticated: session !== null && token !== null,
    isBlacklisted,
    session,
    login,
    createAccount,
    logout,
    error,
    isLoading,
  };
}

/**
 * Hook to get authentication headers for API requests
 *
 * @returns Headers object with auth token, or null if not authenticated
 */
export function useAuthHeaders(): Record<string, string> | null {
  const { session, isAuthenticated } = useAuth();

  if (!isAuthenticated || !session) {
    return null;
  }

  const token = typeof window !== 'undefined' ? sessionStorage.getItem(AUTH_TOKEN_KEY) : null;

  if (!token) return null;

  return {
    'Authorization': `Bearer ${token}`,
    'x-public-id': session.publicId,
    'x-public-key': session.publicKey,
  };
}

export default useAuth;
