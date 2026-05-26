/**
 * /api/communities/[id]
 *
 *   GET    — fetch a community (gated by `x-community-password` if private)
 *   DELETE — remove a community + cascade its channels
 *            (gated by `x-community-password` if private; public communities
 *            can be deleted by anyone with the URL — matches the
 *            anyone-can-create symmetry of the self-host trust model).
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  checkRateLimit,
  getClientIp,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/api';
import { verifyPassword } from '@/lib/communityPassword';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function checkCommunityPassword(
  req: NextRequest,
  passwordHash: string | null,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (passwordHash === null) return { ok: true };
  const provided = req.headers.get('x-community-password') || '';
  if (!provided) {
    return { ok: false, status: 401, message: 'Password required' };
  }
  const valid = await verifyPassword(provided, passwordHash);
  if (!valid) {
    return { ok: false, status: 401, message: 'Invalid password' };
  }
  return { ok: true };
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id } = await params;

    const community = await prisma.community.findUnique({
      where: { id },
      include: {
        channels: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, description: true, isDefault: true },
        },
      },
    });

    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

    const auth = await checkCommunityPassword(req, community.passwordHash);
    if (!auth.ok) return createErrorResponse(auth.message, auth.status);

    return createSuccessResponse({
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      isPrivate: community.passwordHash !== null,
      channels: community.channels,
      createdAt: community.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] GET /communities/[id] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id } = await params;

    // Light IP rate limit so a single host can't burn through deletes
    // in a tight loop. The rate-limit isn't a security barrier here —
    // anyone with the password (or any visitor for public communities)
    // can delete; this just prevents accidental loops.
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`community-delete:${clientIp}`);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429,
      );
    }

    const community = await prisma.community.findUnique({
      where: { id },
      select: { id: true, passwordHash: true },
    });
    if (!community) {
      return createErrorResponse('Community not found', 404);
    }

    const auth = await checkCommunityPassword(req, community.passwordHash);
    if (!auth.ok) return createErrorResponse(auth.message, auth.status);

    // Channels cascade via the Prisma relation onDelete: Cascade.
    await prisma.community.delete({ where: { id } });

    return createSuccessResponse({ deleted: id });
  } catch (error) {
    console.error('[API] DELETE /communities/[id] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
