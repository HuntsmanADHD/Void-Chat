/**
 * GET /api/users/[wallet]/public-key
 * Get user's TweetNaCl public key for E2E encryption
 *
 * Response:
 * {
 *   walletAddress: string,
 *   publicKey: string
 * }
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isValidSolanaAddress,
  checkRateLimit,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import type { PublicKeyResponse } from '@/types/api';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ wallet: string }>;
}

/**
 * GET /api/users/[wallet]/public-key
 * Get user's encryption public key
 */
export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { wallet: walletAddress } = await params;

    // Validate wallet address
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

    // Fetch user from database
    const user = await prisma.user.findUnique({
      where: { walletAddress },
      select: {
        walletAddress: true,
        publicKey: true,
        isBlacklisted: true,
      },
    });

    if (!user) {
      return createErrorResponse('User not found', 404);
    }

    // Check if user is blacklisted
    if (user.isBlacklisted) {
      return createErrorResponse('This user has been banned', 403);
    }

    // Build response
    const response: PublicKeyResponse = {
      walletAddress: user.walletAddress,
      publicKey: user.publicKey,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /users/[wallet]/public-key error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
