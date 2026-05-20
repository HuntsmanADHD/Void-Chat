/**
 * React hook for encryption operations in Void Chat
 *
 * Provides:
 * - Keypair generation and storage (encrypted with auth signature)
 * - Message encryption/decryption for DMs
 * - Channel message encryption/decryption
 * - Integration with local identity keypair
 *
 * Security Notes:
 * - Private keys are encrypted before storage using auth signature
 * - Keypairs are stored in localStorage (encrypted)
 * - Never expose secret keys in plaintext
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import bs58 from 'bs58';
import { apiClient } from '@/lib/api-client';
import { keyring, isTauri } from '@/lib/tauri';
import type { KeyPair, EncryptedMessage, StoredKeyPair } from '@/types/encryption';
import {
  generateKeyPair,
  encryptMessage,
  decryptMessage,
  encryptChannelMessage,
  decryptChannelMessage,
  encryptSecretKey,
  decryptSecretKey,
  isValidPublicKey,
  isValidSecretKey,
} from '@/lib/encryption';
import {
  getPublicKey,
  cachePublicKey,
  getChannelKey,
  storeChannelKey,
  initializeKeyStore,
} from '@/lib/keyStore';

// localStorage key for stored keypair
const KEYPAIR_STORAGE_KEY = 'voidchat_user_keypair';

interface UseEncryptionState {
  isInitialized: boolean;
  isLoading: boolean;
  hasKeypair: boolean;
  publicKey: string | null;
  error: string | null;
}

interface UseEncryptionReturn extends UseEncryptionState {
  // Keypair management
  getOrCreateKeyPair: () => Promise<KeyPair | null>;
  clearKeyPair: () => void;

  // DM encryption
  encryptForUser: (message: string, recipientPublicId: string) => Promise<EncryptedMessage | null>;
  decryptFromUser: (encrypted: string, nonce: string, senderPublicId: string) => Promise<string | null>;

  // Channel encryption
  encryptForChannel: (message: string, channelId: string) => Promise<EncryptedMessage | null>;
  decryptFromChannel: (encrypted: string, nonce: string, channelId: string) => Promise<string | null>;

  // Channel key management
  storeNewChannelKey: (channelId: string, channelKey: string) => Promise<boolean>;
  getDecryptedChannelKey: (channelId: string) => Promise<string | null>;

  // Low-level nacl.box operations (wrap the secret key so it never leaves this hook)
  boxEncrypt: (plaintext: Uint8Array, nonce: Uint8Array, recipientPublicKey: Uint8Array) => Uint8Array | null;
  boxOpen: (ciphertext: Uint8Array, nonce: Uint8Array, senderPublicKey: Uint8Array) => Uint8Array | null;

  // Re-authorize (for session refresh)
  reauthorize: () => Promise<boolean>;
}

/**
 * Hook for managing encryption operations
 * Must be used within an authenticated context
 */
export function useEncryption(): UseEncryptionReturn {
  const { publicId, publicKey: authPublicKey, isAuthenticated, session } = useAuth();

  const [state, setState] = useState<UseEncryptionState>({
    isInitialized: false,
    isLoading: false,
    hasKeypair: false,
    publicKey: null,
    error: null,
  });

  // Store the decrypted secret key in memory (never persisted in plaintext)
  const secretKeyRef = useRef<string | null>(null);
  const signatureRef = useRef<string | null>(null);

  /**
   * Get signature from session for key derivation
   */
  const getSignature = useCallback((): string | null => {
    if (signatureRef.current) {
      return signatureRef.current;
    }

    if (session?.signature) {
      signatureRef.current = session.signature;
      return session.signature;
    }

    setState((prev) => ({ ...prev, error: 'No auth signature available' }));
    return null;
  }, [session]);

  /**
   * Load stored keypair from localStorage
   */
  const loadStoredKeypair = useCallback(async (): Promise<KeyPair | null> => {
    if (!publicId) return null;

    try {
      let stored: string | null = null;
      if (isTauri) {
        stored = await keyring.get(KEYPAIR_STORAGE_KEY);
      } else {
        stored = localStorage.getItem(KEYPAIR_STORAGE_KEY);
      }
      if (!stored) return null;

      const storedData: StoredKeyPair = JSON.parse(stored);

      // Verify this keypair belongs to the current user
      if (storedData.publicId !== publicId) {
        console.warn('[useEncryption] Stored keypair belongs to different user');
        return null;
      }

      // Get signature to decrypt
      const signature = getSignature();
      if (!signature) return null;

      // Decrypt the secret key
      const secretKey = decryptSecretKey(
        storedData.encryptedSecretKey,
        signature
      );

      if (!secretKey || !isValidSecretKey(secretKey)) {
        console.error('[useEncryption] Failed to decrypt stored secret key');
        return null;
      }

      return {
        publicKey: storedData.publicKey,
        secretKey,
      };
    } catch (error) {
      console.error('[useEncryption] Failed to load stored keypair:', error);
      return null;
    }
  }, [publicId, getSignature]);

  /**
   * Save keypair to localStorage (encrypted)
   */
  const saveKeypair = useCallback(
    async (keypair: KeyPair): Promise<boolean> => {
      if (!publicId) return false;

      try {
        const signature = getSignature();
        if (!signature) return false;

        // Encrypt the secret key
        const encrypted = encryptSecretKey(keypair.secretKey, signature);
        if (!encrypted) {
          console.error('[useEncryption] Failed to encrypt secret key for storage');
          return false;
        }

        const storedData: StoredKeyPair = {
          encryptedSecretKey: encrypted,
          publicKey: keypair.publicKey,
          nonce: '',
          publicId,
        };

        if (isTauri) {
          await keyring.store(KEYPAIR_STORAGE_KEY, JSON.stringify(storedData));
        } else {
          localStorage.setItem(KEYPAIR_STORAGE_KEY, JSON.stringify(storedData));
        }
        return true;
      } catch (error) {
        console.error('[useEncryption] Failed to save keypair:', error);
        return false;
      }
    },
    [publicId, getSignature]
  );

  /**
   * Get existing keypair or create a new one
   */
  const getOrCreateKeyPair = useCallback(async (): Promise<KeyPair | null> => {
    if (!isAuthenticated || !publicId) {
      setState((prev) => ({ ...prev, error: 'Not authenticated' }));
      return null;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Try to load existing keypair
      let keypair = await loadStoredKeypair();

      if (keypair && isValidPublicKey(keypair.publicKey) && isValidSecretKey(keypair.secretKey)) {
        // Store secret key in memory
        secretKeyRef.current = keypair.secretKey;

        // Cache our own public key
        if (publicId) {
          cachePublicKey(publicId, keypair.publicKey);
        }

        setState((prev) => ({
          ...prev,
          isLoading: false,
          hasKeypair: true,
          publicKey: keypair!.publicKey,
          isInitialized: true,
        }));

        return keypair;
      }

      // Generate new keypair
      keypair = generateKeyPair();
      if (!keypair) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Failed to generate keypair',
        }));
        return null;
      }

      // Save to localStorage
      const saved = await saveKeypair(keypair);
      if (!saved) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Failed to save keypair',
        }));
        return null;
      }

      // Store secret key in memory
      secretKeyRef.current = keypair.secretKey;

      // Cache our own public key
      if (publicId) {
        cachePublicKey(publicId, keypair.publicKey);
      }

      // Register public key with the server
      await registerPublicKey(keypair.publicKey);

      setState((prev) => ({
        ...prev,
        isLoading: false,
        hasKeypair: true,
        publicKey: keypair!.publicKey,
        isInitialized: true,
      }));

      return keypair;
    } catch (error) {
      console.error('[useEncryption] Error in getOrCreateKeyPair:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: 'Failed to initialize encryption',
      }));
      return null;
    }
  }, [isAuthenticated, publicId, loadStoredKeypair, saveKeypair]);

  /**
   * Register public key with the server
   */
  const registerPublicKey = async (publicKey: string): Promise<void> => {
    try {
      const response = await apiClient.post('/api/users/register-key', { publicKey });

      if (!response.success) {
        console.error('[useEncryption] Failed to register public key with server');
      }
    } catch (error) {
      console.error('[useEncryption] Error registering public key:', error);
    }
  };

  /**
   * Clear keypair from memory and storage
   */
  const clearKeyPair = useCallback((): void => {
    secretKeyRef.current = null;
    signatureRef.current = null;
    if (isTauri) {
      keyring.delete(KEYPAIR_STORAGE_KEY).catch(() => {});
    } else {
      localStorage.removeItem(KEYPAIR_STORAGE_KEY);
    }

    setState({
      isInitialized: false,
      isLoading: false,
      hasKeypair: false,
      publicKey: null,
      error: null,
    });
  }, []);

  /**
   * Encrypt a message for a specific user (DM)
   */
  const encryptForUser = useCallback(
    async (message: string, recipientPublicId: string): Promise<EncryptedMessage | null> => {
      if (!secretKeyRef.current) {
        console.error('[useEncryption] No secret key available');
        return null;
      }

      // Get recipient's public key
      const recipientPublicKey = await getPublicKey(recipientPublicId);
      if (!recipientPublicKey) {
        console.error('[useEncryption] Could not find recipient public key');
        return null;
      }

      return encryptMessage(message, recipientPublicKey, secretKeyRef.current);
    },
    []
  );

  /**
   * Decrypt a message from a specific user (DM)
   */
  const decryptFromUser = useCallback(
    async (encrypted: string, nonce: string, senderPublicId: string): Promise<string | null> => {
      if (!secretKeyRef.current) {
        console.error('[useEncryption] No secret key available');
        return null;
      }

      // Get sender's public key
      const senderPublicKey = await getPublicKey(senderPublicId);
      if (!senderPublicKey) {
        console.error('[useEncryption] Could not find sender public key');
        return null;
      }

      return decryptMessage(encrypted, nonce, senderPublicKey, secretKeyRef.current);
    },
    []
  );

  /**
   * Encrypt a message for a channel
   */
  const encryptForChannel = useCallback(
    async (message: string, channelId: string): Promise<EncryptedMessage | null> => {
      if (!secretKeyRef.current || !state.publicKey) {
        console.error('[useEncryption] No keypair available');
        return null;
      }

      // Get channel key
      const channelKey = getChannelKey(channelId, state.publicKey, secretKeyRef.current);
      if (!channelKey) {
        console.error('[useEncryption] Channel key not found');
        return null;
      }

      return encryptChannelMessage(message, channelKey);
    },
    [state.publicKey]
  );

  /**
   * Decrypt a message from a channel
   */
  const decryptFromChannel = useCallback(
    async (encrypted: string, nonce: string, channelId: string): Promise<string | null> => {
      if (!secretKeyRef.current || !state.publicKey) {
        console.error('[useEncryption] No keypair available');
        return null;
      }

      // Get channel key
      const channelKey = getChannelKey(channelId, state.publicKey, secretKeyRef.current);
      if (!channelKey) {
        console.error('[useEncryption] Channel key not found');
        return null;
      }

      return decryptChannelMessage(encrypted, nonce, channelKey);
    },
    [state.publicKey]
  );

  /**
   * Store a new channel key
   */
  const storeNewChannelKey = useCallback(
    async (channelId: string, channelKey: string): Promise<boolean> => {
      if (!secretKeyRef.current || !state.publicKey) {
        console.error('[useEncryption] No keypair available');
        return false;
      }

      const result = storeChannelKey(
        channelId,
        channelKey,
        state.publicKey,
        secretKeyRef.current
      );

      return result.success;
    },
    [state.publicKey]
  );

  /**
   * Get decrypted channel key
   */
  const getDecryptedChannelKey = useCallback(
    async (channelId: string): Promise<string | null> => {
      if (!secretKeyRef.current || !state.publicKey) {
        console.error('[useEncryption] No keypair available');
        return null;
      }

      return getChannelKey(channelId, state.publicKey, secretKeyRef.current);
    },
    [state.publicKey]
  );

  /**
   * Low-level nacl.box encrypt — uses the in-memory secret key without exposing it.
   * Used by file transfer and DKG for encrypting data to a recipient.
   */
  const boxEncrypt = useCallback(
    (plaintext: Uint8Array, nonce: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array | null => {
      if (!secretKeyRef.current) {
        console.error('[useEncryption] No secret key available for boxEncrypt');
        return null;
      }
      try {
        const senderSecKeyBytes = naclUtil.decodeBase64(secretKeyRef.current);
        return nacl.box(plaintext, nonce, recipientPublicKey, senderSecKeyBytes);
      } catch (error) {
        console.error('[useEncryption] boxEncrypt failed:', error);
        return null;
      }
    },
    []
  );

  /**
   * Low-level nacl.box.open — uses the in-memory secret key without exposing it.
   * Used by file transfer and DKG for decrypting data from a sender.
   */
  const boxOpen = useCallback(
    (ciphertext: Uint8Array, nonce: Uint8Array, senderPublicKey: Uint8Array): Uint8Array | null => {
      if (!secretKeyRef.current) {
        console.error('[useEncryption] No secret key available for boxOpen');
        return null;
      }
      try {
        const recipientSecKeyBytes = naclUtil.decodeBase64(secretKeyRef.current);
        return nacl.box.open(ciphertext, nonce, senderPublicKey, recipientSecKeyBytes);
      } catch (error) {
        console.error('[useEncryption] boxOpen failed:', error);
        return null;
      }
    },
    []
  );

  /**
   * Re-authorize encryption (refresh signature)
   */
  const reauthorize = useCallback(async (): Promise<boolean> => {
    signatureRef.current = null;
    const signature = getSignature();
    return signature !== null;
  }, [getSignature]);

  /**
   * Initialize key store on mount
   */
  useEffect(() => {
    initializeKeyStore();
  }, []);

  /**
   * Clear keys when user logs out
   */
  useEffect(() => {
    if (!isAuthenticated) {
      secretKeyRef.current = null;
      signatureRef.current = null;
      setState((prev) => ({
        ...prev,
        hasKeypair: false,
        publicKey: null,
        isInitialized: false,
      }));
    }
  }, [isAuthenticated]);

  return {
    ...state,
    getOrCreateKeyPair,
    clearKeyPair,
    encryptForUser,
    decryptFromUser,
    encryptForChannel,
    decryptFromChannel,
    storeNewChannelKey,
    getDecryptedChannelKey,
    boxEncrypt,
    boxOpen,
    reauthorize,
  };
}

/**
 * Hook for checking if encryption is ready
 */
export function useEncryptionReady(): boolean {
  const { isInitialized, hasKeypair } = useEncryption();
  return isInitialized && hasKeypair;
}

export default useEncryption;
