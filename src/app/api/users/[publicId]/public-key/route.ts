/**
 * GET /api/users/[publicId]/public-key
 * Get user's TweetNaCl public key for E2E encryption
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isValidPublicId,
  checkRateLimit,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { publicId } = await params;

    if (!isValidPublicId(publicId)) {
      return createErrorResponse('Invalid public ID format', 400);
    }

    const rateLimit = checkRateLimit(publicId);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    const user = await prisma.user.findUnique({
      where: { publicId },
      select: {
        publicId: true,
        publicKey: true,
        isBlacklisted: true,
      },
    });

    if (!user) {
      return createErrorResponse('User not found', 404);
    }

    if (user.isBlacklisted) {
      return createErrorResponse('This user has been banned', 403);
    }

    return createSuccessResponse({
      publicId: user.publicId,
      publicKey: user.publicKey,
    });
  } catch (error) {
    console.error('[API] GET /users/[publicId]/public-key error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
