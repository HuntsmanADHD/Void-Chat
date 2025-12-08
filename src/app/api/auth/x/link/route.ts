/**
 * X Account Link API Route
 *
 * POST /api/auth/x/link
 *
 * Links an X (Twitter) account to an existing wallet-based user.
 * Requires wallet authentication via headers and X profile data in body.
 *
 * Headers:
 * - x-wallet-address: Wallet public key
 * - x-wallet-signature: Signature of auth message
 * - x-auth-message: The signed auth message
 *
 * Body:
 * - xId: X account ID
 * - xUsername: X username/handle
 * - xName: X display name
 * - xImage: X profile image URL (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyWalletSignature, isAuthMessageValid } from '@/lib/solana';
import { prisma } from '@/lib/prisma';

/**
 * Validate X profile data
 */
interface XProfileData {
  xId: string;
  xUsername: string;
  xName: string;
  xImage?: string;
}

function validateXProfile(data: unknown): data is XProfileData {
  if (!data || typeof data !== 'object') return false;

  const profile = data as Record<string, unknown>;

  return (
    typeof profile.xId === 'string' &&
    profile.xId.length > 0 &&
    typeof profile.xUsername === 'string' &&
    profile.xUsername.length > 0 &&
    typeof profile.xName === 'string'
  );
}

/**
 * Sanitize X handle - remove @ and validate format
 */
function sanitizeXHandle(handle: string): string | null {
  const cleaned = handle.startsWith('@') ? handle.slice(1) : handle;

  // X handles: 4-15 chars, alphanumeric and underscore
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(cleaned)) {
    return null;
  }

  return cleaned.toLowerCase();
}

/**
 * POST handler - Link X account to wallet
 */
export async function POST(request: NextRequest) {
  try {
    // Check if X auth is configured
    if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
      return NextResponse.json(
        { success: false, error: 'X authentication is not configured' },
        { status: 501 }
      );
    }

    // Extract wallet auth headers
    const walletAddress = request.headers.get('x-wallet-address');
    const walletSignature = request.headers.get('x-wallet-signature');
    const authMessage = request.headers.get('x-auth-message');

    // Validate headers
    if (!walletAddress || !walletSignature || !authMessage) {
      return NextResponse.json(
        { success: false, error: 'Missing wallet authentication headers' },
        { status: 401 }
      );
    }

    // Validate wallet address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Verify auth message is not expired
    if (!isAuthMessageValid(authMessage)) {
      return NextResponse.json(
        { success: false, error: 'Authentication expired, please sign in again' },
        { status: 401 }
      );
    }

    // Verify wallet signature
    const isValidSignature = verifyWalletSignature(
      authMessage,
      walletSignature,
      walletAddress
    );

    if (!isValidSignature) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet signature' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();

    if (!validateXProfile(body)) {
      return NextResponse.json(
        { success: false, error: 'Invalid X profile data' },
        { status: 400 }
      );
    }

    // Sanitize X handle
    const sanitizedHandle = sanitizeXHandle(body.xUsername);
    if (!sanitizedHandle) {
      return NextResponse.json(
        { success: false, error: 'Invalid X handle format' },
        { status: 400 }
      );
    }

    // Check if X account is already linked to another wallet
    const existingLink = await prisma.user.findFirst({
      where: {
        xId: body.xId,
        NOT: { walletAddress },
      },
    });

    if (existingLink) {
      return NextResponse.json(
        { success: false, error: 'This X account is already linked to another wallet' },
        { status: 409 }
      );
    }

    // Check if wallet user exists
    const user = await prisma.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Wallet not registered' },
        { status: 404 }
      );
    }

    // Check if user is blacklisted
    if (user.isBlacklisted) {
      return NextResponse.json(
        { success: false, error: 'Wallet is blacklisted' },
        { status: 403 }
      );
    }

    // Check if user is in timeout
    if (user.timeoutUntil && user.timeoutUntil > new Date()) {
      return NextResponse.json(
        { success: false, error: `Account is in timeout until ${user.timeoutUntil.toISOString()}` },
        { status: 403 }
      );
    }

    // Update user with X account info
    await prisma.user.update({
      where: { walletAddress },
      data: {
        xId: body.xId,
        xHandle: sanitizedHandle,
      },
    });


    // Return success response
    return NextResponse.json({
      success: true,
      xHandle: sanitizedHandle,
      xId: body.xId,
    });
  } catch (error) {
    console.error('[X Link API] Error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
