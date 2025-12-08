/**
 * X Account Unlink API Route
 *
 * POST /api/auth/x/unlink
 *
 * Unlinks an X (Twitter) account from a wallet-based user.
 * Requires wallet authentication via headers.
 *
 * Headers:
 * - x-wallet-address: Wallet public key
 * - x-wallet-signature: Signature of auth message
 * - x-auth-message: The signed auth message
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyWalletSignature, isAuthMessageValid } from '@/lib/solana';
import { prisma } from '@/lib/prisma';

/**
 * POST handler - Unlink X account from wallet
 */
export async function POST(request: NextRequest) {
  try {
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

    // Get user and check if X is linked
    const user = await prisma.user.findUnique({
      where: { walletAddress },
      select: {
        id: true,
        xId: true,
        xHandle: true,
        isBlacklisted: true,
        timeoutUntil: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Wallet not registered' },
        { status: 404 }
      );
    }

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

    if (!user.xId) {
      return NextResponse.json(
        { success: false, error: 'No X account linked' },
        { status: 400 }
      );
    }

    // Remove X account link
    await prisma.user.update({
      where: { walletAddress },
      data: {
        xId: null,
        xHandle: null,
        updatedAt: new Date(),
      },
    });


    // Return success response
    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('[X Unlink API] Error:', error);

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
