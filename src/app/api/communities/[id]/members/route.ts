/**
 * /api/communities/[id]/members
 * Community membership operations
 *
 * GET: List community members
 * POST: Join community (invite-based, checks kick history)
 * DELETE: Leave community
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isCommunityMember,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { isKickedFromCommunity } from '@/lib/moderation';

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

    // Must be a member to see member list
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse('Community not found', 404);
    }

    const isMember = await isCommunityMember(authResult.user.id, communityId);
    if (!isMember) {
      return createErrorResponse('Community not found', 404);
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));
    const skip = (page - 1) * limit;

    const [memberships, total] = await Promise.all([
      prisma.membership.findMany({
        where: {
          communityId,
          user: { isBlacklisted: false },
        },
        include: {
          user: {
            select: {
              publicId: true,
              publicKey: true,
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
        take: limit,
        skip,
      }),
      prisma.membership.count({
        where: {
          communityId,
          user: { isBlacklisted: false },
        },
      }),
    ]);

    const members = memberships.map((m) => ({
      publicId: m.user.publicId,
      publicKey: m.user.publicKey,
      joinedAt: m.joinedAt.toISOString(),
    }));

    return createSuccessResponse({
      members,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
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

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    const community = await prisma.community.findUnique({
      where: { id: communityId },
    });

    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

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

    // Check if user was previously kicked
    const wasKicked = await isKickedFromCommunity(user.id, communityId);
    if (wasKicked) {
      return createErrorResponse('You have been kicked from this community and cannot rejoin', 403);
    }

    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        communityId,
      },
    });

    return createSuccessResponse({
      success: true,
      membership: {
        id: membership.id,
        joinedAt: membership.joinedAt.toISOString(),
      },
    }, 201);
  } catch (error) {
    console.error('[API] POST /communities/[id]/members error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * DELETE /api/communities/[id]/members
 * Leave community (any member can leave)
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

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

    await prisma.membership.delete({
      where: { id: membership.id },
    });

    return createSuccessResponse({ success: true, message: 'Left community' });
  } catch (error) {
    console.error('[API] DELETE /communities/[id]/members error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
