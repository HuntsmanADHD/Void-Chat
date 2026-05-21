'use client';

/**
 * useRealtime — STUB (ephemeral pivot, phase 1).
 *
 * The real implementation will:
 *  - Connect to the socket server with no auth.
 *  - Send `session:announce` { signingPublicKey, boxPublicKey, displayName } on connect.
 *  - Join/leave channels and DMs.
 *  - Receive channel rosters on join (member pubkeys + display names).
 *  - Fan-out send: encrypt each outgoing channel message to every current
 *    member's box public key, send the array of { recipientPubkey, ciphertext }
 *    to the server.
 *  - Receive single ciphertext per delivery, hand to useEncryption for decrypt.
 *  - Append decrypted plaintext to local IndexedDB messageStore.
 *
 * Until then, this is a stub so consumers compile.
 */

import { useCallback } from 'react';

export interface OnMessageReceived {
  (message: {
    id: string;
    senderId: string;
    senderPublicKey?: string;
    channelId?: string;
    dmRecipientId?: string;
    timestamp: number;
    encrypted?: string;
    nonce?: string;
  }): void;
}

export interface UseRealtimeOptions {
  onMessage?: OnMessageReceived;
  autoConnect?: boolean;
  preferP2P?: boolean;
}

export function useRealtime(_options: UseRealtimeOptions = {}) {
  const noop = useCallback(() => {}, []);
  const noopAsync = useCallback(async (): Promise<boolean> => false, []);
  const falseFn = useCallback((_id: string) => false, []);

  return {
    isConnected: false,
    isReady: false,
    roster: [] as Array<{ signingPublicKey: string; boxPublicKey: string; displayName: string }>,
    joinChannel: noop as (channelId: string) => void,
    leaveChannel: noop as (channelId: string) => void,
    joinDM: noop as (recipientPublicKey: string) => void,
    leaveDM: noop as (recipientPublicKey: string) => void,
    sendMessage: noopAsync as (
      target: string,
      ciphertext: string,
      nonce: string,
      opts?: { preferP2P?: boolean }
    ) => Promise<boolean>,
    isUserOnline: falseFn,
    isPeerConnected: falseFn,
    initiatePeerConnection: noop as (peerId: string) => void,
    // legacy aliases used by older pages:
    sendChannelMessage: noopAsync as (
      channelId: string,
      ciphertext: string,
      nonce: string
    ) => Promise<boolean>,
    sendDM: noopAsync as (
      recipientPublicKey: string,
      ciphertext: string,
      nonce: string
    ) => Promise<boolean>,
  };
}

export default useRealtime;
