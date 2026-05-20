/**
 * Community membership routes: list, join, leave
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  authenticateRequest,
  isCommunityMember,
  validatePagination,
  sendError,
  sendSuccess,
} from '../lib/auth.js';
import { isKickedFromCommunity } from '../lib/moderation.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/communities/:id/members
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const communityId = req.params.id;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, 'Community not found', 404);
    }

    const isMember = await isCommunityMember(authResult.user.id, communityId);
    if (!isMember) {
      return sendError(res, 'Community not found', 404);
    }

    const { page, limit, skip } = validatePagination(
      req.query.page as string,
      req.query.limit as string
    );

    const where = { communityId, user: { isBlacklisted: false } };

    const [memberships, total] = await Promise.all([
      prisma.membership.findMany({
        where,
        include: {
          user: {
            select: { publicId: true, publicKey: true, isBlacklisted: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
        skip,
        take: limit,
      }),
      prisma.membership.count({ where }),
    ]);

    const members = memberships.map((m) => ({
      publicId: m.user.publicId,
      publicKey: m.user.publicKey,
      joinedAt: m.joinedAt.toISOString(),
    }));

    return sendSuccess(res, { members, total, page, limit, hasMore: skip + members.length < total });
  } catch (error) {
    console.error('[API] GET /communities/:id/members error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/communities/:id/members
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const communityId = req.params.id;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication failed', authResult.statusCode || 401);
    }

    const user = authResult.user;

    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) {
      return sendError(res, 'Community not found', 404);
    }

    const existingMembership = await prisma.membership.findUnique({
      where: { userId_communityId: { userId: user.id, communityId } },
    });

    if (existingMembership) {
      return sendError(res, 'Already a member of this community', 409);
    }

    const wasKicked = await isKickedFromCommunity(user.id, communityId);
    if (wasKicked) {
      return sendError(res, 'You have been kicked from this community and cannot rejoin', 403);
    }

    const membership = await prisma.membership.create({
      data: { userId: user.id, communityId },
    });

    return sendSuccess(res, {
      success: true,
      membership: {
        id: membership.id,
        joinedAt: membership.joinedAt.toISOString(),
      },
    }, 201);
  } catch (error) {
    console.error('[API] POST /communities/:id/members error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * DELETE /api/communities/:id/members
 */
router.delete('/', async (req: Request, res: Response) => {
  try {
    const communityId = req.params.id;

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication failed', authResult.statusCode || 401);
    }

    const user = authResult.user;

    const membership = await prisma.membership.findUnique({
      where: { userId_communityId: { userId: user.id, communityId } },
    });

    if (!membership) {
      return sendError(res, 'Not a member of this community', 404);
    }

    await prisma.membership.delete({ where: { id: membership.id } });

    return sendSuccess(res, { success: true, message: 'Left community' });
  } catch (error) {
    console.error('[API] DELETE /communities/:id/members error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

export default router;
