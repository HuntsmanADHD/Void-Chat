/**
 * /api/communities/[id]/channels
 * Channel operations within a community
 *
 * GET: List channels in community
 * POST: Create channel (any member)
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
import { createChannelSchema } from '@/lib/validation';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/communities/[id]/channels
 * List channels in community (members only)
 */
export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    const authResult = await authenticateRequest(req);
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

    const channels = await prisma.channel.findMany({
      where: { communityId },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    return createSuccessResponse({
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        communityId: c.communityId,
        isDefault: c.isDefault,
        createdAt: c.createdAt.toISOString(),
      })),
      total: channels.length,
    });
  } catch (error) {
    console.error('[API] GET /communities/[id]/channels error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * POST /api/communities/[id]/channels
 * Create new channel (any member can create)
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
        authResult.error || 'Authentication required',
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

    // Any member can create channels
    const isMember = await isCommunityMember(user.id, communityId);
    if (!isMember) {
      return createErrorResponse('Must be a member to create channels', 403);
    }

    const body = await req.json();
    const validationResult = createChannelSchema.safeParse(body);

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const { name, description, isDefault } = validationResult.data;

    const sanitizedName = sanitizeInput(name.trim().toLowerCase());
    const sanitizedDescription = description
      ? sanitizeInput(description.trim())
      : null;

    const existingChannel = await prisma.channel.findFirst({
      where: {
        communityId,
        name: sanitizedName,
      },
    });

    if (existingChannel) {
      return createErrorResponse('A channel with this name already exists', 409);
    }

    if (sanitizedDescription && sanitizedDescription.length > 200) {
      return createErrorResponse(
        'Channel description must be 200 characters or less',
        400
      );
    }

    const channel = await prisma.$transaction(async (tx) => {
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

      return await tx.channel.create({
        data: {
          name: sanitizedName,
          description: sanitizedDescription,
          communityId,
          isDefault: isDefault ?? false,
        },
      });
    });

    return createSuccessResponse({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      communityId: channel.communityId,
      isDefault: channel.isDefault,
      createdAt: channel.createdAt.toISOString(),
    }, 201);
  } catch (error) {
    console.error('[API] POST /communities/[id]/channels error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
