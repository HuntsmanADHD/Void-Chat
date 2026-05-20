/**
 * Hook for Key Distribution in Void Chat
 *
 * Manages the key distribution protocol for generating and reconstructing
 * group channel keys using Shamir's Secret Sharing with Feldman VSS
 * verification.
 *
 * TRUST MODEL: The initiator is trusted to generate the key honestly.
 * Feldman VSS commitments allow recipients to verify that their shares
 * are consistent with a single polynomial (preventing garbage shares).
 * This is NOT a true DKG — see lib/dkg.ts for details.
 */

import { useState, useCallback, useRef } from 'react';
import {
  generateGroupKeyWithCallback,
  decryptShareWithCallback,
  verifyShare,
  reconstructChannelKey,
  calculateThreshold,
  type Share,
  type DKGSession,
  type FeldmanCommitments,
  type BoxEncryptFn,
  type BoxOpenFn,
} from '@/lib/dkg';

interface DKGState {
  isInitiating: boolean;
  isReconstructing: boolean;
  session: DKGSession | null;
  error: string | null;
}

export function useDKG(
  localPublicId: string,
  boxEncrypt: BoxEncryptFn | null,
  boxOpen: BoxOpenFn | null
) {
  const [state, setState] = useState<DKGState>({
    isInitiating: false,
    isReconstructing: false,
    session: null,
    error: null,
  });

  // Store collected shares for reconstruction
  const collectedShares = useRef<Map<string, Share[]>>(new Map());

  /**
   * Initiate key distribution for a channel — generate key and distribute shares.
   * Returns the session including Feldman VSS commitments that must be sent
   * alongside the encrypted shares so recipients can verify.
   */
  const initiateGroupKey = useCallback(
    (channelId: string, memberPublicKeys: Map<string, string>) => {
      if (!boxEncrypt) {
        setState(prev => ({ ...prev, error: 'Encryption not available' }));
        return null;
      }

      setState(prev => ({ ...prev, isInitiating: true, error: null }));

      const session = generateGroupKeyWithCallback(channelId, memberPublicKeys, boxEncrypt);

      if (!session) {
        setState(prev => ({ ...prev, isInitiating: false, error: 'Failed to generate group key' }));
        return null;
      }

      setState(prev => ({ ...prev, isInitiating: false, session }));
      return session;
    },
    [boxEncrypt]
  );

  /**
   * Accept a share from the key distribution initiator.
   *
   * If Feldman VSS commitments are provided, the share is verified against
   * them before being accepted. If verification fails, the share is rejected
   * and null is returned. This prevents accepting garbage/malicious shares.
   *
   * @param channelId - Channel the share is for
   * @param encryptedPackage - The encrypted share (nonce:ciphertext)
   * @param senderPublicKey - Initiator's public key (base64)
   * @param feldmanCommitments - Optional Feldman VSS commitments for verification
   * @returns The verified share, or null on failure
   */
  const acceptShare = useCallback(
    (
      channelId: string,
      encryptedPackage: string,
      senderPublicKey: string,
      feldmanCommitments?: FeldmanCommitments
    ) => {
      if (!boxOpen) return null;

      const share = decryptShareWithCallback(encryptedPackage, senderPublicKey, boxOpen);
      if (!share) {
        setState(prev => ({ ...prev, error: 'Failed to decrypt share' }));
        return null;
      }

      // Verify share against Feldman VSS commitments if provided
      if (feldmanCommitments) {
        const valid = verifyShare(share, feldmanCommitments);
        if (!valid) {
          setState(prev => ({
            ...prev,
            error: 'Share failed Feldman VSS verification — rejecting (possible malicious initiator)',
          }));
          console.error('[KeyDist] Share from', senderPublicKey.slice(0, 8), 'failed Feldman VSS verification for channel', channelId);
          return null;
        }
      } else {
        console.warn('[KeyDist] No Feldman commitments provided for share verification — accepting unverified share');
      }

      // Store the verified share
      const existing = collectedShares.current.get(channelId) || [];
      existing.push(share);
      collectedShares.current.set(channelId, existing);

      return share;
    },
    [boxOpen]
  );

  /**
   * Contribute a share for key reconstruction
   */
  const contributeShare = useCallback(
    (channelId: string, share: Share) => {
      const existing = collectedShares.current.get(channelId) || [];
      existing.push(share);
      collectedShares.current.set(channelId, existing);
    },
    []
  );

  /**
   * Attempt to reconstruct the channel key from collected shares
   */
  const reconstruct = useCallback(
    (channelId: string, threshold?: number) => {
      const shares = collectedShares.current.get(channelId);
      if (!shares || shares.length === 0) {
        setState(prev => ({ ...prev, error: 'No shares collected' }));
        return null;
      }

      if (threshold && shares.length < threshold) {
        setState(prev => ({
          ...prev,
          error: `Need ${threshold} shares, have ${shares.length}`,
        }));
        return null;
      }

      setState(prev => ({ ...prev, isReconstructing: true, error: null }));

      const channelKey = reconstructChannelKey(shares);

      setState(prev => ({ ...prev, isReconstructing: false }));

      if (!channelKey) {
        setState(prev => ({ ...prev, error: 'Reconstruction failed' }));
        return null;
      }

      return channelKey;
    },
    []
  );

  /**
   * Get the required threshold for a member count
   */
  const getThreshold = useCallback((memberCount: number) => {
    return calculateThreshold(memberCount);
  }, []);

  /**
   * Get the number of shares collected for a channel
   */
  const getShareCount = useCallback((channelId: string) => {
    return collectedShares.current.get(channelId)?.length || 0;
  }, []);

  return {
    ...state,
    initiateGroupKey,
    acceptShare,
    contributeShare,
    reconstruct,
    getThreshold,
    getShareCount,
  };
}
