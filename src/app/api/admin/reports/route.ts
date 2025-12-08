/**
 * /api/admin/reports
 * Admin report management
 *
 * GET: List pending reports
 * PUT: Review report and optionally issue strike
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
import { createReportSchema, reviewReportSchema } from '@/lib/validation';
import { issueStrike } from '@/lib/moderation';
import type {
  ReportResponse,
  ReportListResponse,
  CreateReportRequest,
  ReviewReportRequest,
  ReviewReportResponse,
} from '@/types/api';
import { ReportStatus, ReportCategory, Prisma } from '@prisma/client';

export { OPTIONS };

// Admin wallet addresses (in production, store in database or config)
// These are community owners or designated platform admins
const PLATFORM_ADMINS = (process.env.PLATFORM_ADMIN_WALLETS || '').split(',').filter(Boolean);

/**
 * Check if a user is a platform admin
 */
async function isPlatformAdmin(walletAddress: string): Promise<boolean> {
  // Check if in platform admin list
  if (PLATFORM_ADMINS.includes(walletAddress)) {
    return true;
  }

  // Check if user owns any community (community owners can review reports in their communities)
  const ownedCommunities = await prisma.community.findFirst({
    where: {
      owner: { walletAddress },
    },
  });

  return !!ownedCommunities;
}

/**
 * Get all community IDs owned by a user
 */
async function getOwnedCommunityIds(walletAddress: string): Promise<string[]> {
  const communities = await prisma.community.findMany({
    where: {
      owner: { walletAddress },
    },
    select: { id: true },
  });

  return communities.map((c) => c.id);
}

/**
 * GET /api/admin/reports
 * List pending reports (admin only)
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit')
    );

    // Filter parameters
    const status = searchParams.get('status') as ReportStatus | null;
    const category = searchParams.get('category');

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

    // Build query
    const whereClause: Prisma.ReportWhereInput = {};

    if (status) {
      const validStatuses: ReportStatus[] = ['PENDING', 'REVIEWED', 'DISMISSED', 'ACTION_TAKEN'];
      if (validStatuses.includes(status as ReportStatus)) {
        whereClause.status = status as ReportStatus;
      }
    } else {
      // Default to pending reports
      whereClause.status = 'PENDING';
    }

    if (category) {
      const validCategories: ReportCategory[] = ['SPAM', 'HARASSMENT', 'SCAM', 'ILLEGAL', 'OTHER'];
      if (validCategories.includes(category as ReportCategory)) {
        whereClause.category = category as ReportCategory;
      }
    }

    // Apply authorization scope: community owners can only see reports from their communities
    if (!PLATFORM_ADMINS.includes(user.walletAddress)) {
      const ownedCommunityIds = await getOwnedCommunityIds(user.walletAddress);

      whereClause.message = {
        channel: {
          communityId: {
            in: ownedCommunityIds,
          },
        },
      };
    }

    // Fetch reports with related data
    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where: whereClause,
        include: {
          reporter: {
            select: {
              walletAddress: true,
              xHandle: true,
            },
          },
          reportedUser: {
            select: {
              walletAddress: true,
              xHandle: true,
            },
          },
          reviewedBy: {
            select: {
              walletAddress: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.report.count({ where: whereClause }),
    ]);

    // Build response - no internal IDs exposed
    const response: ReportListResponse = {
      reports: reports.map((r) => ({
        id: r.id,
        reporterWallet: r.reporter.walletAddress,
        reportedUserWallet: r.reportedUser.walletAddress,
        messageId: r.messageId,
        category: r.category,
        description: r.description,
        status: r.status,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewedByWallet: r.reviewedBy?.walletAddress ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      hasMore: skip + reports.length < total,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /admin/reports error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * PUT /api/admin/reports
 * Review a report and optionally issue a strike
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

    // Get report ID from query params
    const { searchParams } = new URL(req.url);
    const reportId = searchParams.get('reportId');

    if (!reportId) {
      return createErrorResponse('reportId query parameter is required', 400);
    }

    // Parse and validate request body
    const body = await req.json();
    const validationResult = reviewReportSchema.safeParse(body);

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const { status, issueStrike: shouldIssueStrike, strikeReason } = validationResult.data;

    // Fetch the report
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: {
        reportedUser: true,
        reporter: {
          select: { walletAddress: true },
        },
        message: {
          include: {
            channel: {
              include: {
                community: {
                  include: {
                    owner: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!report) {
      return createErrorResponse('Report not found', 404);
    }

    if (!PLATFORM_ADMINS.includes(user.walletAddress)) {
      const communityOwnerId = report.message?.channel?.community?.owner?.walletAddress;

      if (communityOwnerId !== user.walletAddress) {
        return createErrorResponse('You can only review reports from your own communities', 403);
      }
    }

    // Check if already reviewed
    if (report.status !== 'PENDING') {
      return createErrorResponse('Report has already been reviewed', 400);
    }

    // Check if reported user is already blacklisted
    if (report.reportedUser.isBlacklisted) {
      return createErrorResponse('Reported user is already banned', 400);
    }

    let strikeResult: {
      newStrikeCount: number;
      isBlacklisted: boolean;
      timeoutUntil: Date | null;
    } | null = null;

    // Issue strike if requested
    if (shouldIssueStrike && status === 'ACTION_TAKEN') {
      const sanitizedReason = sanitizeInput(strikeReason!.trim());

      try {
        const result = await issueStrike(
          report.reportedUserId,
          reportId,
          sanitizedReason
        );

        if (result.success && result.data) {
          strikeResult = {
            newStrikeCount: result.data.newStrikeCount,
            isBlacklisted: result.data.isBlacklisted,
            timeoutUntil: result.data.timeoutUntil,
          };
        } else {
          console.error('[API] Failed to issue strike:', result.error);
          return createErrorResponse(result.error?.message || 'Failed to issue strike', 500);
        }
      } catch (error) {
        console.error('[API] Failed to issue strike:', error);
        return createErrorResponse('Failed to issue strike', 500);
      }
    }

    // Update the report
    const updatedReport = await prisma.report.update({
      where: { id: reportId },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedById: user.id,
      },
      include: {
        reporter: {
          select: {
            walletAddress: true,
          },
        },
        reportedUser: {
          select: {
            walletAddress: true,
          },
        },
        reviewedBy: {
          select: {
            walletAddress: true,
          },
        },
      },
    });

    // Build response - no internal IDs exposed
    const response: ReviewReportResponse = {
      success: true,
      report: {
        id: updatedReport.id,
        reporterWallet: updatedReport.reporter.walletAddress,
        reportedUserWallet: updatedReport.reportedUser.walletAddress,
        messageId: updatedReport.messageId,
        category: updatedReport.category,
        description: updatedReport.description,
        status: updatedReport.status,
        reviewedAt: updatedReport.reviewedAt?.toISOString() ?? null,
        reviewedByWallet: updatedReport.reviewedBy?.walletAddress ?? null,
        createdAt: updatedReport.createdAt.toISOString(),
      },
      strikeIssued: !!strikeResult,
      newStrikeCount: strikeResult?.newStrikeCount,
      userBlacklisted: strikeResult?.isBlacklisted,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] PUT /admin/reports error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
