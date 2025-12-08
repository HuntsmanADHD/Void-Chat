/**
 * POST /api/reports
 * Create a new report against a user
 *
 * Request body:
 * {
 *   reportedUserId: string,
 *   messageId?: string,
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
import type { CreateReportRequest, CreateReportResponse } from '@/types/api';
import type { ReportCategory } from '@prisma/client';

export { OPTIONS };

// Valid report categories
const VALID_CATEGORIES: ReportCategory[] = ['SPAM', 'HARASSMENT', 'SCAM', 'ILLEGAL', 'OTHER'];

/**
 * POST /api/reports
 * Create a new report
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

    const { reportedUserId, messageId, category, description } = validationResult.data;

    // Sanitize description (already validated by Zod)
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

    // Verify message exists if provided
    if (messageId) {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        return createErrorResponse('Referenced message not found', 404);
      }

      // Verify the message was sent by the reported user
      if (message.senderId !== reportedUserId) {
        return createErrorResponse(
          'Message was not sent by the reported user',
          400
        );
      }
    }

    // Check for duplicate recent reports from the same user
    const recentReport = await prisma.report.findFirst({
      where: {
        reporterId: user.id,
        reportedUserId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Within last 24 hours
        },
      },
    });

    if (recentReport) {
      return createErrorResponse(
        'You have already reported this user in the last 24 hours',
        429
      );
    }

    // Create the report
    const report = await prisma.report.create({
      data: {
        reporterId: user.id,
        reportedUserId,
        messageId: messageId || null,
        category,
        description: sanitizedDescription,
        status: 'PENDING',
      },
    });

    // Build response
    const response: CreateReportResponse = {
      success: true,
      reportId: report.id,
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
