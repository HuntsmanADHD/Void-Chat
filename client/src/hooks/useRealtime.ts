/**
 * Real-time Messaging Hook for Void Chat
 * Combines P2P and Socket.io for optimal message delivery
 *
 * Features:
 * - Try P2P first, fallback to Socket relay
 * - Handle incoming messages from both channels
 * - Maintain online user list
 * - Typing indicators
 * - Automatic reconnection
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { SignalData } from 'simple-peer';
import { P2PManager, getP2PManager, destroyP2PManager, createP2PMessage } from '@/lib/p2p';
import { SocketManager, getSocketManager, destroySocketManager } from '@/lib/socket';
import type {
  SocketConnectionState,
  PeerConnectionState,
  PeerConnection,
  RealtimeMessage,
  TypingUser,
  P2PMessage,
  P2PSignal,
  SendMessageOptions,
} from '@/types/p2p';

/**
 * Message handler callback type
 */
export type OnMessageReceived = (message: RealtimeMessage) => void;

/**
 * Realtime hook state
 */
interface UseRealtimeState {
  socketState: SocketConnectionState;
  isAuthenticated: boolean;
  onlineUsers: Set<string>;
  typingUsers: Map<string, TypingUser[]>;
  peerConnections: Map<string, PeerConnection>;
  error: string | null;
}

/**
 * Realtime hook options
 */
interface UseRealtimeOptions {
  onMessage?: OnMessageReceived;
  autoConnect?: boolean;
  preferP2P?: boolean;
}

/**
 * Realtime hook return value
 */
interface UseRealtimeReturn extends UseRealtimeState {
  connect: () => void;
  disconnect: () => void;
  authenticate: (signature: string, message: string) => void;
  joinChannel: (channelId: string) => void;
  leaveChannel: (channelId: string) => void;
  joinDM: (recipientPublicId: string) => void;
  leaveDM: (recipientPublicId: string) => void;
  sendMessage: (
    recipientId: string,
    encrypted: string,
    nonce: string,
    options?: SendMessageOptions
  ) => Promise<boolean>;
  sendChannelMessage: (
    channelId: string,
    encrypted: string,
    nonce: string
  ) => void;
  startTyping: (channelId?: string, dmPublicId?: string) => void;
  stopTyping: (channelId?: string, dmPublicId?: string) => void;
  isUserOnline: (publicId: string) => boolean;
  getTypingUsers: (channelId?: string, dmPublicId?: string) => TypingUser[];
  isPeerConnected: (publicId: string) => boolean;
  initiatePeerConnection: (publicId: string) => void;
}

/**
 * Custom hook for real-time messaging
 * Integrates P2P (WebRTC) and Socket.io for optimal delivery
 */
export function useRealtime(options: UseRealtimeOptions = {}): UseRealtimeReturn {
  const { onMessage, autoConnect = true, preferP2P = true } = options;
  const { publicId, publicKey, isAuthenticated: authReady } = useAuth();

  const [state, setState] = useState<UseRealtimeState>({
    socketState: 'disconnected',
    isAuthenticated: false,
    onlineUsers: new Set(),
    typingUsers: new Map(),
    peerConnections: new Map(),
    error: null,
  });

  // Refs for managers and callbacks
  const socketManagerRef = useRef<SocketManager | null>(null);
  const p2pManagerRef = useRef<P2PManager | null>(null);
  const onMessageRef = useRef(onMessage);
  const preferP2PRef = useRef(preferP2P);

  // Keep refs updated
  useEffect(() => {
    onMessageRef.current = onMessage;
    preferP2PRef.current = preferP2P;
  }, [onMessage, preferP2P]);

  /**
   * Handle incoming P2P message
   */
  const handleP2PMessage = useCallback((message: P2PMessage) => {
    if (message.type !== 'message') return;

    const realtimeMessage: RealtimeMessage = {
      id: message.id,
      content: '', // Will be decrypted by the consumer
      senderId: message.senderId,
      timestamp: message.timestamp,
      channelId: message.channelId,
      dmRecipientId: message.recipientId,
      status: 'delivered',
      viaP2P: true,
    };

    // Store encrypted data for consumer to decrypt
    (realtimeMessage as RealtimeMessage & { encrypted?: string; nonce?: string }).encrypted =
      message.encrypted;
    (realtimeMessage as RealtimeMessage & { encrypted?: string; nonce?: string }).nonce =
      message.nonce;

    if (onMessageRef.current) {
      onMessageRef.current(realtimeMessage);
    }
  }, []);

  /**
   * Handle P2P connection state changes
   */
  const handleP2PConnectionStateChange = useCallback(
    (peerId: string, peerState: PeerConnectionState) => {
      setState((prev) => {
        const newConnections = new Map(prev.peerConnections);
        const existing = newConnections.get(peerId);
        if (existing) {
          newConnections.set(peerId, { ...existing, state: peerState });
        }
        return { ...prev, peerConnections: newConnections };
      });
    },
    []
  );

  /**
   * Handle P2P signal (to be sent via Socket.io)
   */
  const handleP2PSignal = useCallback((peerId: string, signal: SignalData) => {
    const socketManager = socketManagerRef.current;
    if (!socketManager?.isConnected()) return;

    // Type-safe signal data extraction
    const p2pSignal: P2PSignal = {
      type: signal.type === 'offer' ? 'offer' : signal.type === 'answer' ? 'answer' : 'ice-candidate',
      sdp: 'sdp' in signal && typeof signal.sdp === 'string' ? signal.sdp : undefined,
      candidate: 'candidate' in signal ? signal.candidate as RTCIceCandidate | undefined : undefined,
    };

    if (signal.type === 'offer') {
      socketManager.sendSignalOffer(peerId, p2pSignal);
    } else if (signal.type === 'answer') {
      socketManager.sendSignalAnswer(peerId, p2pSignal);
    }
  }, []);

  /**
   * Initialize P2P manager
   */
  const initP2PManager = useCallback(() => {
    if (!publicId) return;

    const manager = getP2PManager(publicId);

    manager.setOnMessage(handleP2PMessage);
    manager.setOnConnectionStateChange(handleP2PConnectionStateChange);
    manager.setOnSignal(handleP2PSignal);
    manager.setOnError((peerId, error) => {
      console.error(`[Realtime] P2P error with ${peerId}:`, error);
    });

    p2pManagerRef.current = manager;
  }, [publicId, handleP2PMessage, handleP2PConnectionStateChange, handleP2PSignal]);

  /**
   * Initialize Socket manager
   */
  const initSocketManager = useCallback(() => {
    const manager = getSocketManager();

    // Connection state
    manager.setOnConnectionStateChange((socketState) => {
      setState((prev) => ({
        ...prev,
        socketState,
        isAuthenticated: socketState === 'authenticated',
      }));
    });

    // Channel messages
    manager.setOnChannelMessage((data) => {
      const realtimeMessage: RealtimeMessage = {
        id: data.id,
        content: '',
        senderId: data.senderId,
        timestamp: data.timestamp,
        channelId: data.channelId,
        status: 'delivered',
        viaP2P: false,
      };

      (realtimeMessage as RealtimeMessage & { encrypted?: string; nonce?: string }).encrypted =
        data.encrypted;
      (realtimeMessage as RealtimeMessage & { encrypted?: string; nonce?: string }).nonce =
        data.nonce;

      if (onMessageRef.current) {
        onMessageRef.current(realtimeMessage);
      }
    });

    // DM messages
    manager.setOnDMMessage((data) => {
      const realtimeMessage: RealtimeMessage = {
        id: data.id,
        content: '',
        senderId: data.senderId,
        timestamp: data.timestamp,
        status: 'delivered',
        viaP2P: false,
      };

      (realtimeMessage as RealtimeMessage & { encrypted?: string; nonce?: string }).encrypted =
        data.encrypted;
      (realtimeMessage as RealtimeMessage & { encrypted?: string; nonce?: string }).nonce =
        data.nonce;

      if (onMessageRef.current) {
        onMessageRef.current(realtimeMessage);
      }
    });

    // P2P signaling via Socket.io
    manager.setOnSignalOffer((data) => {
      const p2pManager = p2pManagerRef.current;
      if (p2pManager) {
        const signalData: SignalData = {
          type: 'offer',
          sdp: data.signal.sdp,
        };
        p2pManager.handleSignal(data.fromPublicId, signalData);
      }
    });

    manager.setOnSignalAnswer((data) => {
      const p2pManager = p2pManagerRef.current;
      if (p2pManager) {
        const signalData: SignalData = {
          type: 'answer',
          sdp: data.signal.sdp,
        };
        p2pManager.handleSignal(data.fromPublicId, signalData);
      }
    });

    manager.setOnICECandidate((data) => {
      const p2pManager = p2pManagerRef.current;
      if (p2pManager) {
        const signalData: SignalData = {
          type: 'candidate',
          candidate: data.candidate,
        };
        p2pManager.handleSignal(data.fromPublicId, signalData);
      }
    });

    // Online users
    manager.setOnUsersOnline((publicIds) => {
      setState((prev) => ({
        ...prev,
        onlineUsers: new Set(publicIds),
      }));
    });

    manager.setOnUserOnline((id) => {
      setState((prev) => {
        const newOnline = new Set(prev.onlineUsers);
        newOnline.add(id);
        return { ...prev, onlineUsers: newOnline };
      });
    });

    manager.setOnUserOffline((id) => {
      setState((prev) => {
        const newOnline = new Set(prev.onlineUsers);
        newOnline.delete(id);
        return { ...prev, onlineUsers: newOnline };
      });
    });

    // Typing indicators
    manager.setOnTypingUpdate((data) => {
      setState((prev) => {
        const newTyping = new Map(prev.typingUsers);
        const key = data.channelId || data.dmPublicId || '';

        let users = newTyping.get(key) || [];

        if (data.isTyping) {
          // Add or update typing user
          const existingIndex = users.findIndex((u) => u.publicId === data.publicId);
          if (existingIndex >= 0) {
            users[existingIndex] = { publicId: data.publicId, startedAt: Date.now() };
          } else {
            users = [...users, { publicId: data.publicId, startedAt: Date.now() }];
          }
        } else {
          // Remove typing user
          users = users.filter((u) => u.publicId !== data.publicId);
        }

        if (users.length > 0) {
          newTyping.set(key, users);
        } else {
          newTyping.delete(key);
        }

        return { ...prev, typingUsers: newTyping };
      });
    });

    // Errors
    manager.setOnError((error) => {
      setState((prev) => ({ ...prev, error: error.message }));
    });

    socketManagerRef.current = manager;
  }, []);

  /**
   * Connect to realtime services
   */
  const connect = useCallback(() => {
    initSocketManager();
    socketManagerRef.current?.connect();

    if (publicId) {
      initP2PManager();
    }
  }, [initSocketManager, initP2PManager, publicId]);

  /**
   * Disconnect from realtime services
   */
  const disconnect = useCallback(() => {
    socketManagerRef.current?.disconnect();
    p2pManagerRef.current?.destroy();
    destroySocketManager();
    destroyP2PManager();
    socketManagerRef.current = null;
    p2pManagerRef.current = null;

    setState({
      socketState: 'disconnected',
      isAuthenticated: false,
      onlineUsers: new Set(),
      typingUsers: new Map(),
      peerConnections: new Map(),
      error: null,
    });
  }, []);

  /**
   * Authenticate with the server
   */
  const authenticate = useCallback((signature: string, message: string) => {
    if (!publicId || !socketManagerRef.current) return;
    socketManagerRef.current.authenticate(publicId, signature, message);
  }, [publicId]);

  /**
   * Join a channel
   */
  const joinChannel = useCallback((channelId: string) => {
    socketManagerRef.current?.joinChannel(channelId);
  }, []);

  /**
   * Leave a channel
   */
  const leaveChannel = useCallback((channelId: string) => {
    socketManagerRef.current?.leaveChannel(channelId);
  }, []);

  /**
   * Join a DM room
   */
  const joinDM = useCallback((recipientPublicId: string) => {
    socketManagerRef.current?.joinDM(recipientPublicId);
  }, []);

  /**
   * Leave a DM room
   */
  const leaveDM = useCallback((recipientPublicId: string) => {
    socketManagerRef.current?.leaveDM(recipientPublicId);
  }, []);

  /**
   * Send a message - tries P2P first if available, falls back to Socket relay
   */
  const sendMessage = useCallback(
    async (
      recipientId: string,
      encrypted: string,
      nonce: string,
      msgOptions?: SendMessageOptions
    ): Promise<boolean> => {
      const shouldPreferP2P = msgOptions?.preferP2P ?? preferP2PRef.current;

      if (!publicId) {
        console.error('[Realtime] Cannot send message: not authenticated');
        return false;
      }

      const p2pManager = p2pManagerRef.current;
      const socketManager = socketManagerRef.current;

      // Try P2P first if preferred and connected
      if (shouldPreferP2P && p2pManager?.isConnected(recipientId)) {
        const message = createP2PMessage(
          'message',
          publicId,
          recipientId,
          encrypted,
          nonce
        );

        const sent = p2pManager.sendMessage(recipientId, message);
        if (sent) {
          return true;
        }
      }

      // Fallback to Socket relay
      if (socketManager?.isConnected()) {
        socketManager.sendDMMessage(recipientId, encrypted, nonce);
        return true;
      }

      console.error('[Realtime] Cannot send message: no connection available');
      return false;
    },
    [publicId]
  );

  /**
   * Send a channel message (always via Socket)
   */
  const sendChannelMessage = useCallback(
    (channelId: string, encrypted: string, nonce: string) => {
      socketManagerRef.current?.sendChannelMessage(channelId, encrypted, nonce);
    },
    []
  );

  /**
   * Start typing indicator
   */
  const startTyping = useCallback((channelId?: string, dmPublicId?: string) => {
    socketManagerRef.current?.startTyping(channelId, dmPublicId);
  }, []);

  /**
   * Stop typing indicator
   */
  const stopTyping = useCallback((channelId?: string, dmPublicId?: string) => {
    socketManagerRef.current?.stopTyping(channelId, dmPublicId);
  }, []);

  /**
   * Check if a user is online
   */
  const isUserOnline = useCallback(
    (id: string): boolean => {
      return state.onlineUsers.has(id);
    },
    [state.onlineUsers]
  );

  /**
   * Get typing users for a channel or DM
   */
  const getTypingUsers = useCallback(
    (channelId?: string, dmPublicId?: string): TypingUser[] => {
      const key = channelId || dmPublicId || '';
      return state.typingUsers.get(key) || [];
    },
    [state.typingUsers]
  );

  /**
   * Check if directly connected to a peer via P2P
   */
  const isPeerConnected = useCallback(
    (id: string): boolean => {
      return p2pManagerRef.current?.isConnected(id) ?? false;
    },
    []
  );

  /**
   * Initiate a P2P connection to a peer
   */
  const initiatePeerConnection = useCallback((id: string) => {
    const p2pManager = p2pManagerRef.current;
    if (!p2pManager) {
      console.error('[Realtime] P2P manager not initialized');
      return;
    }

    const connection = p2pManager.createPeerConnection(id, true);
    setState((prev) => {
      const newConnections = new Map(prev.peerConnections);
      newConnections.set(id, connection);
      return { ...prev, peerConnections: newConnections };
    });
  }, []);

  // Auto-connect on mount if authenticated
  useEffect(() => {
    if (autoConnect && authReady && publicId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, authReady, publicId, connect, disconnect]);

  // Update P2P manager when identity changes
  useEffect(() => {
    if (publicId && socketManagerRef.current?.isConnected()) {
      initP2PManager();
    }
  }, [publicId, initP2PManager]);

  return {
    ...state,
    connect,
    disconnect,
    authenticate,
    joinChannel,
    leaveChannel,
    joinDM,
    leaveDM,
    sendMessage,
    sendChannelMessage,
    startTyping,
    stopTyping,
    isUserOnline,
    getTypingUsers,
    isPeerConnected,
    initiatePeerConnection,
  };
}

export default useRealtime;
