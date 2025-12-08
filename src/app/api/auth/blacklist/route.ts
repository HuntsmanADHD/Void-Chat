/**
 * GET /api/auth/blacklist?wallet=ADDRESS
 * Check blacklist status for a wallet address
 *
 * Query params:
 * - wallet: Solana wallet address
 *
 * Response:
 * {
 *   isBlacklisted: boolean,
 *   strikes: number,
 *   timeoutUntil: string | null
 * }
 */

import { NextRequest } from 'next/server';
import {
  checkBlacklistStatus,
  isValidSolanaAddress,
  checkRateLimit,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

// Re-export OPTIONS for CORS preflight
export { OPTIONS };
import type { BlacklistStatusResponse } from '@/types/api';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    // Get wallet address from query params
    const { searchParams } = new URL(req.url);
    const walletAddress = searchParams.get('wallet');

    // Validate wallet parameter
    if (!walletAddress) {
      return createErrorResponse('Missing required query parameter: wallet', 400);
    }

    if (!isValidSolanaAddress(walletAddress)) {
      return createErrorResponse('Invalid wallet address format', 400);
    }

    // Check rate limit
    const rateLimit = checkRateLimit(walletAddress);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    // Check blacklist status
    const status = await checkBlacklistStatus(walletAddress);

    // Build response
    const response: BlacklistStatusResponse = {
      isBlacklisted: status.isBlacklisted,
      strikes: status.strikes,
      timeoutUntil: status.timeoutUntil?.toISOString() ?? null,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] /auth/blacklist error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
