/**
 * POST /api/auth/verify
 * Verify signature and authenticate user
 *
 * Request body:
 * {
 *   publicKey: string (base58-encoded NaCl signing public key)
 *   signature: string (base64-encoded detached signature)
 *   message: string (auth message with timestamp)
 * }
 *
 * The user logs in with their private key — we derive the public key client-side
 * and look up the account by publicKey. No publicId needed at login time.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import bs58 from 'bs58';
import {
  verifySignature,
  validateAuthMessage,
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
    const { publicKey, signature, message } = body;

    // Validate required fields
    if (!publicKey || !signature || !message) {
      return createErrorResponse(
        'Missing required fields: publicKey, signature, message',
        400
      );
    }

    // Rate limit by publicKey
    const rateLimit = checkRateLimit(`verify:${publicKey}`);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    // Validate auth message format and timestamp
    if (!validateAuthMessage(message)) {
      return createErrorResponse(
        'Invalid or expired authentication message. Please try again.',
        401
      );
    }

    // Decode the public key from base58 to Uint8Array
    let publicKeyBytes: Uint8Array;
    try {
      publicKeyBytes = bs58.decode(publicKey);
      if (publicKeyBytes.length !== 32) {
        return createErrorResponse('Invalid public key length', 400);
      }
    } catch {
      return createErrorResponse('Invalid public key format', 400);
    }

    // Decode the signature from base64 to Uint8Array
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
      if (signatureBytes.length !== 64) {
        return createErrorResponse('Invalid signature length', 400);
      }
    } catch {
      return createErrorResponse('Invalid signature format', 400);
    }

    // Verify NaCl signature
    if (!verifySignature(message, signatureBytes, publicKeyBytes)) {
      return createErrorResponse('Invalid signature', 401);
    }

    // Look up user by publicKey
    const user = await prisma.user.findFirst({
      where: { publicKey },
    });

    if (!user || !user.id || !user.publicId) {
      return createErrorResponse(
        !user ? 'Account not found. Please create an account first.' : 'Invalid user data',
        !user ? 404 : 500
      );
    }

    // Check if user is blacklisted
    if (user.isBlacklisted) {
      return createErrorResponse(
        'This account has been permanently banned from Void Chat',
        403
      );
    }

    // Generate session token
    const token = generateAuthToken(user.id, user.publicId);

    return createSuccessResponse({
      success: true,
      token,
      user: {
        publicId: user.publicId,
        publicKey: user.publicKey,
        artHash: user.artHash,
      },
    });
  } catch (error) {
    console.error('[API] /auth/verify error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
