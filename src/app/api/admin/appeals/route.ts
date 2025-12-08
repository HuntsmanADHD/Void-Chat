/**
 * /api/admin/appeals
 * Admin appeal management
 *
 * GET: List pending appeals
 * PUT: Review appeal (approve or reject)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  validatePagination,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { reviewAppealSchema } from '@/lib/validation';
import { getPendingAppeals, approveAppeal, rejectAppeal } from '@/lib/moderation';

export { OPTIONS };

// Admin wallet addresses (in production, store in database or config)
const PLATFORM_ADMINS = (process.env.PLATFORM_ADMIN_WALLETS || '').split(',').filter(Boolean);

/**
 * Check if a user is a platform admin
 */
async function isPlatformAdmin(walletAddress: string): Promise<boolean> {
  // Check if in platform admin list
  if (PLATFORM_ADMINS.includes(walletAddress)) {
    return true;
  }

  // Check if user owns any community
  const ownedCommunities = await prisma.community.findFirst({
    where: {
      owner: { walletAddress },
    },
  });

  return !!ownedCommunities;
}

/**
 * GET /api/admin/appeals
 * List pending appeals (admin only)
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit')
    );

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Verify admin privileges
    const isAdmin = await isPlatformAdmin(user.walletAddress);
    if (!isAdmin) {
      return createErrorResponse('Admin access required', 403);
    }

    // Get pending appeals
    const result = await getPendingAppeals({ limit, offset: skip });

    if (!result.success) {
      return createErrorResponse(result.error?.message || 'Failed to get appeals', 500);
    }

    // Count total pending appeals
    const total = await prisma.appeal.count({
      where: { status: 'PENDING' },
    });

    return createSuccessResponse({
      appeals: result.data?.map((appeal) => ({
        id: appeal.id,
        strikeId: appeal.strikeId,
        userWallet: appeal.user.walletAddress,
        userXHandle: appeal.user.xHandle,
        userStrikeCount: appeal.user.strikes,
        strikeNumber: appeal.strike.strikeNumber,
        strikeReason: appeal.strike.reason,
        appealReason: appeal.reason,
        createdAt: appeal.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      hasMore: skip + (result.data?.length || 0) < total,
    });
  } catch (error) {
    console.error('[API] GET /admin/appeals error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * PUT /api/admin/appeals
 * Review an appeal (approve or reject)
 *
 * Query params:
 *   appealId: string
 *
 * Request body:
 * {
 *   action: 'approve' | 'reject',
 *   reviewNote?: string
 * }
 */
export async function PUT(req: NextRequest): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Verify admin privileges
    const isAdmin = await isPlatformAdmin(user.walletAddress);
    if (!isAdmin) {
      return createErrorResponse('Admin access required', 403);
    }

    // Get appeal ID from query params
    const { searchParams } = new URL(req.url);
    const appealId = searchParams.get('appealId');

    if (!appealId) {
      return createErrorResponse('appealId query parameter is required', 400);
    }

    // Parse and validate request body
    const body = await req.json();
    const validationResult = reviewAppealSchema.safeParse(body);

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const { action, reviewNote } = validationResult.data;

    // Sanitize review note if provided (already validated by Zod)
    const sanitizedNote = reviewNote ? sanitizeInput(reviewNote) : undefined;

    // Process the appeal
    let result;
    if (action === 'approve') {
      result = await approveAppeal(appealId, user.id, sanitizedNote);
    } else {
      result = await rejectAppeal(appealId, user.id, sanitizedNote);
    }

    if (!result.success) {
      const statusCode = result.error?.code === 'STRIKE_NOT_FOUND' ? 404 :
                         result.error?.code === 'APPEAL_NOT_ALLOWED' ? 400 : 500;
      return createErrorResponse(result.error?.message || 'Failed to process appeal', statusCode);
    }

    return createSuccessResponse({
      success: true,
      action,
      appealId,
      strikeRemoved: result.data?.strikeRemoved,
      userUpdated: result.data?.userUpdated,
    });
  } catch (error) {
    console.error('[API] PUT /admin/appeals error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
