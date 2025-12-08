/**
 * /api/communities/[id]/members
 * Community membership operations
 *
 * GET: List community members
 * POST: Join community (verify token balance)
 * DELETE: Leave community
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isCommunityMember,
  isCommunityOwner,
  checkMinTokenBalance,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import type { MemberResponse, MemberListResponse, JoinCommunityResponse } from '@/types/api';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/communities/[id]/members
 * List community members
 */
export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    // Verify community exists
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { isPublic: true },
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

    // Fetch members with user info
    const memberships = await prisma.membership.findMany({
      where: { communityId },
      include: {
        user: {
          select: {
            walletAddress: true,
            xHandle: true,
            publicKey: true,
            isBlacklisted: true,
          },
        },
      },
      orderBy: [
        { role: 'asc' }, // OWNER first, then ADMIN, then MEMBER
        { joinedAt: 'asc' },
      ],
    });

    // Filter out blacklisted users from the response
    // Note: No internal IDs or token balances exposed
    const members: MemberResponse[] = memberships
      .filter((m) => !m.user.isBlacklisted)
      .map((m) => ({
        walletAddress: m.user.walletAddress,
        xHandle: m.user.xHandle,
        publicKey: m.user.publicKey,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      }));

    // Build response
    const response: MemberListResponse = {
      members,
      total: members.length,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /communities/[id]/members error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * POST /api/communities/[id]/members
 * Join community
 */
export async function POST(
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

    // Verify community exists
    const community = await prisma.community.findUnique({
      where: { id: communityId },
    });

    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

    // Check if already a member
    const existingMembership = await prisma.membership.findUnique({
      where: {
        userId_communityId: {
          userId: user.id,
          communityId,
        },
      },
    });

    if (existingMembership) {
      return createErrorResponse('Already a member of this community', 409);
    }

    // Verify minimum token balance
    if (community.minTokenBalance > BigInt(0)) {
      const meetsMinimum = await checkMinTokenBalance(
        user.walletAddress,
        community.minTokenBalance
      );

      if (!meetsMinimum) {
        return createErrorResponse(
          `Minimum token balance of ${community.minTokenBalance.toString()} $CLAWED required to join this community`,
          403
        );
      }
    }

    // Create membership
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        communityId,
        role: 'MEMBER',
      },
    });

    // Build response
    const response: JoinCommunityResponse = {
      success: true,
      membership: {
        id: membership.id,
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
      },
    };

    return createSuccessResponse(response, 201);
  } catch (error) {
    console.error('[API] POST /communities/[id]/members error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * DELETE /api/communities/[id]/members
 * Leave community (or remove member if admin)
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

    // Check for target member ID (for admin removing members)
    const { searchParams } = new URL(req.url);
    const targetMemberId = searchParams.get('memberId');

    // Verify community exists
    const community = await prisma.community.findUnique({
      where: { id: communityId },
    });

    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

    if (targetMemberId && targetMemberId !== user.id) {
      // Admin trying to remove another member
      const isOwner = await isCommunityOwner(user.id, communityId);
      if (!isOwner) {
        // Check if admin
        const adminMembership = await prisma.membership.findUnique({
          where: {
            userId_communityId: {
              userId: user.id,
              communityId,
            },
          },
        });

        if (!adminMembership || adminMembership.role === 'MEMBER') {
          return createErrorResponse('Only admins and owners can remove members', 403);
        }
      }

      // Find target membership
      const targetMembership = await prisma.membership.findFirst({
        where: {
          userId: targetMemberId,
          communityId,
        },
      });

      if (!targetMembership) {
        return createErrorResponse('Member not found', 404);
      }

      // Cannot remove owner
      if (targetMembership.role === 'OWNER') {
        return createErrorResponse('Cannot remove the community owner', 403);
      }

      // Non-owners cannot remove admins
      if (targetMembership.role === 'ADMIN' && !isOwner) {
        return createErrorResponse('Only the owner can remove admins', 403);
      }

      // Remove member
      await prisma.membership.delete({
        where: { id: targetMembership.id },
      });

      return createSuccessResponse({ success: true, message: 'Member removed' });
    }

    // User is leaving the community themselves
    const membership = await prisma.membership.findUnique({
      where: {
        userId_communityId: {
          userId: user.id,
          communityId,
        },
      },
    });

    if (!membership) {
      return createErrorResponse('Not a member of this community', 404);
    }

    // Owner cannot leave (must transfer ownership or delete community)
    if (membership.role === 'OWNER') {
      return createErrorResponse(
        'Community owner cannot leave. Transfer ownership or delete the community instead.',
        403
      );
    }

    // Remove membership
    await prisma.membership.delete({
      where: { id: membership.id },
    });

    return createSuccessResponse({ success: true, message: 'Left community' });
  } catch (error) {
    console.error('[API] DELETE /communities/[id]/members error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
