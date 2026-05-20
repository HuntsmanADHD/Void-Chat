/**
 * GET /api/auth/blacklist?id=PUBLIC_ID
 * Check blacklist status for a user
 *
 * Query params:
 * - id: User's public ID
 *
 * Response:
 * {
 *   isBlacklisted: boolean
 * }
 */

import { NextRequest } from 'next/server';
import {
  checkBlacklistStatus,
  isValidPublicId,
  checkRateLimit,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const publicId = searchParams.get('id');

    if (!publicId) {
      return createErrorResponse('Missing required query parameter: id', 400);
    }

    if (!isValidPublicId(publicId)) {
      return createErrorResponse('Invalid public ID format', 400);
    }

    // Check rate limit
    const rateLimit = checkRateLimit(publicId);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    // Check blacklist status
    const status = await checkBlacklistStatus(publicId);

    return createSuccessResponse({
      isBlacklisted: status.isBlacklisted,
    });
  } catch (error) {
    console.error('[API] /auth/blacklist error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
