/**
 * /api/communities/[id]
 * Single community operations
 *
 * GET: Get community details (members only)
 * PUT: Update community (any member — no owners)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isCommunityMember,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/communities/[id]
 * Get community details (must be a member)
 */
export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse('Community not found', 404);
    }

    const isMember = await isCommunityMember(authResult.user.id, communityId);
    if (!isMember) {
      return createErrorResponse('Community not found', 404);
    }

    const community = await prisma.community.findUnique({
      where: { id: communityId },
      include: {
        _count: {
          select: { memberships: true },
        },
      },
    });

    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

    return createSuccessResponse({
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      reportThreshold: community.reportThreshold,
      memberCount: community._count.memberships,
      createdAt: community.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] GET /communities/[id] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * PUT /api/communities/[id]
 * Update community settings (any member can update)
 */
export async function PUT(
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

    // Only the community creator can modify settings
    if (community.createdById !== user.id) {
      return createErrorResponse('Only the community owner can update settings', 403);
    }

    const body = await req.json();
    const { name, description, avatar, reportThreshold } = body;

    const updates: {
      name?: string;
      description?: string | null;
      avatar?: string | null;
      reportThreshold?: number;
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

    if (reportThreshold !== undefined) {
      if (typeof reportThreshold !== 'number' || reportThreshold < 1 || reportThreshold > 100) {
        return createErrorResponse('Report threshold must be a number between 1 and 100', 400);
      }
      updates.reportThreshold = Math.floor(reportThreshold);
    }

    if (Object.keys(updates).length === 0) {
      return createErrorResponse('No valid fields to update', 400);
    }

    const updatedCommunity = await prisma.community.update({
      where: { id: communityId },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
      include: {
        _count: {
          select: { memberships: true },
        },
      },
    });

    return createSuccessResponse({
      id: updatedCommunity.id,
      name: updatedCommunity.name,
      description: updatedCommunity.description,
      avatar: updatedCommunity.avatar,
      reportThreshold: updatedCommunity.reportThreshold,
      memberCount: updatedCommunity._count.memberships,
      createdAt: updatedCommunity.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] PUT /communities/[id] error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
