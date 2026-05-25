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
import {
  COMMUNITY_PASSWORD_MAX_LEN,
  COMMUNITY_PASSWORD_MIN_LEN,
  hashPassword,
} from '@/lib/communityPassword';

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
      // Never leak the password hash. Surface only the boolean fact that a
      // community is private — clients prompt the user for a password before
      // hitting the per-community GET.
      communities: communities.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        avatar: c.avatar,
        channelCount: c._count.channels,
        isPrivate: c.passwordHash !== null,
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
    // Avatar is a base64 data URL of a client-side-resized 256x256 JPEG.
    // Headroom for the resized image + the `data:image/jpeg;base64,` prefix.
    // Larger uploads are bounded both here and by the client downscaler.
    const avatar = body.avatar ? sanitizeInput(body.avatar, 256 * 1024) : null;
    const rawPassword = typeof body.password === 'string' ? body.password : '';

    if (name.length < 2 || name.length > 64) {
      return createErrorResponse('Community name must be 2–64 characters', 400);
    }
    if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
      return createErrorResponse('Community name may only contain letters, numbers, spaces, _ and -', 400);
    }

    let passwordHash: string | null = null;
    if (rawPassword) {
      if (
        rawPassword.length < COMMUNITY_PASSWORD_MIN_LEN ||
        rawPassword.length > COMMUNITY_PASSWORD_MAX_LEN
      ) {
        return createErrorResponse(
          `Password must be ${COMMUNITY_PASSWORD_MIN_LEN}–${COMMUNITY_PASSWORD_MAX_LEN} characters`,
          400,
        );
      }
      passwordHash = await hashPassword(rawPassword);
    }

    let community;
    try {
      community = await prisma.community.create({
        data: {
          name,
          description,
          avatar,
          passwordHash,
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
        isPrivate: community.passwordHash !== null,
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
