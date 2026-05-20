import { useCallback, useEffect, useState } from 'react';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { AuthSession } from '@/types/identity';
import { apiClient } from '@/lib/api-client';
import { keyring, isTauri } from '@/lib/tauri';

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
   * Load existing session from keyring (Tauri) or sessionStorage (browser) on mount
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadSession = async () => {
      try {
        let storedToken: string | null = null;
        let storedSession: string | null = null;

        if (isTauri) {
          storedToken = await keyring.get(AUTH_TOKEN_KEY);
          storedSession = await keyring.get(AUTH_SESSION_KEY);
        } else {
          storedToken = sessionStorage.getItem(AUTH_TOKEN_KEY);
          storedSession = sessionStorage.getItem(AUTH_SESSION_KEY);
        }

        if (storedToken && storedSession) {
          const parsed = JSON.parse(storedSession) as AuthSession;
          setSession(parsed);
          setToken(storedToken);
        }
      } catch (err) {
        console.error('Failed to load auth session:', err);
        if (isTauri) {
          try {
            await keyring.delete(AUTH_TOKEN_KEY);
            await keyring.delete(AUTH_SESSION_KEY);
          } catch { /* ignore cleanup errors */ }
        } else {
          sessionStorage.removeItem(AUTH_TOKEN_KEY);
          sessionStorage.removeItem(AUTH_SESSION_KEY);
        }
      }
    };

    loadSession();
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
      const response = await apiClient.post<{ token: string; user?: { publicId: string; isBlacklisted?: boolean } }>('/api/auth/verify', { publicKey, signature, message });

      if (!response.success || !response.data) {
        setError(response.error?.message || 'Authentication failed');
        return false;
      }

      const data = response.data;

      if (!data.token) {
        setError('Server did not return auth token');
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
      if (isTauri) {
        await keyring.store(AUTH_TOKEN_KEY, data.token);
        await keyring.store(AUTH_SESSION_KEY, JSON.stringify(newSession));
      } else {
        sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(newSession));
      }
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
        const response = await apiClient.post('/api/auth/register', { publicId, publicKey, artHash });

        if (!response.success) {
          setError(response.error?.message || 'Registration failed');
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
    if (isTauri) {
      keyring.delete(AUTH_TOKEN_KEY).catch(() => {});
      keyring.delete(AUTH_SESSION_KEY).catch(() => {});
    } else {
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
      sessionStorage.removeItem(AUTH_SESSION_KEY);
    }
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
