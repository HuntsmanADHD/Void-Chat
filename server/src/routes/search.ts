/**
 * Search route: users, communities, channels
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  authenticateRequest,
  sanitizeInput,
  sendError,
  sendSuccess,
} from '../lib/auth.js';

const router = Router();

type SearchResultType = 'user' | 'community' | 'channel';
const VALID_TYPES: SearchResultType[] = ['user', 'community', 'channel'];

/**
 * GET /api/search?q=...&types=...&communityId=...&limit=...
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication failed', authResult.statusCode || 401);
    }

    const user = authResult.user;
    const query = req.query.q as string;
    const typesParam = req.query.types as string | undefined;
    const communityId = req.query.communityId as string | undefined;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string || '10', 10)));

    if (!query || query.trim().length === 0) {
      return sendError(res, 'Search query is required', 400);
    }

    if (query.trim().length < 2) {
      return sendError(res, 'Search query must be at least 2 characters', 400);
    }

    const sanitizedQuery = sanitizeInput(query.trim().toLowerCase());

    let types: SearchResultType[] = VALID_TYPES;
    if (typesParam) {
      const requestedTypes = typesParam.split(',') as SearchResultType[];
      types = requestedTypes.filter((t) => VALID_TYPES.includes(t));
      if (types.length === 0) {
        return sendError(res, `Invalid types. Must be one of: ${VALID_TYPES.join(', ')}`, 400);
      }
    }

    const results: Array<Record<string, unknown>> = [];

    if (types.includes('user')) {
      const users = await prisma.user.findMany({
        where: {
          isBlacklisted: false,
          publicId: { contains: sanitizedQuery, mode: 'insensitive' },
        },
        take: limit,
        select: { id: true, publicId: true, publicKey: true },
      });

      results.push(...users.map((u) => ({
        type: 'user' as const,
        id: u.id,
        publicId: u.publicId,
        publicKey: u.publicKey,
      })));
    }

    if (types.includes('community')) {
      const communities = await prisma.community.findMany({
        where: {
          memberships: { some: { userId: user.id } },
          AND: [{
            OR: [
              { name: { contains: sanitizedQuery, mode: 'insensitive' } },
              { description: { contains: sanitizedQuery, mode: 'insensitive' } },
            ],
          }],
        },
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          avatar: true,
          _count: { select: { memberships: true } },
        },
      });

      results.push(...communities.map((c) => ({
        type: 'community' as const,
        id: c.id,
        name: c.name,
        description: c.description,
        avatar: c.avatar,
        memberCount: c._count.memberships,
      })));
    }

    if (types.includes('channel')) {
      const accessibleCommunityIds = await prisma.membership.findMany({
        where: { userId: user.id },
        select: { communityId: true },
      });

      const communityIds = accessibleCommunityIds.map((m) => m.communityId);

      const channelFilter = communityId && communityIds.includes(communityId)
        ? { communityId }
        : { communityId: { in: communityIds } };

      const channels = await prisma.channel.findMany({
        where: {
          ...channelFilter,
          OR: [
            { name: { contains: sanitizedQuery, mode: 'insensitive' } },
            { description: { contains: sanitizedQuery, mode: 'insensitive' } },
          ],
        },
        take: limit,
        include: { community: { select: { name: true } } },
      });

      results.push(...channels.map((ch) => ({
        type: 'channel' as const,
        id: ch.id,
        name: ch.name,
        description: ch.description,
        communityId: ch.communityId,
        communityName: ch.community.name,
      })));
    }

    return sendSuccess(res, {
      query: sanitizedQuery,
      results,
      total: results.length,
    });
  } catch (error) {
    console.error('[API] GET /search error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

export default router;
