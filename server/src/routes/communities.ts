/**
 * Community routes: list, create, detail, update
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
import { createCommunitySchema } from '../lib/validation.js';

const router = Router();

/**
 * GET /api/communities
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = validatePagination(
      req.query.page as string,
      req.query.limit as string
    );

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication required', authResult.statusCode || 401);
    }

    const userId = authResult.user.id;
    const whereClause = { memberships: { some: { userId } } };

    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        where: whereClause,
        include: { _count: { select: { memberships: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.community.count({ where: whereClause }),
    ]);

    return sendSuccess(res, {
      communities: communities.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        avatar: c.avatar,
        reportThreshold: c.reportThreshold,
        memberCount: c._count.memberships,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      hasMore: skip + communities.length < total,
    });
  } catch (error) {
    console.error('[API] GET /communities error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/communities
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication required', authResult.statusCode || 401);
    }

    const user = authResult.user;
    if (user.isBlacklisted) {
      return sendError(res, 'Account has been permanently banned', 403);
    }

    const validationResult = createCommunitySchema.safeParse(req.body);
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return sendError(res, `Validation failed: ${errors}`, 400);
    }

    const { name, description, avatar } = validationResult.data;

    if (!name || name.trim().length === 0) {
      return sendError(res, 'Community name is required', 400);
    }

    const sanitizedName = sanitizeInput(name);
    const sanitizedDescription = description ? sanitizeInput(description) : null;

    const community = await prisma.$transaction(async (tx) => {
      const newCommunity = await tx.community.create({
        data: {
          name: sanitizedName,
          description: sanitizedDescription,
          avatar: avatar || null,
          reportThreshold: 5,
          createdById: user.id,
        },
      });

      await tx.channel.create({
        data: {
          name: 'general',
          description: 'General discussion',
          communityId: newCommunity.id,
          isDefault: true,
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          communityId: newCommunity.id,
        },
      });

      return newCommunity;
    });

    return sendSuccess(res, {
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      reportThreshold: community.reportThreshold,
      memberCount: 1,
      createdAt: community.createdAt.toISOString(),
    }, 201);
  } catch (error) {
    console.error('[API] POST /communities error:', error);
    if (error instanceof SyntaxError) {
      return sendError(res, 'Invalid JSON in request body', 400);
    }
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/communities/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id: communityId } = req.params;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, 'Community not found', 404);
    }

    const isMember = await isCommunityMember(authResult.user.id, communityId);
    if (!isMember) {
      return sendError(res, 'Community not found', 404);
    }

    const community = await prisma.community.findUnique({
      where: { id: communityId },
      include: { _count: { select: { memberships: true } } },
    });

    if (!community) {
      return sendError(res, 'Community not found', 404);
    }

    return sendSuccess(res, {
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      reportThreshold: community.reportThreshold,
      memberCount: community._count.memberships,
      createdAt: community.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] GET /communities/:id error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * PUT /api/communities/:id
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id: communityId } = req.params;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication failed', authResult.statusCode || 401);
    }

    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) {
      return sendError(res, 'Community not found', 404);
    }

    // Only the community creator can modify settings
    if (community.createdById !== authResult.user.id) {
      return sendError(res, 'Only the community owner can update settings', 403);
    }

    const { name, description, avatar, reportThreshold } = req.body;

    const updates: {
      name?: string;
      description?: string | null;
      avatar?: string | null;
      reportThreshold?: number;
    } = {};

    if (name !== undefined) {
      const sanitizedName = sanitizeInput(name.trim());
      if (sanitizedName.length < 3 || sanitizedName.length > 50) {
        return sendError(res, 'Community name must be between 3 and 50 characters', 400);
      }
      updates.name = sanitizedName;
    }

    if (description !== undefined) {
      if (description === null || description === '') {
        updates.description = null;
      } else {
        const sanitizedDescription = sanitizeInput(description.trim());
        if (sanitizedDescription.length > 500) {
          return sendError(res, 'Community description must be 500 characters or less', 400);
        }
        updates.description = sanitizedDescription;
      }
    }

    if (avatar !== undefined) {
      if (avatar) {
        // Validate avatar URL: only allow https:// scheme
        try {
          const parsed = new URL(avatar);
          if (parsed.protocol !== 'https:') {
            return sendError(res, 'Avatar URL must use HTTPS', 400);
          }
        } catch {
          return sendError(res, 'Avatar must be a valid URL', 400);
        }
        updates.avatar = avatar;
      } else {
        updates.avatar = null;
      }
    }

    if (reportThreshold !== undefined) {
      if (typeof reportThreshold !== 'number' || reportThreshold < 1 || reportThreshold > 100) {
        return sendError(res, 'Report threshold must be a number between 1 and 100', 400);
      }
      updates.reportThreshold = Math.floor(reportThreshold);
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, 'No valid fields to update', 400);
    }

    const updatedCommunity = await prisma.community.update({
      where: { id: communityId },
      data: { ...updates, updatedAt: new Date() },
      include: { _count: { select: { memberships: true } } },
    });

    return sendSuccess(res, {
      id: updatedCommunity.id,
      name: updatedCommunity.name,
      description: updatedCommunity.description,
      avatar: updatedCommunity.avatar,
      reportThreshold: updatedCommunity.reportThreshold,
      memberCount: updatedCommunity._count.memberships,
      createdAt: updatedCommunity.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] PUT /communities/:id error:', error);
    if (error instanceof SyntaxError) {
      return sendError(res, 'Invalid JSON in request body', 400);
    }
    return sendError(res, 'Internal server error', 500);
  }
});

export default router;
