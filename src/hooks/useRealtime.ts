/**
 * Thin React surface over the module-level realtime client.
 *
 * The client owns the socket, state machine, rosters, and encryption.
 * This hook wires the React lifecycle to it: initialize the client when
 * a session is available, expose a stable API, subscribe to messages and
 * rosters for the current page.
 *
 * Multiple components can call `useRealtime()` concurrently — they all
 * share one socket connection. A channel stays joined as long as any
 * mounted component holds a reference.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRealtimeClient,
  type ConnectionState,
  type DecryptedChannelMessage,
  type DecryptedDMMessage,
} from '@/lib/realtimeClient';
import { useSession } from './useSession';
import type { RosterMember } from '@/types/wire';

export type { DecryptedChannelMessage, DecryptedDMMessage, ConnectionState };

export interface UseRealtimeOptions {
  /** Subscribe to channel message deliveries while this component is mounted. */
  onChannelMessage?: (msg: DecryptedChannelMessage) => void;
  /** Subscribe to DM deliveries while this component is mounted. */
  onDMMessage?: (msg: DecryptedDMMessage) => void;
  /** Called when a DM send failed because the recipient is offline. */
  // Note: `onDMOffline` was removed along with the `dm:offline` wire
  // event — it was a presence oracle (a relay told you whether a
  // peer's boxPublicKey was currently connected). Server stopped
  // emitting it in audit pt1 #9; the entire wire surface was deleted
  // in audit pt5 M1 to close the re-openable client-side path.
  /** Override the relay base URL. Pages that operate on a remote-hosted
   *  community pass the proxy URL (`http://localhost:11811/o/<onion>`)
   *  so socket.io dials through Tor. Falls back to the local relay. */
  relayUrl?: string;
}

export interface UseRealtimeReturn {
  connectionState: ConnectionState;
  isReady: boolean;
  joinChannel: (channelId: string) => void;
  leaveChannel: (channelId: string) => void;
  sendChannelMessage: (channelId: string, plaintext: string) => Promise<boolean>;
  sendDM: (recipientBoxPublicKey: string, plaintext: string) => Promise<boolean>;
  /** Current roster snapshot for a channel (empty if not joined or roster not received yet). */
  getChannelRoster: (channelId: string) => RosterMember[];
  /** Look up a peer's box public key by signing public key across all joined channels. */
  lookupBoxKey: (signingPublicKey: string) => string | null;
}

export function useRealtime(options: UseRealtimeOptions = {}): UseRealtimeReturn {
  const { session } = useSession();
  const client = getRealtimeClient();
  const [connectionState, setConnectionState] = useState<ConnectionState>(client.getState());

  // Pin callbacks in refs so subscription effect doesn't churn on every render.
  const channelCbRef = useRef(options.onChannelMessage);
  const dmCbRef = useRef(options.onDMMessage);
  channelCbRef.current = options.onChannelMessage;
  dmCbRef.current = options.onDMMessage;

  // Initialize the singleton when the session becomes available.
  // If `relayUrl` changes (e.g. the user navigates from a local community
  // to a remote one), the client tears down the old socket and rebuilds
  // against the new endpoint. The session identity is preserved across
  // that swap so we don't burn a fresh keypair every navigation.
  useEffect(() => {
    if (!session) return;
    client.init(session, options.relayUrl);
  }, [client, session, options.relayUrl]);

  // Mirror connection state into React state so consumers re-render.
  useEffect(() => {
    setConnectionState(client.getState());
    return client.onStateChange(setConnectionState);
  }, [client]);

  // Subscribe to message streams while this hook instance is mounted.
  useEffect(() => {
    const offChannel = client.onChannelMessage((m) => channelCbRef.current?.(m));
    const offDM = client.onDMMessage((m) => dmCbRef.current?.(m));
    return () => {
      offChannel();
      offDM();
    };
  }, [client]);

  const joinChannel = useCallback((channelId: string) => client.joinChannel(channelId), [client]);
  const leaveChannel = useCallback((channelId: string) => client.leaveChannel(channelId), [client]);
  const sendChannelMessage = useCallback(
    (channelId: string, plaintext: string) => client.sendChannelMessage(channelId, plaintext),
    [client],
  );
  const sendDM = useCallback(
    (recipientBoxPublicKey: string, plaintext: string) =>
      client.sendDM(recipientBoxPublicKey, plaintext),
    [client],
  );
  const getChannelRoster = useCallback(
    (channelId: string) => client.getRoster(channelId),
    [client],
  );
  const lookupBoxKey = useCallback(
    (signingPublicKey: string) => client.lookupBoxKey(signingPublicKey),
    [client],
  );

  return {
    connectionState,
    isReady: connectionState === 'ready',
    joinChannel,
    leaveChannel,
    sendChannelMessage,
    sendDM,
    getChannelRoster,
    lookupBoxKey,
  };
}

/** Subscribe to per-channel roster updates. Re-renders when the roster changes. */
export function useChannelRoster(channelId: string | null): RosterMember[] {
  const client = getRealtimeClient();
  const [roster, setRoster] = useState<RosterMember[]>(() =>
    channelId ? client.getRoster(channelId) : [],
  );

  useEffect(() => {
    if (!channelId) {
      setRoster([]);
      return;
    }
    setRoster(client.getRoster(channelId));
    return client.onRosterChange((id, members) => {
      if (id === channelId) setRoster(members);
    });
  }, [client, channelId]);

  return roster;
}

export default useRealtime;
