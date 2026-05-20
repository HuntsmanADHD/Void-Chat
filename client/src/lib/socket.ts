/**
 * Socket.io Client for Void Chat
 * Handles real-time communication, signaling for WebRTC, and message relay
 *
 * Features:
 * - Connect/disconnect with authentication
 * - Join/leave channels and DM rooms
 * - Send encrypted messages (never decrypted on server)
 * - P2P signal relay for WebRTC
 * - Online/offline presence
 * - Typing indicators
 * - Connection status management
 */

import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketConnectionState,
  SocketConfig,
  P2PSignal,
} from '@/types/p2p';

/**
 * Default socket configuration
 */
const DEFAULT_CONFIG: SocketConfig = {
  url: import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001',
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000,
};

/**
 * Callback types for socket events
 */
export type OnChannelMessageCallback = (data: {
  id: string;
  channelId: string;
  encrypted: string;
  nonce: string;
  senderId: string;
  timestamp: number;
}) => void;

export type OnDMMessageCallback = (data: {
  id: string;
  encrypted: string;
  nonce: string;
  senderId: string;
  timestamp: number;
}) => void;

export type OnSignalCallback = (data: {
  fromPublicId: string;
  signal: P2PSignal;
}) => void;

export type OnICECandidateCallback = (data: {
  fromPublicId: string;
  candidate: RTCIceCandidate;
}) => void;

export type OnUserStatusCallback = (publicId: string) => void;
export type OnUsersOnlineCallback = (publicIds: string[]) => void;

export type OnTypingCallback = (data: {
  channelId?: string;
  dmPublicId?: string;
  publicId: string;
  isTyping: boolean;
}) => void;

export type OnConnectionStateChange = (state: SocketConnectionState) => void;
export type OnErrorCallback = (error: { code: string; message: string }) => void;
export type OnRateLimitedCallback = (retryAfter: number) => void;

/**
 * Socket.io Client Manager Class
 * Manages the socket connection and all real-time communication
 */
export class SocketManager {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private config: SocketConfig;
  private connectionState: SocketConnectionState = 'disconnected';
  private localPublicId: string | null = null;
  private joinedChannels: Set<string> = new Set();
  private joinedDMs: Set<string> = new Set();
  private typingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Callbacks
  private onChannelMessage: OnChannelMessageCallback | null = null;
  private onDMMessage: OnDMMessageCallback | null = null;
  private onSignalOffer: OnSignalCallback | null = null;
  private onSignalAnswer: OnSignalCallback | null = null;
  private onICECandidate: OnICECandidateCallback | null = null;
  private onUserOnline: OnUserStatusCallback | null = null;
  private onUserOffline: OnUserStatusCallback | null = null;
  private onUsersOnline: OnUsersOnlineCallback | null = null;
  private onTypingUpdate: OnTypingCallback | null = null;
  private onConnectionStateChange: OnConnectionStateChange | null = null;
  private onError: OnErrorCallback | null = null;
  private onRateLimited: OnRateLimitedCallback | null = null;

  constructor(config: Partial<SocketConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Connect to the Socket.io server
   */
  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    this.updateConnectionState('connecting');

    this.socket = io(this.config.url, {
      reconnection: this.config.reconnection,
      reconnectionAttempts: this.config.reconnectionAttempts,
      reconnectionDelay: this.config.reconnectionDelay,
      timeout: this.config.timeout,
      transports: ['websocket', 'polling'],
    });

    this.setupSocketEvents();
  }

  /**
   * Set up all socket event handlers
   */
  private setupSocketEvents(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      this.updateConnectionState('connected');
      this.startHeartbeat();

      // Rejoin rooms on reconnect
      this.rejoinRooms();
    });

    this.socket.on('disconnect', () => {
      this.stopHeartbeat();
      this.updateConnectionState('disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error);
      this.updateConnectionState('error');
    });

    // Authentication response
    this.socket.on('authenticated', (data) => {
      if (data.success) {
        this.updateConnectionState('authenticated');
      } else {
        console.error('[Socket] Authentication failed:', data.error);
        this.updateConnectionState('error');
        if (this.onError) {
          this.onError({ code: 'AUTH_FAILED', message: data.error || 'Authentication failed' });
        }
      }
    });

    // Message events
    this.socket.on('message:channel', (data) => {
      if (this.onChannelMessage) {
        this.onChannelMessage(data);
      }
    });

    this.socket.on('message:dm', (data) => {
      if (this.onDMMessage) {
        this.onDMMessage(data);
      }
    });

    // P2P signaling events
    this.socket.on('signal:offer', (data) => {
      if (this.onSignalOffer) {
        this.onSignalOffer(data);
      }
    });

    this.socket.on('signal:answer', (data) => {
      if (this.onSignalAnswer) {
        this.onSignalAnswer(data);
      }
    });

    this.socket.on('signal:ice', (data) => {
      if (this.onICECandidate) {
        this.onICECandidate(data);
      }
    });

    // Presence events
    this.socket.on('user:online', (publicId) => {
      if (this.onUserOnline) {
        this.onUserOnline(publicId);
      }
    });

    this.socket.on('user:offline', (publicId) => {
      if (this.onUserOffline) {
        this.onUserOffline(publicId);
      }
    });

    this.socket.on('users:online', (publicIds) => {
      if (this.onUsersOnline) {
        this.onUsersOnline(publicIds);
      }
    });

    // Typing events
    this.socket.on('typing:update', (data) => {
      if (this.onTypingUpdate) {
        this.onTypingUpdate(data);
      }
    });

    // Error events
    this.socket.on('error', (data) => {
      console.error('[Socket] Server error:', data);
      if (this.onError) {
        this.onError(data);
      }
    });

    // Rate limiting
    this.socket.on('rate-limited', (data) => {
      console.warn(`[Socket] Rate limited, retry after ${data.retryAfter}ms`);
      if (this.onRateLimited) {
        this.onRateLimited(data.retryAfter);
      }
    });

    // Heartbeat response
    this.socket.on('pong', () => {
      // Heartbeat acknowledged
    });
  }

  /**
   * Authenticate with the server using wallet signature
   */
  authenticate(publicId: string, signature: string, message: string): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot authenticate: not connected');
      return;
    }

    this.localPublicId = publicId;
    this.socket.emit('authenticate', { publicId, signature, message });
  }

  /**
   * Join a channel room
   */
  joinChannel(channelId: string): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot join channel: not connected');
      return;
    }

    this.socket.emit('join:channel', channelId);
    this.joinedChannels.add(channelId);
  }

  /**
   * Leave a channel room
   */
  leaveChannel(channelId: string): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot leave channel: not connected');
      return;
    }

    this.socket.emit('leave:channel', channelId);
    this.joinedChannels.delete(channelId);
  }

  /**
   * Join a DM room with a specific user
   */
  joinDM(recipientPublicId: string): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot join DM: not connected');
      return;
    }

    this.socket.emit('join:dm', recipientPublicId);
    this.joinedDMs.add(recipientPublicId);
  }

  /**
   * Leave a DM room
   */
  leaveDM(recipientPublicId: string): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot leave DM: not connected');
      return;
    }

    this.socket.emit('leave:dm', recipientPublicId);
    this.joinedDMs.delete(recipientPublicId);
  }

  /**
   * Send an encrypted message to a channel
   */
  sendChannelMessage(channelId: string, encrypted: string, nonce: string): void {
    if (!this.socket?.connected || !this.localPublicId) {
      console.error('[Socket] Cannot send message: not connected or not authenticated');
      return;
    }

    this.socket.emit('message:channel', {
      channelId,
      encrypted,
      nonce,
      senderId: this.localPublicId,
    });
  }

  /**
   * Send an encrypted DM message
   */
  sendDMMessage(recipientPublicId: string, encrypted: string, nonce: string): void {
    if (!this.socket?.connected || !this.localPublicId) {
      console.error('[Socket] Cannot send DM: not connected or not authenticated');
      return;
    }

    this.socket.emit('message:dm', {
      recipientPublicId,
      encrypted,
      nonce,
      senderId: this.localPublicId,
    });
  }

  /**
   * Send a P2P signal offer
   */
  sendSignalOffer(targetPublicId: string, signal: P2PSignal): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot send signal: not connected');
      return;
    }

    this.socket.emit('signal:offer', { targetPublicId, signal });
  }

  /**
   * Send a P2P signal answer
   */
  sendSignalAnswer(targetPublicId: string, signal: P2PSignal): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot send signal: not connected');
      return;
    }

    this.socket.emit('signal:answer', { targetPublicId, signal });
  }

  /**
   * Send an ICE candidate
   */
  sendICECandidate(targetPublicId: string, candidate: RTCIceCandidate): void {
    if (!this.socket?.connected) {
      console.error('[Socket] Cannot send ICE candidate: not connected');
      return;
    }

    this.socket.emit('signal:ice', { targetPublicId, candidate });
  }

  /**
   * Start typing indicator
   */
  startTyping(channelId?: string, dmPublicId?: string): void {
    if (!this.socket?.connected) return;

    const key = channelId || dmPublicId || '';

    // Clear existing timeout
    const existingTimeout = this.typingTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    this.socket.emit('typing:start', { channelId, dmPublicId });

    // Auto-stop typing after 5 seconds
    const timeout = setTimeout(() => {
      this.stopTyping(channelId, dmPublicId);
    }, 5000);

    this.typingTimeouts.set(key, timeout);
  }

  /**
   * Stop typing indicator
   */
  stopTyping(channelId?: string, dmPublicId?: string): void {
    if (!this.socket?.connected) return;

    const key = channelId || dmPublicId || '';

    // Clear timeout
    const existingTimeout = this.typingTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.typingTimeouts.delete(key);
    }

    this.socket.emit('typing:stop', { channelId, dmPublicId });
  }

  /**
   * Rejoin rooms after reconnection
   */
  private rejoinRooms(): void {
    this.joinedChannels.forEach((channelId) => {
      this.socket?.emit('join:channel', channelId);
    });

    this.joinedDMs.forEach((publicId) => {
      this.socket?.emit('join:dm', publicId);
    });
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping');
      }
    }, 30000);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Update connection state and notify callback
   */
  private updateConnectionState(state: SocketConnectionState): void {
    this.connectionState = state;
    if (this.onConnectionStateChange) {
      this.onConnectionStateChange(state);
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): SocketConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.connectionState === 'authenticated';
  }

  // Callback setters
  setOnChannelMessage(callback: OnChannelMessageCallback): void {
    this.onChannelMessage = callback;
  }

  setOnDMMessage(callback: OnDMMessageCallback): void {
    this.onDMMessage = callback;
  }

  setOnSignalOffer(callback: OnSignalCallback): void {
    this.onSignalOffer = callback;
  }

  setOnSignalAnswer(callback: OnSignalCallback): void {
    this.onSignalAnswer = callback;
  }

  setOnICECandidate(callback: OnICECandidateCallback): void {
    this.onICECandidate = callback;
  }

  setOnUserOnline(callback: OnUserStatusCallback): void {
    this.onUserOnline = callback;
  }

  setOnUserOffline(callback: OnUserStatusCallback): void {
    this.onUserOffline = callback;
  }

  setOnUsersOnline(callback: OnUsersOnlineCallback): void {
    this.onUsersOnline = callback;
  }

  setOnTypingUpdate(callback: OnTypingCallback): void {
    this.onTypingUpdate = callback;
  }

  setOnConnectionStateChange(callback: OnConnectionStateChange): void {
    this.onConnectionStateChange = callback;
  }

  setOnError(callback: OnErrorCallback): void {
    this.onError = callback;
  }

  setOnRateLimited(callback: OnRateLimitedCallback): void {
    this.onRateLimited = callback;
  }

  /**
   * Generic emit for custom events not covered by typed events
   * Used for extensibility (e.g., DKG share distribution)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, data?: any): void {
    if (!this.socket?.connected) {
      console.error(`[Socket] Cannot emit '${event}': not connected`);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.socket as any).emit(event, data);
  }

  /**
   * Generic listener for custom events not covered by typed events
   * Returns an unsubscribe function for cleanup.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, callback: (...args: any[]) => void): () => void {
    if (!this.socket) {
      console.error(`[Socket] Cannot listen for '${event}': no socket`);
      return () => {};
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.socket as any).on(event, callback);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.socket as any)?.off(event, callback);
    };
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.stopHeartbeat();

    // Clear all typing timeouts
    this.typingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.typingTimeouts.clear();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.joinedChannels.clear();
    this.joinedDMs.clear();
    this.localPublicId = null;
    this.updateConnectionState('disconnected');
  }

  /**
   * Destroy the socket manager and clean up all resources
   */
  destroy(): void {
    this.disconnect();

    // Clear all callbacks to prevent memory leaks
    this.onChannelMessage = null;
    this.onDMMessage = null;
    this.onSignalOffer = null;
    this.onSignalAnswer = null;
    this.onICECandidate = null;
    this.onUserOnline = null;
    this.onUserOffline = null;
    this.onUsersOnline = null;
    this.onTypingUpdate = null;
    this.onConnectionStateChange = null;
    this.onError = null;
    this.onRateLimited = null;

    // Clear all typing timeouts to prevent memory leaks
    this.typingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.typingTimeouts.clear();

    // Clear room tracking
    this.joinedChannels.clear();
    this.joinedDMs.clear();

    // Reset state
    this.localPublicId = null;
    this.connectionState = 'disconnected';
  }
}

// Singleton instance
let socketManagerInstance: SocketManager | null = null;

/**
 * Get or create the socket manager singleton
 */
export function getSocketManager(config?: Partial<SocketConfig>): SocketManager {
  if (!socketManagerInstance) {
    socketManagerInstance = new SocketManager(config);
  }
  return socketManagerInstance;
}

/**
 * Destroy the socket manager singleton
 */
export function destroySocketManager(): void {
  if (socketManagerInstance) {
    socketManagerInstance.destroy();
    socketManagerInstance = null;
  }
}

/**
 * Connect the socket manager and return the instance
 */
export function connectSocket(config?: Partial<SocketConfig>): SocketManager {
  const manager = getSocketManager(config);
  manager.connect();
  return manager;
}
