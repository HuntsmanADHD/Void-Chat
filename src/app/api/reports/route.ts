/**
 * POST /api/reports
 * File a report against a user in a community
 *
 * Request body:
 * {
 *   reportedUserId: string,
 *   communityId: string,
 *   messageRef?: string,  // plain string reference, not a DB foreign key
 *   category: ReportCategory,
 *   description: string
 * }
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  sanitizeInput,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { createReportSchema } from '@/lib/validation';
import { fileReport } from '@/lib/moderation';
import type { CreateReportRequest, CreateReportResponse } from '@/types/api';

export { OPTIONS };

/**
 * POST /api/reports
 * File a community report
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
    const validationResult = createReportSchema.safeParse(body);

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const { reportedUserId, communityId, messageId: messageRef, category, description } = validationResult.data;

    // Sanitize description
    const sanitizedDescription = sanitizeInput(description);

    // Cannot report yourself
    if (reportedUserId === user.id) {
      return createErrorResponse('Cannot report yourself', 400);
    }

    // Verify reported user exists
    const reportedUser = await prisma.user.findUnique({
      where: { id: reportedUserId },
    });

    if (!reportedUser) {
      return createErrorResponse('Reported user not found', 404);
    }

    // Already blacklisted users don't need more reports
    if (reportedUser.isBlacklisted) {
      return createErrorResponse('This user is already banned', 400);
    }

    // messageRef is a plain string reference — messages are no longer stored in the DB
    // so we skip any message existence/ownership verification

    // File the report through the moderation system
    // This handles: duplicate checking, anti-raid, threshold auto-kick, platform ban
    const result = await fileReport(
      user.id,
      reportedUserId,
      communityId,
      category,
      sanitizedDescription,
      messageRef
    );

    if (!result.success || !result.data) {
      return createErrorResponse(result.error || 'Failed to process report', 400);
    }

    // Build response
    const response: CreateReportResponse = {
      success: true,
      reported: result.data.reported,
      userKicked: result.data.userKicked,
      userBanned: result.data.userBanned,
      reportCount: result.data.reportCount,
      threshold: result.data.threshold,
    };

    return createSuccessResponse(response, 201);
  } catch (error) {
    console.error('[API] POST /reports error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
