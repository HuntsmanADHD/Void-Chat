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

export interface FileTransferOffer {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  encryptedNonce: string; // nonce used for file encryption
  keyNonce: string; // nonce used for encrypting the file key with nacl.box
}

export interface FileChunk {
  fileId: string;
  chunkIndex: number;
  data: string; // base64 encoded chunk
}

export interface FileTransferState {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  direction: 'sending' | 'receiving';
  progress: number; // 0-100
  status: 'pending' | 'transferring' | 'complete' | 'failed' | 'rejected';
  peerId: string;
  chunksReceived?: number;
  totalChunks?: number;
}

export interface P2PMessage {
  id: string;
  type: 'message' | 'typing' | 'read-receipt' | 'ping' | 'pong' | 'file-offer' | 'file-accept' | 'file-chunk' | 'file-complete' | 'file-reject';
  senderId: string;
  recipientId: string;
  encrypted?: string;
  nonce?: string;
  timestamp: number;
  channelId?: string;
  fileOffer?: FileTransferOffer;
  fileChunk?: FileChunk;
  /**
   * Ed25519 signature (base64) over the canonical message content.
   * Prevents senderId spoofing on the P2P data channel.
   * The signature covers: id + type + senderId + recipientId + timestamp + encrypted + nonce + channelId
   */
  signature?: string;
}

export interface ClientToServerEvents {
  authenticate: (data: { publicId: string; signature: string; message: string }) => void;
  'join:channel': (channelId: string) => void;
  'leave:channel': (channelId: string) => void;
  'join:dm': (recipientPublicId: string) => void;
  'leave:dm': (recipientPublicId: string) => void;
  'message:channel': (data: { channelId: string; encrypted: string; nonce: string; senderId: string }) => void;
  'message:dm': (data: { recipientPublicId: string; encrypted: string; nonce: string; senderId: string }) => void;
  'signal:offer': (data: { targetPublicId: string; signal: P2PSignal }) => void;
  'signal:answer': (data: { targetPublicId: string; signal: P2PSignal }) => void;
  'signal:ice': (data: { targetPublicId: string; candidate: RTCIceCandidate }) => void;
  'typing:start': (data: { channelId?: string; dmPublicId?: string }) => void;
  'typing:stop': (data: { channelId?: string; dmPublicId?: string }) => void;
  ping: () => void;
}

export interface ServerToClientEvents {
  authenticated: (data: { success: boolean; error?: string }) => void;
  'message:channel': (data: { id: string; channelId: string; encrypted: string; nonce: string; senderId: string; timestamp: number }) => void;
  'message:dm': (data: { id: string; encrypted: string; nonce: string; senderId: string; timestamp: number }) => void;
  'signal:offer': (data: { fromPublicId: string; signal: P2PSignal }) => void;
  'signal:answer': (data: { fromPublicId: string; signal: P2PSignal }) => void;
  'signal:ice': (data: { fromPublicId: string; candidate: RTCIceCandidate }) => void;
  'user:online': (publicId: string) => void;
  'user:offline': (publicId: string) => void;
  'typing:update': (data: { channelId?: string; dmPublicId?: string; publicId: string; isTyping: boolean }) => void;
  'users:online': (publicIds: string[]) => void;
  error: (data: { code: string; message: string }) => void;
  pong: () => void;
  'rate-limited': (data: { retryAfter: number }) => void;
}

export type SocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error';

export interface OnlineUser {
  publicId: string;
  connectedAt: number;
  lastSeen: number;
}

export interface TypingUser {
  publicId: string;
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
