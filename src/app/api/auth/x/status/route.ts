/**
 * X Account Status API Route
 *
 * GET /api/auth/x/status?wallet=<address>
 *
 * Returns the X account linking status for a given wallet address.
 * Used by the frontend to check if a wallet has linked X account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Check if X OAuth is configured
 */
function checkXAuthConfigured(): boolean {
  return !!(
    process.env.TWITTER_CLIENT_ID &&
    process.env.TWITTER_CLIENT_SECRET &&
    process.env.NEXTAUTH_SECRET
  );
}

/**
 * GET handler - Fetch X account status for a wallet
 */
export async function GET(request: NextRequest) {
  try {
    // Check if X auth is configured
    if (!checkXAuthConfigured()) {
      return NextResponse.json(
        {
          linked: false,
          xVerified: false,
          message: 'X authentication is not configured',
        },
        { status: 501 }
      );
    }

    // Get wallet address from query params
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet');

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    // Validate wallet address format (basic Solana address validation)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Query user's X linking status
    const user = await prisma.user.findUnique({
      where: { walletAddress },
      select: {
        xHandle: true,
        xId: true,
      },
    });

    if (!user || !user.xHandle) {
      // User doesn't exist or has no X linked
      return NextResponse.json({
        linked: false,
      });
    }

    // Return X account status
    return NextResponse.json({
      linked: true,
      xHandle: user.xHandle,
      xId: user.xId,
    });
  } catch (error) {
    console.error('[X Status API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
