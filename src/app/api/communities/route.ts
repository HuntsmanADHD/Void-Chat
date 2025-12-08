/**
 * /api/communities
 * Community listing and creation
 *
 * GET: List communities (with pagination)
 * POST: Create community (requires min token balance)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  checkMinTokenBalance,
  validatePagination,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  MIN_TOKEN_FOR_COMMUNITY_CREATE,
  OPTIONS,
} from '@/lib/auth';
import { createCommunitySchema } from '@/lib/validation';
import type {
  CommunityResponse,
  CommunityListResponse,
  CreateCommunityRequest,
} from '@/types/api';

export { OPTIONS };

/**
 * GET /api/communities
 * List public communities with pagination
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit')
    );

    // Authenticate the request properly
    const authResult = await authenticateRequest(req);
    const userId = authResult.success ? authResult.user?.id || null : null;

    // Build query
    const whereClause = userId
      ? {
          OR: [
            { isPublic: true },
            { memberships: { some: { userId } } },
          ],
        }
      : { isPublic: true };

    // Fetch communities with member count
    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        where: whereClause,
        include: {
          owner: {
            select: {
              walletAddress: true,
            },
          },
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

    // Build response
    const response: CommunityListResponse = {
      communities: communities.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        avatar: c.avatar,
        ownerId: c.ownerId,
        ownerWallet: c.owner.walletAddress,
        minTokenBalance: c.minTokenBalance.toString(),
        isPublic: c.isPublic,
        memberCount: c._count.memberships,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      hasMore: skip + communities.length < total,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /communities error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * POST /api/communities
 * Create a new community
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    // Authenticate the request properly with signature verification
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication required',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Check blacklist status
    if (user.isBlacklisted) {
      return createErrorResponse('Account has been permanently banned', 403);
    }

    // Check minimum token balance for community creation
    const hasMinBalance = await checkMinTokenBalance(
      user.walletAddress,
      MIN_TOKEN_FOR_COMMUNITY_CREATE
    );

    if (!hasMinBalance) {
      return createErrorResponse(
        `Minimum token balance of ${MIN_TOKEN_FOR_COMMUNITY_CREATE.toString()} $CLAWED required to create a community`,
        403
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const validationResult = createCommunitySchema.safeParse(body);

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const { name, description, avatar, minTokenBalance, isPublic } = validationResult.data;

    // Validate required fields
    if (!name || name.trim().length === 0) {
      return createErrorResponse('Community name is required', 400);
    }

    // Sanitize inputs (already validated by Zod)
    const sanitizedName = sanitizeInput(name);
    const sanitizedDescription = description ? sanitizeInput(description) : null;

    // Parse min token balance
    let parsedMinBalance = BigInt(0);
    if (minTokenBalance) {
      try {
        parsedMinBalance = BigInt(minTokenBalance);
        if (parsedMinBalance < 0) {
          return createErrorResponse('Minimum token balance cannot be negative', 400);
        }
      } catch {
        return createErrorResponse('Invalid minimum token balance format', 400);
      }
    }

    // Create community with default channel
    const community = await prisma.$transaction(async (tx) => {
      // Create the community
      const newCommunity = await tx.community.create({
        data: {
          name: sanitizedName,
          description: sanitizedDescription,
          avatar: avatar || null,
          ownerId: user.id,
          minTokenBalance: parsedMinBalance,
          isPublic: isPublic ?? true,
        },
      });

      // Create default general channel
      await tx.channel.create({
        data: {
          name: 'general',
          description: 'General discussion',
          communityId: newCommunity.id,
          isDefault: true,
        },
      });

      // Add owner as member with OWNER role
      await tx.membership.create({
        data: {
          userId: user.id,
          communityId: newCommunity.id,
          role: 'OWNER',
        },
      });

      return newCommunity;
    });

    // Build response
    const response: CommunityResponse = {
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      ownerId: community.ownerId,
      ownerWallet: user.walletAddress,
      minTokenBalance: community.minTokenBalance.toString(),
      isPublic: community.isPublic,
      memberCount: 1, // Owner is the first member
      createdAt: community.createdAt.toISOString(),
    };

    return createSuccessResponse(response, 201);
  } catch (error) {
    console.error('[API] POST /communities error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
