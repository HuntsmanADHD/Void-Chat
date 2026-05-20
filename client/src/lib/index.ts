/**
 * Central exports for client-side lib utilities
 * Server-only modules (prisma, auth, moderation) are NOT exported here.
 */

// Format utilities
export {
  formatPublicId,
} from './format';

// Encryption utilities
export {
  generateKeyPair,
  encryptMessage,
  decryptMessage,
  encryptChannelMessage,
  decryptChannelMessage,
  generateChannelKey,
  isValidPublicKey,
  isValidSecretKey,
} from './encryption';

// Key store utilities
export {
  initializeKeyStore,
  getCachedPublicKey,
  cachePublicKey,
  removeCachedPublicKey,
  clearPublicKeyCache,
  fetchPublicKey,
  getPublicKey,
  getPublicKeys,
  storeChannelKey,
  getChannelKey,
  removeChannelKey,
  clearChannelKeys,
  getStoredChannelIds,
  clearAllKeys,
} from './keyStore';

// P2P connection management
export {
  P2PManager,
  getP2PManager,
  destroyP2PManager,
  generateMessageId,
  createP2PMessage,
} from './p2p';

export type {
  OnMessageCallback,
  OnConnectionStateChange as P2POnConnectionStateChange,
  OnSignalCallback,
  OnErrorCallback as P2POnErrorCallback,
} from './p2p';

// Socket.io client
export {
  SocketManager,
  getSocketManager,
  destroySocketManager,
  connectSocket,
} from './socket';

export type {
  OnChannelMessageCallback,
  OnDMMessageCallback,
  OnSignalCallback as SocketOnSignalCallback,
  OnICECandidateCallback,
  OnUserStatusCallback,
  OnUsersOnlineCallback,
  OnTypingCallback,
  OnConnectionStateChange as SocketOnConnectionStateChange,
  OnErrorCallback as SocketOnErrorCallback,
  OnRateLimitedCallback,
} from './socket';
