/**
 * GET /api/search
 * Search across users, communities, channels
 *
 * Query params:
 * - q: string (required) - Search query
 * - types: string (optional) - Comma-separated types: user,community,channel
 * - communityId: string (optional) - Scope search to specific community
 * - limit: number (optional) - Max results per type (default 10)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

type SearchResultType = 'user' | 'community' | 'channel';
const VALID_TYPES: SearchResultType[] = ['user', 'community', 'channel'];

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const typesParam = searchParams.get('types');
    const communityId = searchParams.get('communityId');
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

    if (!query || query.trim().length === 0) {
      return createErrorResponse('Search query is required', 400);
    }

    if (query.trim().length < 2) {
      return createErrorResponse('Search query must be at least 2 characters', 400);
    }

    const sanitizedQuery = sanitizeInput(query.trim().toLowerCase());

    let types: SearchResultType[] = VALID_TYPES;
    if (typesParam) {
      const requestedTypes = typesParam.split(',') as SearchResultType[];
      types = requestedTypes.filter((t) => VALID_TYPES.includes(t));
      if (types.length === 0) {
        return createErrorResponse(`Invalid types. Must be one of: ${VALID_TYPES.join(', ')}`, 400);
      }
    }

    const results: Array<Record<string, unknown>> = [];

    // Search users by publicId
    if (types.includes('user')) {
      const users = await prisma.user.findMany({
        where: {
          isBlacklisted: false,
          publicId: { contains: sanitizedQuery, mode: 'insensitive' },
        },
        take: limit,
        select: {
          id: true,
          publicId: true,
          publicKey: true,
        },
      });

      results.push(...users.map((u) => ({
        type: 'user' as const,
        id: u.id,
        publicId: u.publicId,
        publicKey: u.publicKey,
      })));
    }

    // Search communities (only ones user is a member of)
    if (types.includes('community')) {
      const communities = await prisma.community.findMany({
        where: {
          memberships: { some: { userId: user.id } },
          AND: [
            {
              OR: [
                { name: { contains: sanitizedQuery, mode: 'insensitive' } },
                { description: { contains: sanitizedQuery, mode: 'insensitive' } },
              ],
            },
          ],
        },
        take: limit,
        select: {
          id: true,
          name: true,
          description: true,
          avatar: true,
          _count: {
            select: { memberships: true },
          },
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

    // Search channels (only in communities user belongs to)
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
        include: {
          community: {
            select: { name: true },
          },
        },
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

    return createSuccessResponse({
      query: sanitizedQuery,
      results,
      total: results.length,
    });
  } catch (error) {
    console.error('[API] GET /search error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
