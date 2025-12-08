/**
 * POST /api/auth/verify
 * Verify wallet signature and authenticate user
 *
 * Request body:
 * {
 *   walletAddress: string,
 *   signature: string,
 *   message: string,
 *   publicKey: string (TweetNaCl public key for E2E encryption)
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   token?: string,
 *   user?: UserData,
 *   error?: string
 * }
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  verifyWalletSignature,
  validateAuthMessage,
  generateAuthToken,
  isValidSolanaAddress,
  checkRateLimit,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { getClawedTokenBalance } from '@/lib/solana';
import { isValidPublicKey } from '@/lib/encryption';
import type { VerifyWalletRequest, VerifyWalletResponse } from '@/types/api';

export { OPTIONS };

export async function POST(req: NextRequest): Promise<Response> {
  try {
    // Parse request body
    const body = await req.json() as VerifyWalletRequest;
    const { walletAddress, signature, message, publicKey } = body;

    // Validate required fields
    if (!walletAddress || !signature || !message || !publicKey) {
      return createErrorResponse(
        'Missing required fields: walletAddress, signature, message, publicKey',
        400
      );
    }

    // Validate wallet address format
    if (!isValidSolanaAddress(walletAddress)) {
      return createErrorResponse('Invalid wallet address format', 400);
    }

    // Check rate limit
    const rateLimit = checkRateLimit(walletAddress);
    if (!rateLimit.allowed) {
      return createErrorResponse(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`,
        429
      );
    }

    // Validate auth message format and timestamp
    if (!validateAuthMessage(message)) {
      return createErrorResponse(
        'Invalid or expired authentication message. Please request a new message.',
        401
      );
    }

    // Verify wallet signature
    if (!verifyWalletSignature(message, signature, walletAddress)) {
      return createErrorResponse('Invalid signature', 401);
    }

    // Validate TweetNaCl public key
    if (!isValidPublicKey(publicKey)) {
      return createErrorResponse('Invalid encryption public key format', 400);
    }

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { walletAddress },
    });

    // Fetch current token balance
    const tokenBalance = await getClawedTokenBalance(walletAddress);

    if (user) {
      // Check if user is blacklisted
      if (user.isBlacklisted) {
        return createErrorResponse(
          'This wallet has been permanently banned from Clawed Messenger',
          403
        );
      }

      // Check if user is in timeout
      if (user.timeoutUntil && user.timeoutUntil > new Date()) {
        return createErrorResponse(
          `Account is in timeout until ${user.timeoutUntil.toISOString()}`,
          403
        );
      }

      // Update existing user
      user = await prisma.user.update({
        where: { walletAddress },
        data: {
          publicKey, // Update encryption public key (user may have regenerated)
          tokenBalance,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          walletAddress,
          publicKey,
          tokenBalance,
        },
      });
    }

    // Generate session token
    const token = generateAuthToken(user.id, walletAddress);

    // Build response - only expose necessary public data
    const response: VerifyWalletResponse = {
      success: true,
      token,
      user: {
        walletAddress: user.walletAddress,
        xHandle: user.xHandle,
        publicKey: user.publicKey,
      },
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] /auth/verify error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
