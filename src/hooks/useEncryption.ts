'use client';

/**
 * React hook for encryption operations in Void Chat
 *
 * Provides:
 * - Keypair generation and storage (encrypted with wallet signature)
 * - Message encryption/decryption for DMs
 * - Channel message encryption/decryption
 * - Integration with Solana wallet for signing
 *
 * Security Notes:
 * - Private keys are encrypted before storage using wallet signature
 * - Keypairs are stored in localStorage (encrypted)
 * - Never expose secret keys in plaintext
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
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

// Message to sign for deriving encryption key
const SIGNATURE_MESSAGE = 'Void Chat - Authorize encryption keys';

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
  encryptForUser: (message: string, recipientWallet: string) => Promise<EncryptedMessage | null>;
  decryptFromUser: (encrypted: string, nonce: string, senderWallet: string) => Promise<string | null>;

  // Channel encryption
  encryptForChannel: (message: string, channelId: string) => Promise<EncryptedMessage | null>;
  decryptFromChannel: (encrypted: string, nonce: string, channelId: string) => Promise<string | null>;

  // Channel key management
  storeNewChannelKey: (channelId: string, channelKey: string) => Promise<boolean>;
  getDecryptedChannelKey: (channelId: string) => Promise<string | null>;

  // Re-authorize (for session refresh)
  reauthorize: () => Promise<boolean>;
}

/**
 * Hook for managing encryption operations
 * Must be used within WalletProvider context
 */
export function useEncryption(): UseEncryptionReturn {
  const { publicKey: walletPublicKey, signMessage, connected } = useWallet();

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
   * Get wallet address as string
   */
  const getWalletAddress = useCallback((): string | null => {
    if (!walletPublicKey) return null;
    return walletPublicKey.toBase58();
  }, [walletPublicKey]);

  /**
   * Sign a message with the wallet to derive encryption key
   */
  const getSignature = useCallback(async (): Promise<string | null> => {
    // Return cached signature if available
    if (signatureRef.current) {
      return signatureRef.current;
    }

    if (!signMessage) {
      setState((prev) => ({ ...prev, error: 'Wallet does not support message signing' }));
      return null;
    }

    try {
      const messageBytes = new TextEncoder().encode(SIGNATURE_MESSAGE);
      const signature = await signMessage(messageBytes);
      const signatureString = bs58.encode(signature);
      signatureRef.current = signatureString;
      return signatureString;
    } catch (error) {
      console.error('[useEncryption] Failed to sign message:', error);
      setState((prev) => ({ ...prev, error: 'Failed to authorize encryption' }));
      return null;
    }
  }, [signMessage]);

  /**
   * Load stored keypair from localStorage
   */
  const loadStoredKeypair = useCallback(async (): Promise<KeyPair | null> => {
    const walletAddress = getWalletAddress();
    if (!walletAddress) return null;

    try {
      const stored = localStorage.getItem(KEYPAIR_STORAGE_KEY);
      if (!stored) return null;

      const storedData: StoredKeyPair = JSON.parse(stored);

      // Verify this keypair belongs to the current wallet
      if (storedData.walletAddress !== walletAddress) {
        console.warn('[useEncryption] Stored keypair belongs to different wallet');
        return null;
      }

      // Get signature to decrypt
      const signature = await getSignature();
      if (!signature) return null;

      // Decrypt the secret key
      const secretKey = decryptSecretKey(
        storedData.encryptedSecretKey,
        storedData.nonce,
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
  }, [getWalletAddress, getSignature]);

  /**
   * Save keypair to localStorage (encrypted)
   */
  const saveKeypair = useCallback(
    async (keypair: KeyPair): Promise<boolean> => {
      const walletAddress = getWalletAddress();
      if (!walletAddress) return false;

      try {
        const signature = await getSignature();
        if (!signature) return false;

        // Encrypt the secret key
        const encrypted = encryptSecretKey(keypair.secretKey, signature);
        if (!encrypted) {
          console.error('[useEncryption] Failed to encrypt secret key for storage');
          return false;
        }

        const storedData: StoredKeyPair = {
          encryptedSecretKey: encrypted.encrypted,
          publicKey: keypair.publicKey,
          nonce: encrypted.nonce,
          walletAddress,
        };

        localStorage.setItem(KEYPAIR_STORAGE_KEY, JSON.stringify(storedData));
        return true;
      } catch (error) {
        console.error('[useEncryption] Failed to save keypair:', error);
        return false;
      }
    },
    [getWalletAddress, getSignature]
  );

  /**
   * Get existing keypair or create a new one
   */
  const getOrCreateKeyPair = useCallback(async (): Promise<KeyPair | null> => {
    if (!connected || !walletPublicKey) {
      setState((prev) => ({ ...prev, error: 'Wallet not connected' }));
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
        const walletAddress = getWalletAddress();
        if (walletAddress) {
          cachePublicKey(walletAddress, keypair.publicKey);
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
      const walletAddress = getWalletAddress();
      if (walletAddress) {
        cachePublicKey(walletAddress, keypair.publicKey);
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
  }, [connected, walletPublicKey, loadStoredKeypair, saveKeypair, getWalletAddress]);

  /**
   * Register public key with the server
   */
  const registerPublicKey = async (publicKey: string): Promise<void> => {
    try {
      const response = await fetch('/api/users/register-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey }),
      });

      if (!response.ok) {
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
    localStorage.removeItem(KEYPAIR_STORAGE_KEY);

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
    async (message: string, recipientWallet: string): Promise<EncryptedMessage | null> => {
      if (!secretKeyRef.current) {
        console.error('[useEncryption] No secret key available');
        return null;
      }

      // Get recipient's public key
      const recipientPublicKey = await getPublicKey(recipientWallet);
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
    async (encrypted: string, nonce: string, senderWallet: string): Promise<string | null> => {
      if (!secretKeyRef.current) {
        console.error('[useEncryption] No secret key available');
        return null;
      }

      // Get sender's public key
      const senderPublicKey = await getPublicKey(senderWallet);
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
   * Re-authorize encryption (refresh signature)
   */
  const reauthorize = useCallback(async (): Promise<boolean> => {
    signatureRef.current = null;
    const signature = await getSignature();
    return signature !== null;
  }, [getSignature]);

  /**
   * Initialize key store on mount
   */
  useEffect(() => {
    initializeKeyStore();
  }, []);

  /**
   * Clear keys when wallet disconnects
   */
  useEffect(() => {
    if (!connected) {
      secretKeyRef.current = null;
      signatureRef.current = null;
      setState((prev) => ({
        ...prev,
        hasKeypair: false,
        publicKey: null,
        isInitialized: false,
      }));
    }
  }, [connected]);

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
