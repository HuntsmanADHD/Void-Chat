/**
 * /api/users/[wallet]
 * User profile operations
 *
 * GET: Get public user profile
 * PUT: Update user profile (authenticated, own profile only)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isValidSolanaAddress,
  isValidXHandle,
  checkRateLimit,
  createErrorResponse,
  createSuccessResponse,
  sanitizeInput,
  OPTIONS,
} from '@/lib/auth';
import { isValidPublicKey } from '@/lib/encryption';
import type { UserProfileResponse, UpdateUserProfileRequest } from '@/types/api';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ wallet: string }>;
}

/**
 * GET /api/users/[wallet]
 * Get public user profile
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
    });

    if (!user) {
      return createErrorResponse('User not found', 404);
    }

    // Build response (public info only - no sensitive data)
    const response: UserProfileResponse = {
      walletAddress: user.walletAddress,
      xHandle: user.xHandle,
      publicKey: user.publicKey,
      createdAt: user.createdAt.toISOString(),
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /users/[wallet] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * PUT /api/users/[wallet]
 * Update user profile (authenticated, own profile only)
 */
export async function PUT(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { wallet: walletAddress } = await params;

    // Validate wallet address
    if (!isValidSolanaAddress(walletAddress)) {
      return createErrorResponse('Invalid wallet address format', 400);
    }

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    // Verify user is updating their own profile
    if (authResult.user.walletAddress !== walletAddress) {
      return createErrorResponse('Cannot update another user\'s profile', 403);
    }

    // Parse request body
    const body = await req.json() as UpdateUserProfileRequest;
    const { xHandle, publicKey } = body;

    // Validate updates
    const updates: { xHandle?: string | null; publicKey?: string } = {};

    if (xHandle !== undefined) {
      if (xHandle === null || xHandle === '') {
        // Allow clearing the X handle
        updates.xHandle = null;
      } else {
        // Validate X handle format
        const sanitizedHandle = sanitizeInput(xHandle);
        if (!isValidXHandle(sanitizedHandle)) {
          return createErrorResponse(
            'Invalid X handle format. Must be 4-15 characters, alphanumeric and underscores only.',
            400
          );
        }

        // Check if X handle is already taken
        const existingUser = await prisma.user.findFirst({
          where: {
            xHandle: sanitizedHandle,
            NOT: { walletAddress },
          },
        });

        if (existingUser) {
          return createErrorResponse('This X handle is already linked to another wallet', 409);
        }

        updates.xHandle = sanitizedHandle;
      }
    }

    if (publicKey !== undefined) {
      if (!isValidPublicKey(publicKey)) {
        return createErrorResponse('Invalid encryption public key format', 400);
      }
      updates.publicKey = publicKey;
    }

    // Check if there are any updates
    if (Object.keys(updates).length === 0) {
      return createErrorResponse('No valid fields to update', 400);
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { walletAddress },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });

    // Build response (public info only - no sensitive data)
    const response: UserProfileResponse = {
      walletAddress: updatedUser.walletAddress,
      xHandle: updatedUser.xHandle,
      publicKey: updatedUser.publicKey,
      createdAt: updatedUser.createdAt.toISOString(),
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] PUT /users/[wallet] error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
