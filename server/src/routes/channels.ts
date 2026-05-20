/**
 * Channel routes: list, create
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  authenticateRequest,
  isCommunityMember,
  validatePagination,
  sanitizeInput,
  sendError,
  sendSuccess,
} from '../lib/auth.js';
import { createChannelSchema } from '../lib/validation.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/communities/:id/channels
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const communityId = req.params.id;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication required to view channels', authResult.statusCode || 401);
    }

    const isMember = await isCommunityMember(authResult.user.id, communityId);
    if (!isMember) {
      return sendError(res, 'Must be a member to view channels', 403);
    }

    const { page, limit, skip } = validatePagination(
      req.query.page as string,
      req.query.limit as string
    );

    const where = { communityId };

    const [channels, total] = await Promise.all([
      prisma.channel.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.channel.count({ where }),
    ]);

    return sendSuccess(res, {
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        communityId: c.communityId,
        isDefault: c.isDefault,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      hasMore: skip + channels.length < total,
    });
  } catch (error) {
    console.error('[API] GET /communities/:id/channels error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/communities/:id/channels
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const communityId = req.params.id;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication required', authResult.statusCode || 401);
    }

    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) {
      return sendError(res, 'Community not found', 404);
    }

    const isMember = await isCommunityMember(authResult.user.id, communityId);
    if (!isMember) {
      return sendError(res, 'Must be a member to create channels', 403);
    }

    const validationResult = createChannelSchema.safeParse(req.body);
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return sendError(res, `Validation failed: ${errors}`, 400);
    }

    const { name, description, isDefault } = validationResult.data;
    const sanitizedName = sanitizeInput(name.trim().toLowerCase());
    const sanitizedDescription = description ? sanitizeInput(description.trim()) : null;

    const existingChannel = await prisma.channel.findFirst({
      where: { communityId, name: sanitizedName },
    });

    if (existingChannel) {
      return sendError(res, 'A channel with this name already exists', 409);
    }

    if (sanitizedDescription && sanitizedDescription.length > 200) {
      return sendError(res, 'Channel description must be 200 characters or less', 400);
    }

    const channel = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.channel.updateMany({
          where: { communityId, isDefault: true },
          data: { isDefault: false },
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

    return sendSuccess(res, {
      id: channel.id,
      name: channel.name,
      description: channel.description,
      communityId: channel.communityId,
      isDefault: channel.isDefault,
      createdAt: channel.createdAt.toISOString(),
    }, 201);
  } catch (error) {
    console.error('[API] POST /communities/:id/channels error:', error);
    if (error instanceof SyntaxError) {
      return sendError(res, 'Invalid JSON in request body', 400);
    }
    return sendError(res, 'Internal server error', 500);
  }
});

export default router;
