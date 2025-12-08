/**
 * Appeals API Routes
 *
 * POST /api/appeals - Submit an appeal for a strike
 * GET /api/appeals - Get user's own appeals
 */

import { NextRequest } from 'next/server';
import {
  authenticateRequest,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { createAppealSchema } from '@/lib/validation';
import { appealStrike, getUserAppeals } from '@/lib/moderation';

export { OPTIONS };

/**
 * POST /api/appeals
 * Submit an appeal for a strike
 *
 * Request body:
 * {
 *   strikeId: string,
 *   reason: string
 * }
 */
export async function POST(req: NextRequest): Promise<Response> {
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

    // Parse and validate request body
    const body = await req.json();
    const validationResult = createAppealSchema.safeParse(body);

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const { strikeId, reason } = validationResult.data;

    const sanitizedReason = sanitizeInput(reason);

    const result = await appealStrike(strikeId, user.id, sanitizedReason);

    if (!result.success) {
      const statusCode = result.error?.code === 'STRIKE_NOT_FOUND' ? 404 :
                         result.error?.code === 'UNAUTHORIZED' ? 403 :
                         result.error?.code === 'APPEAL_NOT_ALLOWED' ? 400 : 500;
      return createErrorResponse(result.error?.message || 'Failed to submit appeal', statusCode);
    }

    return createSuccessResponse({
      success: true,
      appealId: result.data?.appeal.id,
      message: result.data?.message,
    }, 201);
  } catch (error) {
    console.error('[API] POST /appeals error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * GET /api/appeals
 * Get the authenticated user's appeals
 */
export async function GET(req: NextRequest): Promise<Response> {
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

    // Get user's appeals
    const result = await getUserAppeals(user.id);

    if (!result.success) {
      return createErrorResponse(result.error?.message || 'Failed to get appeals', 500);
    }

    return createSuccessResponse({
      success: true,
      appeals: result.data,
    });
  } catch (error) {
    console.error('[API] GET /appeals error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
