'use client';

/**
 * useEncryption — STUB (ephemeral pivot, phase 1).
 *
 * Returns no-op placeholders for both the new ephemeral API
 * (encryptForRecipient/encryptForRecipients/decrypt) and the legacy API
 * still referenced by old pages (hasKeypair/getOrCreateKeyPair/clearKeyPair/
 * encryptForUser/encryptForChannel/decryptFromUser/decryptFromChannel).
 * Real implementation comes in the next phase.
 */

import { useCallback } from 'react';
import { useSession } from './useSession';

export function useEncryption() {
  const { session, isReady } = useSession();

  // ── New ephemeral API (per-recipient + DM) ──────────────────────────
  const encryptForRecipient = useCallback(
    async (_plaintext: string, _recipientBoxPubkey: string): Promise<{ ciphertext: string; nonce: string } | null> => {
      return null;
    },
    []
  );

  const encryptForRecipients = useCallback(
    async (_plaintext: string, recipientBoxPubkeys: string[]) => {
      return recipientBoxPubkeys.map((pk) => ({ recipientPubkey: pk, ciphertext: '', nonce: '' }));
    },
    []
  );

  const decrypt = useCallback(
    async (_ciphertext: string, _nonce: string, _senderBoxPubkey: string): Promise<string | null> => {
      return null;
    },
    []
  );

  // ── Legacy API (no-op stubs so old pages compile) ───────────────────
  const hasKeypair = isReady;
  const publicKey = session?.boxPublicKey ?? null;

  const getOrCreateKeyPair = useCallback(async (): Promise<{ publicKey: string; secretKey: string } | null> => {
    return null;
  }, []);

  const clearKeyPair = useCallback(() => {}, []);

  const encryptForUser = useCallback(
    async (_message: string, _recipientPublicKey: string): Promise<{ encrypted: string; nonce: string } | null> => {
      return null;
    },
    []
  );

  const encryptForChannel = useCallback(
    async (_message: string, _channelId: string): Promise<{ encrypted: string; nonce: string } | null> => {
      return null;
    },
    []
  );

  const decryptFromUser = useCallback(
    async (_encrypted: string, _nonce: string, _senderPublicKey: string): Promise<string | null> => {
      return null;
    },
    []
  );

  const decryptFromChannel = useCallback(
    async (_encrypted: string, _nonce: string, _channelId: string): Promise<string | null> => {
      return null;
    },
    []
  );

  return {
    isInitialized: isReady,
    sessionBoxPublicKey: session?.boxPublicKey ?? null,
    encryptForRecipient,
    encryptForRecipients,
    decrypt,
    // legacy:
    hasKeypair,
    publicKey,
    getOrCreateKeyPair,
    clearKeyPair,
    encryptForUser,
    encryptForChannel,
    decryptFromUser,
    decryptFromChannel,
  };
}

export function useEncryptionReady(): boolean {
  const { isReady } = useSession();
  return isReady;
}

export default useEncryption;
