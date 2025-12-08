/**
 * P2P Connection Management for Clawed Messenger
 * Uses simple-peer for WebRTC connections with automatic reconnection
 *
 * Features:
 * - Create and manage peer connections
 * - Signal exchange via Socket.io
 * - Direct P2P message sending
 * - Connection state management
 * - Automatic reconnection on disconnect
 */

import Peer, { Instance as PeerInstance, SignalData } from 'simple-peer';
import type {
  PeerConnectionState,
  P2PMessage,
  P2PConfig,
  PeerConnection,
} from '@/types/p2p';

/**
 * Default ICE servers configuration
 * Uses public STUN servers for NAT traversal
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

/**
 * Default P2P configuration
 */
const DEFAULT_CONFIG: P2PConfig = {
  iceServers: DEFAULT_ICE_SERVERS,
  reconnectAttempts: 3,
  reconnectDelay: 2000,
  pingInterval: 30000,
  timeout: 15000,
};

/**
 * Callback types for P2P events
 */
export type OnMessageCallback = (message: P2PMessage) => void;
export type OnConnectionStateChange = (peerId: string, state: PeerConnectionState) => void;
export type OnSignalCallback = (peerId: string, signal: SignalData) => void;
export type OnErrorCallback = (peerId: string, error: Error) => void;

/**
 * Internal peer data structure
 */
interface PeerData {
  peer: PeerInstance;
  connection: PeerConnection;
  reconnectAttempts: number;
  pingInterval?: ReturnType<typeof setInterval>;
}

/**
 * P2P Connection Manager Class
 * Manages all WebRTC peer connections for the current user
 */
export class P2PManager {
  private peers: Map<string, PeerData> = new Map();
  private config: P2PConfig;
  private localWallet: string;
  private destroyed: boolean = false;
  private reconnectTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingConnections: Set<string> = new Set(); // Track peers being connected to prevent race conditions

  // Callbacks
  private onMessage: OnMessageCallback | null = null;
  private onConnectionStateChange: OnConnectionStateChange | null = null;
  private onSignal: OnSignalCallback | null = null;
  private onError: OnErrorCallback | null = null;

  constructor(localWallet: string, config: Partial<P2PConfig> = {}) {
    this.localWallet = localWallet;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callback for incoming messages
   */
  setOnMessage(callback: OnMessageCallback): void {
    this.onMessage = callback;
  }

  /**
   * Set callback for connection state changes
   */
  setOnConnectionStateChange(callback: OnConnectionStateChange): void {
    this.onConnectionStateChange = callback;
  }

  /**
   * Set callback for outgoing signals (to be sent via Socket.io)
   */
  setOnSignal(callback: OnSignalCallback): void {
    this.onSignal = callback;
  }

  /**
   * Set callback for errors
   */
  setOnError(callback: OnErrorCallback): void {
    this.onError = callback;
  }

  /**
   * Create a new peer connection
   * @param peerId - Wallet address of the remote peer
   * @param initiator - Whether this peer should initiate the connection
   * @returns The PeerConnection info
   */
  createPeerConnection(peerId: string, initiator: boolean = true): PeerConnection {
    // Clean up existing connection if any
    if (this.peers.has(peerId)) {
      this.destroyPeer(peerId);
    }

    const connection: PeerConnection = {
      peerId,
      state: 'new',
      initiator,
      createdAt: Date.now(),
    };

    try {
      const peer = new Peer({
        initiator,
        trickle: true,
        config: {
          iceServers: this.config.iceServers,
        },
      });

      const peerData: PeerData = {
        peer,
        connection,
        reconnectAttempts: 0,
      };

      this.setupPeerEvents(peerId, peerData);
      this.peers.set(peerId, peerData);

      this.updateConnectionState(peerId, 'connecting');

      return connection;
    } catch (error) {
      console.error(`[P2P] Failed to create peer connection for ${peerId}:`, error);
      connection.state = 'failed';
      return connection;
    }
  }

  /**
   * Set up event handlers for a peer
   */
  private setupPeerEvents(peerId: string, peerData: PeerData): void {
    const { peer } = peerData;

    // Signal handler - emits signals to be sent via Socket.io
    peer.on('signal', (signal: SignalData) => {
      if (this.onSignal) {
        this.onSignal(peerId, signal);
      }
    });

    // Connection established
    peer.on('connect', () => {
      peerData.connection.connectedAt = Date.now();
      peerData.reconnectAttempts = 0;
      this.updateConnectionState(peerId, 'connected');
      this.startPingInterval(peerId);
    });

    // Data received
    peer.on('data', (data: Uint8Array) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data)) as P2PMessage;
        peerData.connection.lastActivity = Date.now();

        // Handle ping/pong internally
        if (message.type === 'ping') {
          this.sendPong(peerId);
          return;
        }
        if (message.type === 'pong') {
          return;
        }

        if (this.onMessage) {
          this.onMessage(message);
        }
      } catch (error) {
        console.error(`[P2P] Failed to parse message from ${peerId}:`, error);
      }
    });

    // Error handler
    peer.on('error', (error: Error) => {
      console.error(`[P2P] Error with peer ${peerId}:`, error);
      if (this.onError) {
        this.onError(peerId, error);
      }
      this.updateConnectionState(peerId, 'failed');
      this.attemptReconnect(peerId);
    });

    // Close handler
    peer.on('close', () => {
      this.updateConnectionState(peerId, 'closed');
      this.attemptReconnect(peerId);
    });

    // ICE connection state changes
    peer.on('iceStateChange', (iceConnectionState: RTCIceConnectionState) => {
      if (iceConnectionState === 'disconnected') {
        this.updateConnectionState(peerId, 'disconnected');
      } else if (iceConnectionState === 'failed') {
        this.updateConnectionState(peerId, 'failed');
        this.attemptReconnect(peerId);
      }
    });
  }

  /**
   * Connect to a peer using received signal data
   * @param peerId - Wallet address of the remote peer
   * @param signal - Signal data received via Socket.io
   */
  connectToPeer(peerId: string, signal: SignalData): void {
    let peerData = this.peers.get(peerId);

    // If no existing connection, create one as non-initiator
    if (!peerData) {
      // Check if we're already in the process of connecting to prevent race conditions
      if (this.pendingConnections.has(peerId)) {
        // Queue the signal to be processed after connection is established
        setTimeout(() => this.connectToPeer(peerId, signal), 100);
        return;
      }

      this.pendingConnections.add(peerId);
      try {
        this.createPeerConnection(peerId, false);
        peerData = this.peers.get(peerId);
      } finally {
        this.pendingConnections.delete(peerId);
      }
    }

    if (!peerData) {
      console.error(`[P2P] Failed to create peer for ${peerId}`);
      return;
    }

    try {
      peerData.peer.signal(signal);
    } catch (error) {
      console.error(`[P2P] Failed to process signal for ${peerId}:`, error);
      this.updateConnectionState(peerId, 'failed');
    }
  }

  /**
   * Handle incoming signal data (alias for connectToPeer for clarity)
   */
  handleSignal(peerId: string, signal: SignalData): void {
    this.connectToPeer(peerId, signal);
  }

  /**
   * Send a message to a peer
   * @param peerId - Wallet address of the recipient
   * @param message - P2P message to send
   * @returns true if sent successfully, false otherwise
   */
  sendMessage(peerId: string, message: P2PMessage): boolean {
    const peerData = this.peers.get(peerId);

    if (!peerData) {
      console.error(`[P2P] No connection to peer: ${peerId}`);
      return false;
    }

    if (peerData.connection.state !== 'connected') {
      console.error(`[P2P] Peer ${peerId} is not connected (state: ${peerData.connection.state})`);
      return false;
    }

    try {
      const data = JSON.stringify(message);
      peerData.peer.send(data);
      peerData.connection.lastActivity = Date.now();
      return true;
    } catch (error) {
      console.error(`[P2P] Failed to send message to ${peerId}:`, error);
      return false;
    }
  }

  /**
   * Send a ping to keep the connection alive
   */
  private sendPing(peerId: string): void {
    const message: P2PMessage = {
      id: `ping-${Date.now()}`,
      type: 'ping',
      senderId: this.localWallet,
      recipientId: peerId,
      timestamp: Date.now(),
    };
    this.sendMessage(peerId, message);
  }

  /**
   * Send a pong in response to a ping
   */
  private sendPong(peerId: string): void {
    const message: P2PMessage = {
      id: `pong-${Date.now()}`,
      type: 'pong',
      senderId: this.localWallet,
      recipientId: peerId,
      timestamp: Date.now(),
    };
    this.sendMessage(peerId, message);
  }

  /**
   * Start ping interval for a peer
   */
  private startPingInterval(peerId: string): void {
    const peerData = this.peers.get(peerId);
    if (!peerData) return;

    // Clear existing interval
    if (peerData.pingInterval) {
      clearInterval(peerData.pingInterval);
    }

    peerData.pingInterval = setInterval(() => {
      if (peerData.connection.state === 'connected') {
        this.sendPing(peerId);
      }
    }, this.config.pingInterval);
  }

  /**
   * Stop ping interval for a peer
   */
  private stopPingInterval(peerId: string): void {
    const peerData = this.peers.get(peerId);
    if (peerData?.pingInterval) {
      clearInterval(peerData.pingInterval);
      peerData.pingInterval = undefined;
    }
  }

  /**
   * Update connection state and notify callback
   */
  private updateConnectionState(peerId: string, state: PeerConnectionState): void {
    const peerData = this.peers.get(peerId);
    if (peerData) {
      peerData.connection.state = state;
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(peerId, state);
      }
    }
  }

  /**
   * Attempt to reconnect to a peer
   */
  private attemptReconnect(peerId: string): void {
    if (this.destroyed) return;

    const peerData = this.peers.get(peerId);
    if (!peerData) return;

    // Stop ping interval during reconnection
    this.stopPingInterval(peerId);

    if (peerData.reconnectAttempts >= this.config.reconnectAttempts) {
      this.destroyPeer(peerId);
      return;
    }

    peerData.reconnectAttempts++;
    const delay = this.config.reconnectDelay * peerData.reconnectAttempts;


    // Clear any existing reconnect timeout for this peer
    const existingTimeout = this.reconnectTimeouts.get(peerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeoutId = setTimeout(() => {
      this.reconnectTimeouts.delete(peerId);
      if (this.destroyed) return;

      // Only reconnect if we were the initiator
      if (peerData.connection.initiator) {
        this.createPeerConnection(peerId, true);
      }
    }, delay);

    this.reconnectTimeouts.set(peerId, timeoutId);
  }

  /**
   * Get connection info for a peer
   */
  getConnection(peerId: string): PeerConnection | null {
    const peerData = this.peers.get(peerId);
    return peerData?.connection ?? null;
  }

  /**
   * Get all peer connections
   */
  getAllConnections(): Map<string, PeerConnection> {
    const connections = new Map<string, PeerConnection>();
    this.peers.forEach((peerData, peerId) => {
      connections.set(peerId, peerData.connection);
    });
    return connections;
  }

  /**
   * Check if connected to a peer
   */
  isConnected(peerId: string): boolean {
    const peerData = this.peers.get(peerId);
    return peerData?.connection.state === 'connected';
  }

  /**
   * Get list of connected peer IDs
   */
  getConnectedPeers(): string[] {
    const connected: string[] = [];
    this.peers.forEach((peerData, peerId) => {
      if (peerData.connection.state === 'connected') {
        connected.push(peerId);
      }
    });
    return connected;
  }

  /**
   * Destroy a specific peer connection
   */
  destroyPeer(peerId: string): void {
    const peerData = this.peers.get(peerId);
    if (!peerData) return;

    this.stopPingInterval(peerId);

    try {
      peerData.peer.destroy();
    } catch (error) {
      console.error(`[P2P] Error destroying peer ${peerId}:`, error);
    }

    this.peers.delete(peerId);
  }

  /**
   * Destroy all peer connections and clean up
   */
  destroy(): void {
    this.destroyed = true;

    // Clear all reconnect timeouts
    this.reconnectTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.reconnectTimeouts.clear();

    // Clear pending connections
    this.pendingConnections.clear();

    this.peers.forEach((_, peerId) => {
      this.destroyPeer(peerId);
    });

    this.peers.clear();
    this.onMessage = null;
    this.onConnectionStateChange = null;
    this.onSignal = null;
    this.onError = null;
  }
}

/**
 * Generate a unique message ID using cryptographically secure randomness
 */
export function generateMessageId(): string {
  // Use crypto.getRandomValues for secure random bytes
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const randomHex = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `msg-${Date.now()}-${randomHex}`;
}

/**
 * Create a P2P message object
 */
export function createP2PMessage(
  type: P2PMessage['type'],
  senderId: string,
  recipientId: string,
  encrypted?: string,
  nonce?: string,
  channelId?: string
): P2PMessage {
  return {
    id: generateMessageId(),
    type,
    senderId,
    recipientId,
    encrypted,
    nonce,
    timestamp: Date.now(),
    channelId,
  };
}

// Singleton instance for the P2P manager
let p2pManagerInstance: P2PManager | null = null;

/**
 * Get or create the P2P manager singleton
 */
export function getP2PManager(localWallet: string, config?: Partial<P2PConfig>): P2PManager {
  if (!p2pManagerInstance || p2pManagerInstance['localWallet'] !== localWallet) {
    // Destroy existing instance if wallet changed
    if (p2pManagerInstance) {
      p2pManagerInstance.destroy();
    }
    p2pManagerInstance = new P2PManager(localWallet, config);
  }
  return p2pManagerInstance;
}

/**
 * Destroy the P2P manager singleton
 */
export function destroyP2PManager(): void {
  if (p2pManagerInstance) {
    p2pManagerInstance.destroy();
    p2pManagerInstance = null;
  }
}
