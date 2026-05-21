/**
 * /api/communities
 *
 * GET  — list all communities (public, no auth)
 * POST — create a community (IP rate-limited, no auth)
 *
 * Ephemeral identity model: no creator tracking, no membership rows.
 * Anyone can list, anyone can create.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  checkRateLimit,
  getClientIp,
  sanitizeInput,
  validatePagination,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const { skip, limit } = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit')
    );

    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { channels: true } } },
      }),
      prisma.community.count(),
    ]);

    return createSuccessResponse({
      communities: communities.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        avatar: c.avatar,
        channelCount: c._count.channels,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
    });
  } catch (error) {
    console.error('[API] GET /communities error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`community-create:${clientIp}`);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    const body = await req.json();
    const name = sanitizeInput(body.name || '', 64);
    const description = body.description ? sanitizeInput(body.description, 500) : null;
    const avatar = body.avatar ? sanitizeInput(body.avatar, 512) : null;

    if (name.length < 2 || name.length > 64) {
      return createErrorResponse('Community name must be 2–64 characters', 400);
    }
    if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
      return createErrorResponse('Community name may only contain letters, numbers, spaces, _ and -', 400);
    }

    let community;
    try {
      community = await prisma.community.create({
        data: {
          name,
          description,
          avatar,
          channels: {
            create: [{ name: 'general', isDefault: true }],
          },
        },
        include: { channels: true },
      });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002') {
        return createErrorResponse('A community with that name already exists', 409);
      }
      throw err;
    }

    return createSuccessResponse(
      {
        id: community.id,
        name: community.name,
        description: community.description,
        avatar: community.avatar,
        channels: community.channels.map((ch) => ({
          id: ch.id,
          name: ch.name,
          isDefault: ch.isDefault,
        })),
        createdAt: community.createdAt.toISOString(),
      },
      201
    );
  } catch (error) {
    console.error('[API] POST /communities error:', error);
    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }
    return createErrorResponse('Internal server error', 500);
  }
}
