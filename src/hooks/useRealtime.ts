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
import { useWallet } from '@solana/wallet-adapter-react';
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
  joinDM: (recipientWallet: string) => void;
  leaveDM: (recipientWallet: string) => void;
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
  startTyping: (channelId?: string, dmWallet?: string) => void;
  stopTyping: (channelId?: string, dmWallet?: string) => void;
  isUserOnline: (walletAddress: string) => boolean;
  getTypingUsers: (channelId?: string, dmWallet?: string) => TypingUser[];
  isPeerConnected: (walletAddress: string) => boolean;
  initiatePeerConnection: (walletAddress: string) => void;
}

/**
 * Custom hook for real-time messaging
 * Integrates P2P (WebRTC) and Socket.io for optimal delivery
 */
export function useRealtime(options: UseRealtimeOptions = {}): UseRealtimeReturn {
  const { onMessage, autoConnect = true, preferP2P = true } = options;
  const { publicKey, connected: walletConnected } = useWallet();

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
    if (!publicKey) return;

    const walletAddress = publicKey.toBase58();
    const manager = getP2PManager(walletAddress);

    manager.setOnMessage(handleP2PMessage);
    manager.setOnConnectionStateChange(handleP2PConnectionStateChange);
    manager.setOnSignal(handleP2PSignal);
    manager.setOnError((peerId, error) => {
      console.error(`[Realtime] P2P error with ${peerId}:`, error);
    });

    p2pManagerRef.current = manager;
  }, [publicKey, handleP2PMessage, handleP2PConnectionStateChange, handleP2PSignal]);

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
        p2pManager.handleSignal(data.fromWallet, signalData);
      }
    });

    manager.setOnSignalAnswer((data) => {
      const p2pManager = p2pManagerRef.current;
      if (p2pManager) {
        const signalData: SignalData = {
          type: 'answer',
          sdp: data.signal.sdp,
        };
        p2pManager.handleSignal(data.fromWallet, signalData);
      }
    });

    manager.setOnICECandidate((data) => {
      const p2pManager = p2pManagerRef.current;
      if (p2pManager) {
        const signalData: SignalData = {
          type: 'candidate',
          candidate: data.candidate,
        };
        p2pManager.handleSignal(data.fromWallet, signalData);
      }
    });

    // Online users
    manager.setOnUsersOnline((walletAddresses) => {
      setState((prev) => ({
        ...prev,
        onlineUsers: new Set(walletAddresses),
      }));
    });

    manager.setOnUserOnline((walletAddress) => {
      setState((prev) => {
        const newOnline = new Set(prev.onlineUsers);
        newOnline.add(walletAddress);
        return { ...prev, onlineUsers: newOnline };
      });
    });

    manager.setOnUserOffline((walletAddress) => {
      setState((prev) => {
        const newOnline = new Set(prev.onlineUsers);
        newOnline.delete(walletAddress);
        return { ...prev, onlineUsers: newOnline };
      });
    });

    // Typing indicators
    manager.setOnTypingUpdate((data) => {
      setState((prev) => {
        const newTyping = new Map(prev.typingUsers);
        const key = data.channelId || data.dmWallet || '';

        let users = newTyping.get(key) || [];

        if (data.isTyping) {
          // Add or update typing user
          const existingIndex = users.findIndex((u) => u.walletAddress === data.walletAddress);
          if (existingIndex >= 0) {
            users[existingIndex] = { walletAddress: data.walletAddress, startedAt: Date.now() };
          } else {
            users = [...users, { walletAddress: data.walletAddress, startedAt: Date.now() }];
          }
        } else {
          // Remove typing user
          users = users.filter((u) => u.walletAddress !== data.walletAddress);
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

    if (publicKey) {
      initP2PManager();
    }
  }, [initSocketManager, initP2PManager, publicKey]);

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
    if (!publicKey || !socketManagerRef.current) return;
    socketManagerRef.current.authenticate(publicKey.toBase58(), signature, message);
  }, [publicKey]);

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
  const joinDM = useCallback((recipientWallet: string) => {
    socketManagerRef.current?.joinDM(recipientWallet);
  }, []);

  /**
   * Leave a DM room
   */
  const leaveDM = useCallback((recipientWallet: string) => {
    socketManagerRef.current?.leaveDM(recipientWallet);
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

      if (!publicKey) {
        console.error('[Realtime] Cannot send message: wallet not connected');
        return false;
      }

      const walletAddress = publicKey.toBase58();
      const p2pManager = p2pManagerRef.current;
      const socketManager = socketManagerRef.current;

      // Try P2P first if preferred and connected
      if (shouldPreferP2P && p2pManager?.isConnected(recipientId)) {
        const message = createP2PMessage(
          'message',
          walletAddress,
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
    [publicKey]
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
  const startTyping = useCallback((channelId?: string, dmWallet?: string) => {
    socketManagerRef.current?.startTyping(channelId, dmWallet);
  }, []);

  /**
   * Stop typing indicator
   */
  const stopTyping = useCallback((channelId?: string, dmWallet?: string) => {
    socketManagerRef.current?.stopTyping(channelId, dmWallet);
  }, []);

  /**
   * Check if a user is online
   */
  const isUserOnline = useCallback(
    (walletAddress: string): boolean => {
      return state.onlineUsers.has(walletAddress);
    },
    [state.onlineUsers]
  );

  /**
   * Get typing users for a channel or DM
   */
  const getTypingUsers = useCallback(
    (channelId?: string, dmWallet?: string): TypingUser[] => {
      const key = channelId || dmWallet || '';
      return state.typingUsers.get(key) || [];
    },
    [state.typingUsers]
  );

  /**
   * Check if directly connected to a peer via P2P
   */
  const isPeerConnected = useCallback(
    (walletAddress: string): boolean => {
      return p2pManagerRef.current?.isConnected(walletAddress) ?? false;
    },
    []
  );

  /**
   * Initiate a P2P connection to a peer
   */
  const initiatePeerConnection = useCallback((walletAddress: string) => {
    const p2pManager = p2pManagerRef.current;
    if (!p2pManager) {
      console.error('[Realtime] P2P manager not initialized');
      return;
    }

    const connection = p2pManager.createPeerConnection(walletAddress, true);
    setState((prev) => {
      const newConnections = new Map(prev.peerConnections);
      newConnections.set(walletAddress, connection);
      return { ...prev, peerConnections: newConnections };
    });
  }, []);

  // Auto-connect on mount if wallet is connected
  useEffect(() => {
    if (autoConnect && walletConnected && publicKey) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, walletConnected, publicKey, connect, disconnect]);

  // Update P2P manager when wallet changes
  useEffect(() => {
    if (publicKey && socketManagerRef.current?.isConnected()) {
      initP2PManager();
    }
  }, [publicKey, initP2PManager]);

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
