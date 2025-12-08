/**
 * Central exports for lib utilities
 */

export { prisma } from './prisma';

export {
  generateAuthToken,
  verifyAuthToken,
  authenticateRequest,
  checkCommunityRole,
  isCommunityOwner,
  isCommunityAdmin,
  isCommunityMember,
  checkMinTokenBalance,
  checkRateLimit,
  checkBlacklistStatus,
  sanitizeInput,
  validatePagination,
  createErrorResponse,
  createSuccessResponse,
  MIN_TOKEN_FOR_COMMUNITY_CREATE,
} from './auth';

export type { AuthenticatedUser, AuthResult, TokenPayload } from './auth';

export {
  CLAWED_TOKEN_MINT,
  AUTH_MESSAGE_PREFIX,
  getConnection,
  getClawedTokenBalance,
  formatTokenBalance,
  verifyWalletSignature,
  generateAuthMessage,
  isAuthMessageValid,
  formatWalletAddress,
  isValidSolanaAddress,
  checkMinimumTokenHold,
  clearBalanceCache,
  clearAllBalanceCache,
} from './solana';

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

export {
  SocketManager,
  getSocketManager,
  destroySocketManager,
  connectSocket,
} from './socket';
