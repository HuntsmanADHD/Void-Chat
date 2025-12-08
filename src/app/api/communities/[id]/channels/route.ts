/**
 * /api/communities/[id]/channels
 * Channel operations within a community
 *
 * GET: List channels in community
 * POST: Create channel (admin+ only)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isCommunityMember,
  isCommunityAdmin,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { createChannelSchema } from '@/lib/validation';
import type { ChannelResponse, ChannelListResponse, CreateChannelRequest } from '@/types/api';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/communities/[id]/channels
 * List channels in community
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

    // Authenticate for membership verification
    const authResult = await authenticateRequest(req);

    // If private community, verify membership
    if (!community.isPublic) {
      if (!authResult.success || !authResult.user) {
        return createErrorResponse('Community not found', 404);
      }

      const isMember = await isCommunityMember(authResult.user.id, communityId);
      if (!isMember) {
        return createErrorResponse('Community not found', 404);
      }
    } else {
      // For public communities, still require auth to view channels
      if (!authResult.success || !authResult.user) {
        return createErrorResponse(
          authResult.error || 'Authentication required to view channels',
          authResult.statusCode || 401
        );
      }

      const isMember = await isCommunityMember(authResult.user.id, communityId);
      if (!isMember) {
        return createErrorResponse('Must be a member to view channels', 403);
      }
    }

    // Fetch channels
    const channels = await prisma.channel.findMany({
      where: { communityId },
      orderBy: [
        { isDefault: 'desc' }, // Default channel first
        { createdAt: 'asc' },
      ],
    });

    // Build response
    const response: ChannelListResponse = {
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        communityId: c.communityId,
        isDefault: c.isDefault,
        createdAt: c.createdAt.toISOString(),
      })),
      total: channels.length,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /communities/[id]/channels error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * POST /api/communities/[id]/channels
 * Create new channel (admin+ only)
 */
export async function POST(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    // Authenticate the request properly with signature verification
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication required',
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

    // Verify user is admin or owner
    const isAdmin = await isCommunityAdmin(user.id, communityId);
    if (!isAdmin) {
      return createErrorResponse('Only admins and owners can create channels', 403);
    }

    // Parse and validate request body
    const body = await req.json();
    const validationResult = createChannelSchema.safeParse(body);

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const { name, description, isDefault } = validationResult.data;

    // Sanitize inputs
    const sanitizedName = sanitizeInput(name.trim().toLowerCase());
    const sanitizedDescription = description
      ? sanitizeInput(description.trim())
      : null;

    // Validate name format (lowercase, alphanumeric, hyphens)
    // Check if channel name already exists in this community
    const existingChannel = await prisma.channel.findFirst({
      where: {
        communityId,
        name: sanitizedName,
      },
    });

    if (existingChannel) {
      return createErrorResponse('A channel with this name already exists', 409);
    }

    // Validate description length
    if (sanitizedDescription && sanitizedDescription.length > 200) {
      return createErrorResponse(
        'Channel description must be 200 characters or less',
        400
      );
    }

    // Create channel (with transaction if setting as default)
    const channel = await prisma.$transaction(async (tx) => {
      // If setting this as default, unset the current default
      if (isDefault) {
        await tx.channel.updateMany({
          where: {
            communityId,
            isDefault: true,
          },
          data: {
            isDefault: false,
          },
        });
      }

      // Create channel
      return await tx.channel.create({
        data: {
          name: sanitizedName,
          description: sanitizedDescription,
          communityId,
          isDefault: isDefault ?? false,
        },
      });
    });

    // Build response
    const response: ChannelResponse = {
      id: channel.id,
      name: channel.name,
      description: channel.description,
      communityId: channel.communityId,
      isDefault: channel.isDefault,
      createdAt: channel.createdAt.toISOString(),
    };

    return createSuccessResponse(response, 201);
  } catch (error) {
    console.error('[API] POST /communities/[id]/channels error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
