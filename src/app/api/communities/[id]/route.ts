/**
 * /api/communities/[id]
 *
 * GET — fetch a community by id (public, no auth)
 *
 * Ephemeral identity model: no update/delete via HTTP. Communities are
 * immutable directory entries once created.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _req: NextRequest,
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

    return createSuccessResponse({
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      channels: community.channels,
      createdAt: community.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] GET /communities/[id] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
