/**
 * Central exports for lib utilities
 */

// Prisma client
export { prisma } from './prisma';

// Authentication utilities (API routes)
export {
  generateAuthToken,
  verifyAuthToken,
  authenticateRequest,
  isCommunityMember,
  checkRateLimit,
  checkBlacklistStatus,
  isValidPublicId,
  isValidBase64,
  sanitizeInput,
  validatePagination,
  createErrorResponse,
  createSuccessResponse,
  verifySignature,
  validateAuthMessage,
} from './auth';

export type {
  AuthenticatedUser,
  AuthResult,
  TokenPayload,
} from './auth';

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
  encryptSecretKey,
  decryptSecretKey,
  encryptForKeyExchange,
  decryptFromKeyExchange,
  isValidPublicKey,
  isValidSecretKey,
  keyPairFromSeed,
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
  prepareChannelKeyForMember,
  acceptChannelKey,
  clearAllKeys,
} from './keyStore';

// Moderation utilities
export {
  fileReport,
  isUserBanned,
  isPublicIdBanned,
  getKickCount,
  isKickedFromCommunity,
} from './moderation';

export type {
  ModerationResult,
  ReportResult,
} from './moderation';

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
