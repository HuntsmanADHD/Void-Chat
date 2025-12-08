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
import type {
  SearchResponse,
  SearchResult,
  SearchResultType,
  SearchUserResult,
  SearchCommunityResult,
  SearchChannelResult,
} from '@/types/api';

export { OPTIONS };

const VALID_TYPES: SearchResultType[] = ['user', 'community', 'channel'];

/**
 * GET /api/search
 * Perform a search across multiple entity types
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Parse query params
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const typesParam = searchParams.get('types');
    const communityId = searchParams.get('communityId');
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

    // Validate query
    if (!query || query.trim().length === 0) {
      return createErrorResponse('Search query is required', 400);
    }

    if (query.trim().length < 2) {
      return createErrorResponse('Search query must be at least 2 characters', 400);
    }

    // Sanitize and prepare search query
    const sanitizedQuery = sanitizeInput(query.trim().toLowerCase());

    // Parse types
    let types: SearchResultType[] = VALID_TYPES;
    if (typesParam) {
      const requestedTypes = typesParam.split(',') as SearchResultType[];
      types = requestedTypes.filter((t) => VALID_TYPES.includes(t));
      if (types.length === 0) {
        return createErrorResponse(`Invalid types. Must be one of: ${VALID_TYPES.join(', ')}`, 400);
      }
    }

    const results: SearchResult[] = [];

    // Search users
    if (types.includes('user')) {
      const users = await prisma.user.findMany({
        where: {
          isBlacklisted: false,
          OR: [
            { walletAddress: { contains: sanitizedQuery, mode: 'insensitive' } },
            { xHandle: { contains: sanitizedQuery, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: {
          id: true,
          walletAddress: true,
          xHandle: true,
          publicKey: true,
        },
      });

      const userResults: SearchUserResult[] = users.map((u) => ({
        type: 'user' as const,
        id: u.id,
        walletAddress: u.walletAddress,
        xHandle: u.xHandle,
        publicKey: u.publicKey,
      }));

      results.push(...userResults);
    }

    // Search communities
    if (types.includes('community')) {
      const communities = await prisma.community.findMany({
        where: {
          OR: [
            { isPublic: true },
            { ownerId: user.id },
            { memberships: { some: { userId: user.id } } },
          ],
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
          isPublic: true,
          _count: {
            select: { memberships: true },
          },
        },
      });

      const communityResults: SearchCommunityResult[] = communities.map((c) => ({
        type: 'community' as const,
        id: c.id,
        name: c.name,
        description: c.description,
        avatar: c.avatar,
        memberCount: c._count.memberships,
        isPublic: c.isPublic,
      }));

      results.push(...communityResults);
    }

    // Search channels
    if (types.includes('channel')) {
      // Get communities the user has access to
      const accessibleCommunityIds = await prisma.membership.findMany({
        where: { userId: user.id },
        select: { communityId: true },
      });

      const communityIds = accessibleCommunityIds.map((m) => m.communityId);

      // Also include public communities
      const publicCommunities = await prisma.community.findMany({
        where: { isPublic: true },
        select: { id: true },
      });

      communityIds.push(...publicCommunities.map((c) => c.id));

      // Apply community filter if specified
      const channelFilter = communityId
        ? { communityId }
        : { communityId: { in: [...new Set(communityIds)] } };

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

      const channelResults: SearchChannelResult[] = channels.map((ch) => ({
        type: 'channel' as const,
        id: ch.id,
        name: ch.name,
        description: ch.description,
        communityId: ch.communityId,
        communityName: ch.community.name,
      }));

      results.push(...channelResults);
    }

    // Build response
    const response: SearchResponse = {
      query: sanitizedQuery,
      results,
      total: results.length,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /search error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
