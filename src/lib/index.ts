/**
 * Central exports for lib utilities.
 *
 * Ephemeral identity model: most legacy auth/moderation/keystore/p2p
 * utilities have been removed. Add exports back here only when a downstream
 * file actually imports them via the barrel.
 */

export { prisma } from './prisma';

export {
  checkRateLimit,
  getClientIp,
  sanitizeInput,
  validatePagination,
  getCORSHeaders,
  CORS_HEADERS,
  createCORSResponse,
  OPTIONS,
  createErrorResponse,
  createSuccessResponse,
} from './auth';

export { formatPublicId, truncatePublicId } from './format';
