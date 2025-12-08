/**
 * /api/communities/[id]
 * Single community operations
 *
 * GET: Get community details
 * PUT: Update community (owner only)
 * DELETE: Delete community (owner only)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isCommunityOwner,
  isCommunityMember,
  checkMinTokenBalance,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import type { CommunityResponse, UpdateCommunityRequest } from '@/types/api';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/communities/[id]
 * Get community details
 */
export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    // Fetch community with owner info and member count
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      include: {
        owner: {
          select: {
            walletAddress: true,
          },
        },
        _count: {
          select: { memberships: true },
        },
      },
    });

    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

    // If community is private, verify user is a member
    if (!community.isPublic) {
      const authResult = await authenticateRequest(req);
      if (!authResult.success || !authResult.user) {
        return createErrorResponse('Community not found', 404);
      }

      const isMember = await isCommunityMember(authResult.user.id, communityId);
      if (!isMember) {
        return createErrorResponse('Community not found', 404);
      }
    }

    // Build response
    const response: CommunityResponse = {
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      ownerId: community.ownerId,
      ownerWallet: community.owner.walletAddress,
      minTokenBalance: community.minTokenBalance.toString(),
      isPublic: community.isPublic,
      memberCount: community._count.memberships,
      createdAt: community.createdAt.toISOString(),
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /communities/[id] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * PUT /api/communities/[id]
 * Update community (owner only)
 */
export async function PUT(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Verify user is the owner
    const isOwner = await isCommunityOwner(user.id, communityId);
    if (!isOwner) {
      return createErrorResponse('Only the community owner can update settings', 403);
    }

    // Fetch current community
    const community = await prisma.community.findUnique({
      where: { id: communityId },
    });

    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

    // Parse request body
    const body = await req.json() as UpdateCommunityRequest;
    const { name, description, avatar, minTokenBalance, isPublic } = body;

    // Build updates
    const updates: {
      name?: string;
      description?: string | null;
      avatar?: string | null;
      minTokenBalance?: bigint;
      isPublic?: boolean;
    } = {};

    if (name !== undefined) {
      const sanitizedName = sanitizeInput(name.trim());
      if (sanitizedName.length < 3 || sanitizedName.length > 50) {
        return createErrorResponse(
          'Community name must be between 3 and 50 characters',
          400
        );
      }
      updates.name = sanitizedName;
    }

    if (description !== undefined) {
      if (description === null || description === '') {
        updates.description = null;
      } else {
        const sanitizedDescription = sanitizeInput(description.trim());
        if (sanitizedDescription.length > 500) {
          return createErrorResponse(
            'Community description must be 500 characters or less',
            400
          );
        }
        updates.description = sanitizedDescription;
      }
    }

    if (avatar !== undefined) {
      updates.avatar = avatar || null;
    }

    if (minTokenBalance !== undefined) {
      try {
        const parsedBalance = BigInt(minTokenBalance);
        if (parsedBalance < 0) {
          return createErrorResponse('Minimum token balance cannot be negative', 400);
        }

        // If increasing the minimum, verify owner still meets it
        if (parsedBalance > community.minTokenBalance) {
          const ownerMeetsMin = await checkMinTokenBalance(
            user.walletAddress,
            parsedBalance
          );
          if (!ownerMeetsMin) {
            return createErrorResponse(
              'Cannot set minimum balance higher than your own token balance',
              400
            );
          }
        }

        updates.minTokenBalance = parsedBalance;
      } catch {
        return createErrorResponse('Invalid minimum token balance format', 400);
      }
    }

    if (isPublic !== undefined) {
      updates.isPublic = isPublic;
    }

    // Check if there are any updates
    if (Object.keys(updates).length === 0) {
      return createErrorResponse('No valid fields to update', 400);
    }

    // Update community
    const updatedCommunity = await prisma.community.update({
      where: { id: communityId },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
      include: {
        owner: {
          select: {
            walletAddress: true,
          },
        },
        _count: {
          select: { memberships: true },
        },
      },
    });

    // Build response
    const response: CommunityResponse = {
      id: updatedCommunity.id,
      name: updatedCommunity.name,
      description: updatedCommunity.description,
      avatar: updatedCommunity.avatar,
      ownerId: updatedCommunity.ownerId,
      ownerWallet: updatedCommunity.owner.walletAddress,
      minTokenBalance: updatedCommunity.minTokenBalance.toString(),
      isPublic: updatedCommunity.isPublic,
      memberCount: updatedCommunity._count.memberships,
      createdAt: updatedCommunity.createdAt.toISOString(),
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] PUT /communities/[id] error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * DELETE /api/communities/[id]
 * Delete community (owner only)
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Verify user is the owner
    const isOwner = await isCommunityOwner(user.id, communityId);
    if (!isOwner) {
      return createErrorResponse('Only the community owner can delete the community', 403);
    }

    // Verify community exists
    const community = await prisma.community.findUnique({
      where: { id: communityId },
    });

    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

    // Delete community (cascades to channels, messages, memberships)
    await prisma.community.delete({
      where: { id: communityId },
    });

    return createSuccessResponse({ success: true, message: 'Community deleted' });
  } catch (error) {
    console.error('[API] DELETE /communities/[id] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
