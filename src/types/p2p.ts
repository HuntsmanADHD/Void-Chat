/**
 * P2P and Real-time messaging types for Void Chat
 */

export type PeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface P2PSignal {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidate;
}

export interface PeerConnection {
  peerId: string;
  state: PeerConnectionState;
  initiator: boolean;
  createdAt: number;
  connectedAt?: number;
  lastActivity?: number;
}

export interface P2PMessage {
  id: string;
  type: 'message' | 'typing' | 'read-receipt' | 'ping' | 'pong';
  senderId: string;
  recipientId: string;
  encrypted?: string;
  nonce?: string;
  timestamp: number;
  channelId?: string;
}

export interface ClientToServerEvents {
  authenticate: (data: { walletAddress: string; signature: string; message: string }) => void;
  'join:channel': (channelId: string) => void;
  'leave:channel': (channelId: string) => void;
  'join:dm': (recipientWallet: string) => void;
  'leave:dm': (recipientWallet: string) => void;
  'message:channel': (data: { channelId: string; encrypted: string; nonce: string; senderId: string }) => void;
  'message:dm': (data: { recipientWallet: string; encrypted: string; nonce: string; senderId: string }) => void;
  'signal:offer': (data: { targetWallet: string; signal: P2PSignal }) => void;
  'signal:answer': (data: { targetWallet: string; signal: P2PSignal }) => void;
  'signal:ice': (data: { targetWallet: string; candidate: RTCIceCandidate }) => void;
  'typing:start': (data: { channelId?: string; dmWallet?: string }) => void;
  'typing:stop': (data: { channelId?: string; dmWallet?: string }) => void;
  ping: () => void;
}

export interface ServerToClientEvents {
  authenticated: (data: { success: boolean; error?: string }) => void;
  'message:channel': (data: { id: string; channelId: string; encrypted: string; nonce: string; senderId: string; timestamp: number }) => void;
  'message:dm': (data: { id: string; encrypted: string; nonce: string; senderId: string; timestamp: number }) => void;
  'signal:offer': (data: { fromWallet: string; signal: P2PSignal }) => void;
  'signal:answer': (data: { fromWallet: string; signal: P2PSignal }) => void;
  'signal:ice': (data: { fromWallet: string; candidate: RTCIceCandidate }) => void;
  'user:online': (walletAddress: string) => void;
  'user:offline': (walletAddress: string) => void;
  'typing:update': (data: { channelId?: string; dmWallet?: string; walletAddress: string; isTyping: boolean }) => void;
  'users:online': (walletAddresses: string[]) => void;
  error: (data: { code: string; message: string }) => void;
  pong: () => void;
  'rate-limited': (data: { retryAfter: number }) => void;
}

export type SocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error';

export interface OnlineUser {
  walletAddress: string;
  connectedAt: number;
  lastSeen: number;
}

export interface TypingUser {
  walletAddress: string;
  startedAt: number;
}

export interface RealtimeMessage {
  id: string;
  content: string;
  senderId: string;
  timestamp: number;
  channelId?: string;
  dmRecipientId?: string;
  status: 'sending' | 'sent' | 'delivered' | 'failed';
  viaP2P: boolean;
}

export interface P2PConfig {
  iceServers: RTCIceServer[];
  reconnectAttempts: number;
  reconnectDelay: number;
  pingInterval: number;
  timeout: number;
}

export interface SocketConfig {
  url: string;
  reconnection: boolean;
  reconnectionAttempts: number;
  reconnectionDelay: number;
  timeout: number;
}

export interface RealtimeState {
  socketState: SocketConnectionState;
  onlineUsers: Set<string>;
  typingUsers: Map<string, TypingUser[]>;
  peerConnections: Map<string, PeerConnection>;
}

export interface SendMessageOptions {
  preferP2P: boolean;
  retryCount?: number;
}
