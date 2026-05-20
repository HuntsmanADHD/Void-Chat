/**
 * /api/users/[publicId]
 * User profile operations
 *
 * GET: Get public user profile
 * PUT: Update user profile (authenticated, own profile only)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isValidPublicId,
  checkRateLimit,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
// isValidPublicKey import removed — publicKey updates are no longer allowed via this endpoint

export { OPTIONS };

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

/**
 * GET /api/users/[publicId]
 * Get public user profile
 */
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
    });

    if (!user) {
      return createErrorResponse('User not found', 404);
    }

    return createSuccessResponse({
      publicId: user.publicId,
      publicKey: user.publicKey,
      artHash: user.artHash,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] GET /users/[publicId] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * PUT /api/users/[publicId]
 * Update user profile (authenticated, own profile only)
 */
export async function PUT(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { publicId } = await params;

    if (!isValidPublicId(publicId)) {
      return createErrorResponse('Invalid public ID format', 400);
    }

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    if (authResult.user.publicId !== publicId) {
      return createErrorResponse('Cannot update another user\'s profile', 403);
    }

    const body = await req.json();
    const { artHash } = body;

    // NOTE: publicKey updates are NOT allowed here to prevent account takeover.
    // Key rotation must go through a separate, specially-secured endpoint
    // that requires proof of ownership of both the old and new keys.
    if (body.publicKey !== undefined) {
      return createErrorResponse('Public key cannot be updated through this endpoint', 403);
    }

    const updates: { artHash?: string } = {};

    if (artHash !== undefined) {
      if (typeof artHash !== 'string' || !/^[a-f0-9]{64}$/i.test(artHash)) {
        return createErrorResponse('Invalid art hash format. Expected SHA-256 hex string.', 400);
      }
      updates.artHash = artHash;
    }

    if (Object.keys(updates).length === 0) {
      return createErrorResponse('No valid fields to update', 400);
    }

    const updatedUser = await prisma.user.update({
      where: { publicId },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });

    return createSuccessResponse({
      publicId: updatedUser.publicId,
      publicKey: updatedUser.publicKey,
      artHash: updatedUser.artHash,
      createdAt: updatedUser.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] PUT /users/[publicId] error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
