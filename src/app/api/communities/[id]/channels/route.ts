/**
 * /api/communities/[id]/channels
 *
 * GET  — list channels in a community (public, no auth)
 * POST — create a channel in a community (IP rate-limited, no auth)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  checkRateLimit,
  getClientIp,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { verifyPassword } from '@/lib/communityPassword';

async function ensureCommunityAccess(
  req: NextRequest,
  communityId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { id: true, passwordHash: true },
  });
  if (!community) return { ok: false, status: 404, message: 'Community not found' };
  if (community.passwordHash === null) return { ok: true };
  const provided = req.headers.get('x-community-password') || '';
  if (!provided) return { ok: false, status: 401, message: 'Password required' };
  const valid = await verifyPassword(provided, community.passwordHash);
  if (!valid) return { ok: false, status: 401, message: 'Invalid password' };
  return { ok: true };
}

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    const access = await ensureCommunityAccess(req, communityId);
    if (!access.ok) return createErrorResponse(access.message, access.status);

    const channels = await prisma.channel.findMany({
      where: { communityId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, description: true, isDefault: true, createdAt: true },
    });

    return createSuccessResponse({
      channels: channels.map((ch) => ({
        ...ch,
        createdAt: ch.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[API] GET /communities/[id]/channels error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export async function POST(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: communityId } = await params;

    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`channel-create:${clientIp}`);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    const access = await ensureCommunityAccess(req, communityId);
    if (!access.ok) return createErrorResponse(access.message, access.status);

    const body = await req.json();
    const name = sanitizeInput(body.name || '', 32);
    const description = body.description ? sanitizeInput(body.description, 200) : null;

    if (name.length < 1 || name.length > 32) {
      return createErrorResponse('Channel name must be 1–32 characters', 400);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return createErrorResponse('Channel name may only contain letters, numbers, _ and -', 400);
    }

    let channel;
    try {
      channel = await prisma.channel.create({
        data: { name, description, communityId },
      });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002') {
        return createErrorResponse('A channel with that name already exists in this community', 409);
      }
      throw err;
    }

    return createSuccessResponse(
      {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        isDefault: channel.isDefault,
        createdAt: channel.createdAt.toISOString(),
      },
      201
    );
  } catch (error) {
    console.error('[API] POST /communities/[id]/channels error:', error);
    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }
    return createErrorResponse('Internal server error', 500);
  }
}
