import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  authenticateRequest,
  checkRateLimit,
  validatePagination,
  sendError,
  sendSuccess,
} from '../lib/auth.js';

const router = Router();

// GET /api/bans — get the platform ban wall (requires auth + rate limit + pagination)
router.get('/', async (req: Request, res: Response) => {
  try {
    // Require authentication
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication required', authResult.statusCode || 401);
    }

    // Rate limit
    const rateCheck = checkRateLimit(authResult.user.publicId);
    if (!rateCheck.allowed) {
      return sendError(res, `Rate limited. Retry after ${rateCheck.retryAfter}s`, 429);
    }

    // Pagination
    const { page, limit, skip } = validatePagination(
      req.query.page as string,
      req.query.limit as string
    );

    const where = { isBlacklisted: true };

    const [bannedUsers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          publicId: true,
          artHash: true,
          createdAt: true,
          communityKicks: {
            select: {
              community: { select: { name: true } },
              reportCount: true,
              kickedAt: true,
            },
            orderBy: { kickedAt: 'desc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return sendSuccess(res, {
      total,
      page,
      limit,
      hasMore: skip + bannedUsers.length < total,
      banned: bannedUsers.map(u => ({
        publicId: u.publicId,
        artHash: u.artHash,
        createdAt: u.createdAt,
        kicks: u.communityKicks.map(k => ({
          communityName: k.community.name,
          reportCount: k.reportCount,
          kickedAt: k.kickedAt,
        })),
      })),
    });
  } catch (error) {
    console.error('[Bans] Error:', error);
    return sendError(res, 'Failed to fetch ban list', 500);
  }
});

// GET /api/bans/check/:publicId — check if a user is banned
router.get('/check/:publicId', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.params.publicId },
      select: { isBlacklisted: true },
    });

    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    return sendSuccess(res, { publicId: req.params.publicId, isBanned: user.isBlacklisted });
  } catch (error) {
    return sendError(res, 'Failed to check ban status', 500);
  }
});

export default router;
