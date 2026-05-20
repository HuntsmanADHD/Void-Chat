/**
 * P2P Connection Hook for Void Chat
 * Manages WebRTC peer connections with signal exchange via Socket.io
 *
 * Features:
 * - Manage peer connections lifecycle
 * - Signal exchange via Socket.io
 * - Direct P2P message sending
 * - Connection status tracking per peer
 * - Automatic cleanup on unmount
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { SignalData } from 'simple-peer';
import {
  P2PManager,
  getP2PManager,
  destroyP2PManager,
  createP2PMessage,
  generateMessageId,
} from '@/lib/p2p';
import { getSocketManager, SocketManager } from '@/lib/socket';
import type {
  PeerConnection,
  PeerConnectionState,
  P2PMessage,
  P2PConfig,
  P2PSignal,
} from '@/types/p2p';

/**
 * P2P message callback
 */
export type OnP2PMessage = (message: P2PMessage) => void;

/**
 * P2P connection state change callback
 */
export type OnP2PStateChange = (peerId: string, state: PeerConnectionState) => void;

/**
 * P2P hook options
 */
interface UseP2POptions {
  onMessage?: OnP2PMessage;
  onStateChange?: OnP2PStateChange;
  config?: Partial<P2PConfig>;
  autoConnect?: boolean;
}

/**
 * P2P hook state
 */
interface UseP2PState {
  initialized: boolean;
  connections: Map<string, PeerConnection>;
  connectedPeers: string[];
}

/**
 * P2P hook return value
 */
interface UseP2PReturn extends UseP2PState {
  createConnection: (peerId: string, initiator?: boolean) => PeerConnection | null;
  destroyConnection: (peerId: string) => void;
  sendMessage: (peerId: string, encrypted: string, nonce: string, channelId?: string) => boolean;
  sendTyping: (peerId: string, isTyping: boolean, channelId?: string) => boolean;
  sendReadReceipt: (peerId: string, messageId: string) => boolean;
  isConnected: (peerId: string) => boolean;
  getConnection: (peerId: string) => PeerConnection | null;
  getConnectionState: (peerId: string) => PeerConnectionState | null;
  destroy: () => void;
}

/**
 * Custom hook for managing P2P WebRTC connections
 * Uses Socket.io for signaling (offer/answer exchange)
 */
export function useP2P(options: UseP2POptions = {}): UseP2PReturn {
  const { onMessage, onStateChange, config, autoConnect = true } = options;
  const { publicId, isAuthenticated } = useAuth();

  const [state, setState] = useState<UseP2PState>({
    initialized: false,
    connections: new Map(),
    connectedPeers: [],
  });

  const p2pManagerRef = useRef<P2PManager | null>(null);
  const socketManagerRef = useRef<SocketManager | null>(null);
  const onMessageRef = useRef(onMessage);
  const onStateChangeRef = useRef(onStateChange);

  // Keep callback refs updated
  useEffect(() => {
    onMessageRef.current = onMessage;
    onStateChangeRef.current = onStateChange;
  }, [onMessage, onStateChange]);

  /**
   * Handle incoming P2P messages
   */
  const handleMessage = useCallback((message: P2PMessage) => {
    if (onMessageRef.current) {
      onMessageRef.current(message);
    }
  }, []);

  /**
   * Handle P2P connection state changes
   */
  const handleStateChange = useCallback((peerId: string, peerState: PeerConnectionState) => {
    setState((prev) => {
      const newConnections = new Map(prev.connections);
      const existing = newConnections.get(peerId);

      if (existing) {
        newConnections.set(peerId, {
          ...existing,
          state: peerState,
          connectedAt: peerState === 'connected' ? Date.now() : existing.connectedAt,
        });
      }

      const connectedPeers: string[] = [];
      newConnections.forEach((conn, id) => {
        if (conn.state === 'connected') {
          connectedPeers.push(id);
        }
      });

      return { ...prev, connections: newConnections, connectedPeers };
    });

    if (onStateChangeRef.current) {
      onStateChangeRef.current(peerId, peerState);
    }
  }, []);

  /**
   * Handle outgoing P2P signals (send via Socket.io)
   */
  const handleSignal = useCallback((peerId: string, signal: SignalData) => {
    const socketManager = socketManagerRef.current;
    if (!socketManager?.isConnected()) {
      console.error('[P2P Hook] Cannot send signal: socket not connected');
      return;
    }

    // Type-safe signal data extraction
    const sdp = 'sdp' in signal && typeof signal.sdp === 'string' ? signal.sdp : undefined;
    const candidate = 'candidate' in signal ? signal.candidate as RTCIceCandidate | undefined : undefined;

    const p2pSignal: P2PSignal = {
      type: signal.type === 'offer' ? 'offer' : signal.type === 'answer' ? 'answer' : 'ice-candidate',
      sdp,
      candidate,
    };

    if (signal.type === 'offer') {
      socketManager.sendSignalOffer(peerId, p2pSignal);
    } else if (signal.type === 'answer') {
      socketManager.sendSignalAnswer(peerId, p2pSignal);
    } else if (candidate) {
      socketManager.sendICECandidate(peerId, candidate);
    }
  }, []);

  /**
   * Handle P2P errors
   */
  const handleError = useCallback((peerId: string, error: Error) => {
    console.error(`[P2P Hook] Error with peer ${peerId}:`, error.message);
  }, []);

  /**
   * Initialize P2P manager
   */
  const initialize = useCallback(() => {
    if (!publicId) return;

    const manager = getP2PManager(publicId, config);

    manager.setOnMessage(handleMessage);
    manager.setOnConnectionStateChange(handleStateChange);
    manager.setOnSignal(handleSignal);
    manager.setOnError(handleError);

    p2pManagerRef.current = manager;

    // Get socket manager for signaling
    socketManagerRef.current = getSocketManager();

    // Set up socket signal handlers
    const socketManager = socketManagerRef.current;

    socketManager.setOnSignalOffer((data) => {
      const signalData: SignalData = {
        type: 'offer',
        sdp: data.signal.sdp,
      };
      manager.handleSignal(data.fromPublicId, signalData);
    });

    socketManager.setOnSignalAnswer((data) => {
      const signalData: SignalData = {
        type: 'answer',
        sdp: data.signal.sdp,
      };
      manager.handleSignal(data.fromPublicId, signalData);
    });

    socketManager.setOnICECandidate((data) => {
      const signalData: SignalData = {
        type: 'candidate',
        candidate: data.candidate,
      };
      manager.handleSignal(data.fromPublicId, signalData);
    });

    setState((prev) => ({ ...prev, initialized: true }));
  }, [publicId, config, handleMessage, handleStateChange, handleSignal, handleError]);

  /**
   * Create a new peer connection
   */
  const createConnection = useCallback(
    (peerId: string, initiator: boolean = true): PeerConnection | null => {
      const manager = p2pManagerRef.current;
      if (!manager) {
        console.error('[P2P Hook] Manager not initialized');
        return null;
      }

      const connection = manager.createPeerConnection(peerId, initiator);

      setState((prev) => {
        const newConnections = new Map(prev.connections);
        newConnections.set(peerId, connection);
        return { ...prev, connections: newConnections };
      });

      return connection;
    },
    []
  );

  /**
   * Destroy a peer connection
   */
  const destroyConnection = useCallback((peerId: string) => {
    const manager = p2pManagerRef.current;
    if (!manager) return;

    manager.destroyPeer(peerId);

    setState((prev) => {
      const newConnections = new Map(prev.connections);
      newConnections.delete(peerId);

      const connectedPeers = prev.connectedPeers.filter((id) => id !== peerId);

      return { ...prev, connections: newConnections, connectedPeers };
    });
  }, []);

  /**
   * Send an encrypted message to a peer
   */
  const sendMessage = useCallback(
    (peerId: string, encrypted: string, nonce: string, channelId?: string): boolean => {
      const manager = p2pManagerRef.current;
      if (!manager || !publicId) return false;

      const message = createP2PMessage(
        'message',
        publicId,
        peerId,
        encrypted,
        nonce,
        channelId
      );

      return manager.sendMessage(peerId, message);
    },
    [publicId]
  );

  /**
   * Send typing indicator to a peer
   */
  const sendTyping = useCallback(
    (peerId: string, isTyping: boolean, channelId?: string): boolean => {
      const manager = p2pManagerRef.current;
      if (!manager || !publicId) return false;

      const message: P2PMessage = {
        id: generateMessageId(),
        type: 'typing',
        senderId: publicId,
        recipientId: peerId,
        timestamp: Date.now(),
        channelId,
      };

      return manager.sendMessage(peerId, message);
    },
    [publicId]
  );

  /**
   * Send read receipt to a peer
   */
  const sendReadReceipt = useCallback(
    (peerId: string, messageId: string): boolean => {
      const manager = p2pManagerRef.current;
      if (!manager || !publicId) return false;

      const message: P2PMessage = {
        id: generateMessageId(),
        type: 'read-receipt',
        senderId: publicId,
        recipientId: peerId,
        timestamp: Date.now(),
        // Store the message ID being acknowledged in the encrypted field
        encrypted: messageId,
      };

      return manager.sendMessage(peerId, message);
    },
    [publicId]
  );

  /**
   * Check if connected to a peer
   */
  const isConnected = useCallback(
    (peerId: string): boolean => {
      return p2pManagerRef.current?.isConnected(peerId) ?? false;
    },
    []
  );

  /**
   * Get connection info for a peer
   */
  const getConnection = useCallback(
    (peerId: string): PeerConnection | null => {
      return state.connections.get(peerId) ?? null;
    },
    [state.connections]
  );

  /**
   * Get connection state for a peer
   */
  const getConnectionState = useCallback(
    (peerId: string): PeerConnectionState | null => {
      const connection = state.connections.get(peerId);
      return connection?.state ?? null;
    },
    [state.connections]
  );

  /**
   * Destroy P2P manager and clean up
   */
  const destroy = useCallback(() => {
    if (p2pManagerRef.current) {
      p2pManagerRef.current.destroy();
      p2pManagerRef.current = null;
    }

    destroyP2PManager();

    setState({
      initialized: false,
      connections: new Map(),
      connectedPeers: [],
    });
  }, []);

  // Initialize on mount when authenticated
  useEffect(() => {
    if (autoConnect && isAuthenticated && publicId) {
      initialize();
    }

    return () => {
      destroy();
    };
  }, [autoConnect, isAuthenticated, publicId, initialize, destroy]);

  // Sync connections from manager
  useEffect(() => {
    const manager = p2pManagerRef.current;
    if (!manager) return;

    const connections = manager.getAllConnections();
    const connectedPeers = manager.getConnectedPeers();

    setState((prev) => ({
      ...prev,
      connections,
      connectedPeers,
    }));
  }, [state.initialized]);

  return {
    ...state,
    createConnection,
    destroyConnection,
    sendMessage,
    sendTyping,
    sendReadReceipt,
    isConnected,
    getConnection,
    getConnectionState,
    destroy,
  };
}

export default useP2P;
