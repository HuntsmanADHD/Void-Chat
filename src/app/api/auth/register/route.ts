/**
 * POST /api/auth/register
 * Create a new Void Chat account
 *
 * Request body:
 * {
 *   publicId: string (permanent, 3-32 chars, alphanumeric + _ -)
 *   publicKey: string (base58-encoded NaCl signing public key)
 *   artHash: string (SHA-256 hash of the soul art canvas data)
 * }
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isValidPublicId,
  generateAuthToken,
  checkRateLimit,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const { publicId, publicKey, artHash } = body;

    // Validate required fields
    if (!publicId || !publicKey || !artHash) {
      return createErrorResponse(
        'Missing required fields: publicId, publicKey, artHash',
        400
      );
    }

    // Validate public ID format
    if (!isValidPublicId(publicId)) {
      return createErrorResponse(
        'Public ID must be 3-32 characters, alphanumeric with _ and - only',
        400
      );
    }

    // Rate limit by IP (no identity yet)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimit = checkRateLimit(`register:${clientIp}`);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    // Validate artHash format (should be hex SHA-256 = 64 chars)
    if (!/^[a-f0-9]{64}$/i.test(artHash)) {
      return createErrorResponse('Invalid art hash format. Expected SHA-256 hex string.', 400);
    }

    // Validate publicKey is non-empty base58-ish string
    if (publicKey.length < 20 || publicKey.length > 200) {
      return createErrorResponse('Invalid public key format', 400);
    }

    // Atomic check-and-create to prevent TOCTOU race conditions
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        // Check if publicId is already taken
        const existingById = await tx.user.findUnique({
          where: { publicId },
        });

        if (existingById) {
          throw new Error('PUBLIC_ID_TAKEN');
        }

        // Check if this publicKey is already registered (one key per lifetime)
        const existingByKey = await tx.user.findFirst({
          where: { publicKey },
        });

        if (existingByKey) {
          throw new Error('KEY_ALREADY_USED');
        }

        // Create the user
        return tx.user.create({
          data: {
            publicId,
            publicKey,
            artHash,
          },
        });
      });
    } catch (err: any) {
      if (err?.message === 'PUBLIC_ID_TAKEN') {
        return createErrorResponse('This public ID is already taken. Choose another.', 409);
      }
      if (err?.message === 'KEY_ALREADY_USED') {
        return createErrorResponse(
          'This key has already been used to create an account. One identity per lifetime.',
          409
        );
      }
      // Prisma unique constraint violation (P2002) as fallback for race conditions
      if (err?.code === 'P2002') {
        return createErrorResponse('This public ID or key is already in use.', 409);
      }
      throw err;
    }

    // Generate auth token for immediate login
    const token = generateAuthToken(user.id, publicId);

    return createSuccessResponse({
      success: true,
      token,
      user: {
        publicId: user.publicId,
        publicKey: user.publicKey,
        artHash: user.artHash,
      },
    }, 201);
  } catch (error) {
    console.error('[API] /auth/register error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
