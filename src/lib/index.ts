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
  checkCommunityRole,
  isCommunityOwner,
  isCommunityAdmin,
  isCommunityMember,
  checkMinTokenBalance,
  updateUserTokenBalance,
  checkRateLimit,
  checkBlacklistStatus,
  isValidSolanaAddress as isValidSolanaAddressAuth,
  isValidXHandle as isValidXHandleAuth,
  sanitizeInput,
  validatePagination,
  createErrorResponse,
  createSuccessResponse,
  MIN_TOKEN_FOR_COMMUNITY_CREATE,
} from './auth';

export type {
  AuthenticatedUser,
  AuthResult,
  TokenPayload,
} from './auth';

// Solana utilities
export {
  CLAWED_TOKEN_MINT,
  AUTH_MESSAGE_PREFIX,
  getConnection,
  getClawedTokenBalance,
  formatTokenBalance,
  verifyWalletSignature,
  generateAuthMessage,
  parseAuthMessageTimestamp,
  isAuthMessageValid,
  formatWalletAddress,
  isValidSolanaAddress,
  checkMinimumTokenHold,
  clearBalanceCache,
  clearAllBalanceCache,
} from './solana';

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

// X/Twitter OAuth utilities
export {
  xAuthOptions,
  isXAuthConfigured,
  validateXAuthConfig,
  sanitizeXHandle,
  formatXHandle,
  isValidXHandle,
  getXProfileUrl,
  getXAccountStatus,
  linkXAccountToWallet,
  unlinkXAccountFromWallet,
} from './x-auth';

export type {
  XProfile,
  XSession,
  XToken,
  XAccountStatus,
  LinkXAccountRequest,
  LinkXAccountResponse,
  UnlinkXAccountResponse,
} from './x-auth';

// Moderation utilities
export {
  issueStrike,
  checkUserStatus,
  isUserTimedOut,
  isUserBlacklisted,
  isWalletBlacklisted,
  getActiveStrikes,
  appealStrike,
  createReport,
  getPendingReports,
  dismissReport,
  issueWarning,
  canUserAct,
  getRemainingTimeout,
  formatTimeoutDuration,
  getStrikeSeverity,
} from './moderation';

export type {
  ModerationError,
  ModerationResult,
  UserModerationStatus,
  StrikeInfo,
  IssueStrikeResult,
  AppealResult,
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
