/**
 * /api/communities
 * Community listing and creation
 *
 * GET: List communities (with pagination)
 * POST: Create community (any authenticated user)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  validatePagination,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { createCommunitySchema } from '@/lib/validation';

export { OPTIONS };

// Per-user rate limiting for community creation (10 per hour)
const COMMUNITY_CREATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const COMMUNITY_CREATE_MAX = 10;
const communityCreateLimits = new Map<string, { count: number; resetTime: number }>();

function checkCommunityCreateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = communityCreateLimits.get(userId);

  if (!record || record.resetTime < now) {
    communityCreateLimits.set(userId, { count: 1, resetTime: now + COMMUNITY_CREATE_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= COMMUNITY_CREATE_MAX) {
    return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) };
  }

  record.count++;
  return { allowed: true };
}

/**
 * GET /api/communities
 * List communities with pagination (only those user is a member of)
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit')
    );

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication required',
        authResult.statusCode || 401
      );
    }

    const userId = authResult.user.id;

    // Only show communities user is a member of (all communities are invite-only)
    const whereClause = {
      memberships: { some: { userId } },
    };

    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        where: whereClause,
        include: {
          _count: {
            select: { memberships: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.community.count({ where: whereClause }),
    ]);

    return createSuccessResponse({
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
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * POST /api/communities
 * Create a new community (any authenticated user)
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication required',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    if (user.isBlacklisted) {
      return createErrorResponse('Account has been permanently banned', 403);
    }

    // Rate limit community creation per user
    const rateLimit = checkCommunityCreateLimit(user.id);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Community creation rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    const body = await req.json();
    const validationResult = createCommunitySchema.safeParse(body);

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const { name, description, avatar } = validationResult.data;

    if (!name || name.trim().length === 0) {
      return createErrorResponse('Community name is required', 400);
    }

    const sanitizedName = sanitizeInput(name);
    const sanitizedDescription = description ? sanitizeInput(description) : null;

    // Create community with default channel — creator is just a MEMBER like everyone else
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

      // Creator joins as MEMBER — no special privileges
      await tx.membership.create({
        data: {
          userId: user.id,
          communityId: newCommunity.id,
        },
      });

      return newCommunity;
    });

    return createSuccessResponse({
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
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    // Handle Prisma unique constraint violation
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      return createErrorResponse('A community with that name already exists', 409);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
