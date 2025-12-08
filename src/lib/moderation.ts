/**
 * Clawed Messenger - Moderation System Utilities
 *
 * Implements the 3-strike moderation system:
 * - Strike 1: Warning + 24hr timeout from reporting community
 * - Strike 2: 7-day platform-wide timeout
 * - Strike 3: Permanent blacklist (wallet banned)
 */

import { ReportStatus, Strike, AppealStatus, Appeal } from '@prisma/client';
import { prisma } from './prisma';

// =============================================================================
// TYPES
// =============================================================================

export interface ModerationError {
  code: 'USER_NOT_FOUND' | 'REPORT_NOT_FOUND' | 'STRIKE_NOT_FOUND' |
        'ALREADY_BLACKLISTED' | 'INVALID_STRIKE_NUMBER' | 'DATABASE_ERROR' |
        'APPEAL_NOT_ALLOWED' | 'UNAUTHORIZED';
  message: string;
}

export interface ModerationResult<T> {
  success: boolean;
  data?: T;
  error?: ModerationError;
}

export interface UserModerationStatus {
  userId: string;
  walletAddress: string;
  strikeCount: number;
  isBlacklisted: boolean;
  isTimedOut: boolean;
  timeoutUntil: Date | null;
  blacklistedAt: Date | null;
  strikes: StrikeInfo[];
}

export interface StrikeInfo {
  id: string;
  strikeNumber: number;
  reason: string;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
}

export interface IssueStrikeResult {
  strike: Strike;
  newStrikeCount: number;
  isBlacklisted: boolean;
  timeoutUntil: Date | null;
}

export interface AppealResult {
  appeal: Appeal;
  message: string;
}

export interface AppealReviewResult {
  appeal: Appeal;
  strikeRemoved: boolean;
  userUpdated: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Duration of Strike 1 timeout: 24 hours */
const STRIKE_1_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Duration of Strike 2 timeout: 7 days */
const STRIKE_2_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum number of strikes before permanent blacklist */
const MAX_STRIKES = 3;

// =============================================================================
// STRIKE MANAGEMENT
// =============================================================================

/**
 * Issue a strike to a user based on a report
 *
 * Strike system:
 * - Strike 1: 24-hour timeout
 * - Strike 2: 7-day timeout
 * - Strike 3: Permanent blacklist
 *
 * @param userId - The ID of the user to issue a strike to
 * @param reportId - The ID of the report that triggered this strike
 * @param reason - The reason for the strike
 * @returns Result containing the strike information or an error
 */
export async function issueStrike(
  userId: string,
  reportId: string,
  reason: string
): Promise<ModerationResult<IssueStrikeResult>> {
  try {
    // Fetch the user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { strikes_received: true },
    });

    if (!user) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `User with ID ${userId} not found`,
        },
      };
    }

    // Check if user is already blacklisted
    if (user.isBlacklisted) {
      return {
        success: false,
        error: {
          code: 'ALREADY_BLACKLISTED',
          message: 'User is already permanently blacklisted',
        },
      };
    }

    // Verify the report exists
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return {
        success: false,
        error: {
          code: 'REPORT_NOT_FOUND',
          message: `Report with ID ${reportId} not found`,
        },
      };
    }

    // Calculate new strike number
    const newStrikeNumber = user.strikes + 1;

    if (newStrikeNumber > MAX_STRIKES) {
      return {
        success: false,
        error: {
          code: 'INVALID_STRIKE_NUMBER',
          message: 'User has already received maximum strikes',
        },
      };
    }

    // Calculate timeout based on strike number
    let timeoutUntil: Date | null = null;
    let expiresAt: Date | null = null;
    const now = new Date();

    switch (newStrikeNumber) {
      case 1:
        // Strike 1: 24-hour timeout
        timeoutUntil = new Date(now.getTime() + STRIKE_1_TIMEOUT_MS);
        expiresAt = timeoutUntil;
        break;
      case 2:
        // Strike 2: 7-day timeout
        timeoutUntil = new Date(now.getTime() + STRIKE_2_TIMEOUT_MS);
        expiresAt = timeoutUntil;
        break;
      case 3:
        // Strike 3: Permanent blacklist (no expiration)
        timeoutUntil = null;
        expiresAt = null;
        break;
    }

    // Create strike and update user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the strike record
      const strike = await tx.strike.create({
        data: {
          userId,
          reportId,
          strikeNumber: newStrikeNumber,
          reason,
          expiresAt,
        },
      });

      // Update user's strike count and status
      const updateData: {
        strikes: number;
        timeoutUntil: Date | null;
        isBlacklisted?: boolean;
        blacklistedAt?: Date;
      } = {
        strikes: newStrikeNumber,
        timeoutUntil,
      };

      // If this is strike 3, blacklist the user permanently
      if (newStrikeNumber === MAX_STRIKES) {
        updateData.isBlacklisted = true;
        updateData.blacklistedAt = now;
        updateData.timeoutUntil = null; // No timeout needed for blacklist
      }

      await tx.user.update({
        where: { id: userId },
        data: updateData,
      });

      // Update the report status
      await tx.report.update({
        where: { id: reportId },
        data: {
          status: ReportStatus.ACTION_TAKEN,
          reviewedAt: now,
        },
      });

      return strike;
    });

    return {
      success: true,
      data: {
        strike: result,
        newStrikeCount: newStrikeNumber,
        isBlacklisted: newStrikeNumber === MAX_STRIKES,
        timeoutUntil,
      },
    };
  } catch (error) {
    console.error('Error issuing strike:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to issue strike',
      },
    };
  }
}

/**
 * Get the current moderation status of a user
 *
 * @param userId - The ID of the user to check
 * @returns The user's moderation status including strikes and bans
 */
export async function checkUserStatus(
  userId: string
): Promise<ModerationResult<UserModerationStatus>> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        strikes_received: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `User with ID ${userId} not found`,
        },
      };
    }

    const now = new Date();
    const isTimedOut = user.timeoutUntil !== null && user.timeoutUntil > now;

    // Map strikes to StrikeInfo
    const strikes: StrikeInfo[] = user.strikes_received.map((strike) => ({
      id: strike.id,
      strikeNumber: strike.strikeNumber,
      reason: strike.reason,
      createdAt: strike.createdAt,
      expiresAt: strike.expiresAt,
      isActive: strike.expiresAt === null || strike.expiresAt > now,
    }));

    return {
      success: true,
      data: {
        userId: user.id,
        walletAddress: user.walletAddress,
        strikeCount: user.strikes,
        isBlacklisted: user.isBlacklisted,
        isTimedOut,
        timeoutUntil: isTimedOut ? user.timeoutUntil : null,
        blacklistedAt: user.blacklistedAt,
        strikes,
      },
    };
  } catch (error) {
    console.error('Error checking user status:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to check user status',
      },
    };
  }
}

/**
 * Check if a user is currently timed out
 *
 * @param userId - The ID of the user to check
 * @returns True if the user is timed out, false otherwise
 */
export async function isUserTimedOut(userId: string): Promise<ModerationResult<boolean>> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timeoutUntil: true, isBlacklisted: true },
    });

    if (!user) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `User with ID ${userId} not found`,
        },
      };
    }

    // Blacklisted users are effectively permanently timed out
    if (user.isBlacklisted) {
      return { success: true, data: true };
    }

    const now = new Date();
    const isTimedOut = user.timeoutUntil !== null && user.timeoutUntil > now;

    // If timeout has expired, clear it
    if (user.timeoutUntil !== null && user.timeoutUntil <= now) {
      await prisma.user.update({
        where: { id: userId },
        data: { timeoutUntil: null },
      });
    }

    return { success: true, data: isTimedOut };
  } catch (error) {
    console.error('Error checking timeout status:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to check timeout status',
      },
    };
  }
}

/**
 * Check if a user is blacklisted (permanently banned)
 *
 * @param userId - The ID of the user to check
 * @returns True if the user is blacklisted, false otherwise
 */
export async function isUserBlacklisted(userId: string): Promise<ModerationResult<boolean>> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isBlacklisted: true },
    });

    if (!user) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `User with ID ${userId} not found`,
        },
      };
    }

    return { success: true, data: user.isBlacklisted };
  } catch (error) {
    console.error('Error checking blacklist status:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to check blacklist status',
      },
    };
  }
}

/**
 * Check if a user is blacklisted by wallet address
 *
 * @param walletAddress - The Solana wallet address to check
 * @returns True if the wallet is blacklisted, false otherwise
 */
export async function isWalletBlacklisted(
  walletAddress: string
): Promise<ModerationResult<boolean>> {
  try {
    const user = await prisma.user.findUnique({
      where: { walletAddress },
      select: { isBlacklisted: true },
    });

    // If user doesn't exist, they're not blacklisted
    if (!user) {
      return { success: true, data: false };
    }

    return { success: true, data: user.isBlacklisted };
  } catch (error) {
    console.error('Error checking wallet blacklist status:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to check wallet blacklist status',
      },
    };
  }
}

/**
 * Get all active strikes for a user
 * Active strikes are those that haven't expired yet or are permanent (strike 3)
 *
 * @param userId - The ID of the user
 * @returns Array of active strikes
 */
export async function getActiveStrikes(userId: string): Promise<ModerationResult<StrikeInfo[]>> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `User with ID ${userId} not found`,
        },
      };
    }

    const now = new Date();

    const strikes = await prisma.strike.findMany({
      where: {
        userId,
        OR: [
          { expiresAt: null }, // Permanent strikes (strike 3)
          { expiresAt: { gt: now } }, // Not yet expired
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const strikeInfos: StrikeInfo[] = strikes.map((strike) => ({
      id: strike.id,
      strikeNumber: strike.strikeNumber,
      reason: strike.reason,
      createdAt: strike.createdAt,
      expiresAt: strike.expiresAt,
      isActive: true,
    }));

    return { success: true, data: strikeInfos };
  } catch (error) {
    console.error('Error getting active strikes:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get active strikes',
      },
    };
  }
}

/**
 * Submit an appeal for a strike
 *
 * Users can appeal strikes 1 and 2. Strike 3 (permanent blacklist)
 * requires contacting support directly.
 *
 * @param strikeId - The ID of the strike to appeal
 * @param userId - The ID of the user submitting the appeal
 * @param reason - The reason for the appeal
 * @returns Appeal submission result
 */
export async function appealStrike(
  strikeId: string,
  userId: string,
  reason: string
): Promise<ModerationResult<AppealResult>> {
  try {
    const strike = await prisma.strike.findUnique({
      where: { id: strikeId },
      include: { user: true, appeal: true },
    });

    if (!strike) {
      return {
        success: false,
        error: {
          code: 'STRIKE_NOT_FOUND',
          message: `Strike with ID ${strikeId} not found`,
        },
      };
    }

    // Verify the user owns this strike
    if (strike.userId !== userId) {
      return {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'You can only appeal your own strikes',
        },
      };
    }

    // Check if an appeal already exists for this strike
    if (strike.appeal) {
      return {
        success: false,
        error: {
          code: 'APPEAL_NOT_ALLOWED',
          message: 'An appeal has already been submitted for this strike',
        },
      };
    }

    // Strike 3 (permanent blacklist) cannot be appealed through normal means
    if (strike.strikeNumber === 3) {
      return {
        success: false,
        error: {
          code: 'APPEAL_NOT_ALLOWED',
          message: 'Permanent blacklist cannot be appealed through this system. Please contact support.',
        },
      };
    }

    // Check if strike has already expired
    const now = new Date();
    if (strike.expiresAt && strike.expiresAt <= now) {
      return {
        success: false,
        error: {
          code: 'APPEAL_NOT_ALLOWED',
          message: 'This strike has already expired and does not need to be appealed.',
        },
      };
    }

    // Create the appeal
    const appeal = await prisma.appeal.create({
      data: {
        strikeId,
        userId,
        reason,
        status: AppealStatus.PENDING,
      },
    });

    return {
      success: true,
      data: {
        appeal,
        message: 'Your appeal has been submitted and will be reviewed by the moderation team.',
      },
    };
  } catch (error) {
    console.error('Error submitting appeal:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to submit appeal',
      },
    };
  }
}

/**
 * Get pending appeals for admin review
 *
 * @param options - Filter options
 * @returns Array of pending appeals
 */
export async function getPendingAppeals(options?: {
  limit?: number;
  offset?: number;
}) {
  try {
    const appeals = await prisma.appeal.findMany({
      where: {
        status: AppealStatus.PENDING,
      },
      include: {
        strike: {
          include: {
            report: true,
          },
        },
        user: {
          select: {
            id: true,
            walletAddress: true,
            xHandle: true,
            strikes: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return { success: true, data: appeals };
  } catch (error) {
    console.error('Error getting pending appeals:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR' as const,
        message: error instanceof Error ? error.message : 'Failed to get pending appeals',
      },
    };
  }
}

/**
 * Approve an appeal - removes the strike and restores user status
 *
 * @param appealId - The ID of the appeal to approve
 * @param reviewerId - The ID of the admin approving the appeal
 * @param reviewNote - Optional note explaining the decision
 * @returns Result of the approval
 */
export async function approveAppeal(
  appealId: string,
  reviewerId: string,
  reviewNote?: string
): Promise<ModerationResult<AppealReviewResult>> {
  try {
    const appeal = await prisma.appeal.findUnique({
      where: { id: appealId },
      include: {
        strike: {
          include: { user: true },
        },
      },
    });

    if (!appeal) {
      return {
        success: false,
        error: {
          code: 'STRIKE_NOT_FOUND',
          message: `Appeal with ID ${appealId} not found`,
        },
      };
    }

    if (appeal.status !== AppealStatus.PENDING) {
      return {
        success: false,
        error: {
          code: 'APPEAL_NOT_ALLOWED',
          message: 'This appeal has already been reviewed',
        },
      };
    }

    const strike = appeal.strike;
    const user = strike.user;
    const now = new Date();

    // Update appeal and user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update the appeal status
      const updatedAppeal = await tx.appeal.update({
        where: { id: appealId },
        data: {
          status: AppealStatus.APPROVED,
          reviewedById: reviewerId,
          reviewNote,
          reviewedAt: now,
        },
      });

      // Decrement user's strike count
      const newStrikeCount = Math.max(0, user.strikes - 1);

      // Clear timeout if this was the strike causing it
      let newTimeoutUntil = user.timeoutUntil;
      if (strike.expiresAt && user.timeoutUntil &&
          strike.expiresAt.getTime() === user.timeoutUntil.getTime()) {
        newTimeoutUntil = null;
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          strikes: newStrikeCount,
          timeoutUntil: newTimeoutUntil,
        },
      });

      // Delete the strike record
      await tx.strike.delete({
        where: { id: strike.id },
      });

      return updatedAppeal;
    });

    return {
      success: true,
      data: {
        appeal: result,
        strikeRemoved: true,
        userUpdated: true,
      },
    };
  } catch (error) {
    console.error('Error approving appeal:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to approve appeal',
      },
    };
  }
}

/**
 * Reject an appeal - strike remains in effect
 *
 * @param appealId - The ID of the appeal to reject
 * @param reviewerId - The ID of the admin rejecting the appeal
 * @param reviewNote - Optional note explaining the decision
 * @returns Result of the rejection
 */
export async function rejectAppeal(
  appealId: string,
  reviewerId: string,
  reviewNote?: string
): Promise<ModerationResult<AppealReviewResult>> {
  try {
    const appeal = await prisma.appeal.findUnique({
      where: { id: appealId },
    });

    if (!appeal) {
      return {
        success: false,
        error: {
          code: 'STRIKE_NOT_FOUND',
          message: `Appeal with ID ${appealId} not found`,
        },
      };
    }

    if (appeal.status !== AppealStatus.PENDING) {
      return {
        success: false,
        error: {
          code: 'APPEAL_NOT_ALLOWED',
          message: 'This appeal has already been reviewed',
        },
      };
    }

    const updatedAppeal = await prisma.appeal.update({
      where: { id: appealId },
      data: {
        status: AppealStatus.REJECTED,
        reviewedById: reviewerId,
        reviewNote,
        reviewedAt: new Date(),
      },
    });

    return {
      success: true,
      data: {
        appeal: updatedAppeal,
        strikeRemoved: false,
        userUpdated: false,
      },
    };
  } catch (error) {
    console.error('Error rejecting appeal:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to reject appeal',
      },
    };
  }
}

/**
 * Get appeals for a specific user
 *
 * @param userId - The ID of the user
 * @returns Array of user's appeals
 */
export async function getUserAppeals(userId: string) {
  try {
    const appeals = await prisma.appeal.findMany({
      where: { userId },
      include: {
        strike: true,
        reviewedBy: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, data: appeals };
  } catch (error) {
    console.error('Error getting user appeals:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR' as const,
        message: error instanceof Error ? error.message : 'Failed to get user appeals',
      },
    };
  }
}

// =============================================================================
// REPORT MANAGEMENT
// =============================================================================

/**
 * Create a new report against a user
 *
 * @param reporterId - The ID of the user filing the report
 * @param reportedUserId - The ID of the user being reported
 * @param category - The category of the report
 * @param description - Description of the issue
 * @param messageId - Optional ID of the message being reported
 * @returns The created report
 */
export async function createReport(
  reporterId: string,
  reportedUserId: string,
  category: 'SPAM' | 'HARASSMENT' | 'SCAM' | 'ILLEGAL' | 'OTHER',
  description: string,
  messageId?: string
): Promise<ModerationResult<{ reportId: string }>> {
  try {
    // Verify both users exist
    const [reporter, reportedUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: reporterId } }),
      prisma.user.findUnique({ where: { id: reportedUserId } }),
    ]);

    if (!reporter) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Reporter not found',
        },
      };
    }

    if (!reportedUser) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Reported user not found',
        },
      };
    }

    // Check if reporter is blacklisted (blacklisted users can't file reports)
    if (reporter.isBlacklisted) {
      return {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Blacklisted users cannot file reports',
        },
      };
    }

    // If messageId provided, verify it exists
    if (messageId) {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        return {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Referenced message not found',
          },
        };
      }
    }

    const report = await prisma.report.create({
      data: {
        reporterId,
        reportedUserId,
        category,
        description,
        messageId,
        status: ReportStatus.PENDING,
      },
    });

    return {
      success: true,
      data: { reportId: report.id },
    };
  } catch (error) {
    console.error('Error creating report:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create report',
      },
    };
  }
}

/**
 * Get pending reports for admin review
 *
 * @param options - Filter options
 * @returns Array of pending reports
 */
export async function getPendingReports(options?: {
  category?: 'SPAM' | 'HARASSMENT' | 'SCAM' | 'ILLEGAL' | 'OTHER';
  limit?: number;
  offset?: number;
}) {
  try {
    const reports = await prisma.report.findMany({
      where: {
        status: ReportStatus.PENDING,
        ...(options?.category && { category: options.category }),
      },
      include: {
        reporter: {
          select: {
            id: true,
            walletAddress: true,
            xHandle: true,
          },
        },
        reportedUser: {
          select: {
            id: true,
            walletAddress: true,
            xHandle: true,
            strikes: true,
            isBlacklisted: true,
          },
        },
        message: {
          select: {
            id: true,
            encryptedContent: true,
            nonce: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return { success: true, data: reports };
  } catch (error) {
    console.error('Error getting pending reports:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR' as const,
        message: error instanceof Error ? error.message : 'Failed to get pending reports',
      },
    };
  }
}

/**
 * Dismiss a report without taking action
 *
 * @param reportId - The ID of the report to dismiss
 * @param reviewerId - The ID of the admin dismissing the report
 * @returns Success status
 */
export async function dismissReport(
  reportId: string,
  reviewerId: string
): Promise<ModerationResult<{ dismissed: boolean }>> {
  try {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return {
        success: false,
        error: {
          code: 'REPORT_NOT_FOUND',
          message: `Report with ID ${reportId} not found`,
        },
      };
    }

    await prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.DISMISSED,
        reviewedAt: new Date(),
        reviewedById: reviewerId,
      },
    });

    return { success: true, data: { dismissed: true } };
  } catch (error) {
    console.error('Error dismissing report:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to dismiss report',
      },
    };
  }
}

/**
 * Issue a warning to a user without a strike
 * This updates the report status without incrementing strikes
 *
 * @param reportId - The ID of the report
 * @param reviewerId - The ID of the admin issuing the warning
 * @returns Success status
 */
export async function issueWarning(
  reportId: string,
  reviewerId: string
): Promise<ModerationResult<{ warned: boolean }>> {
  try {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return {
        success: false,
        error: {
          code: 'REPORT_NOT_FOUND',
          message: `Report with ID ${reportId} not found`,
        },
      };
    }

    await prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.REVIEWED,
        reviewedAt: new Date(),
        reviewedById: reviewerId,
      },
    });

    return { success: true, data: { warned: true } };
  } catch (error) {
    console.error('Error issuing warning:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to issue warning',
      },
    };
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a user can perform actions (not timed out or blacklisted)
 *
 * @param userId - The ID of the user to check
 * @returns True if the user can perform actions
 */
export async function canUserAct(userId: string): Promise<ModerationResult<boolean>> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isBlacklisted: true, timeoutUntil: true },
    });

    if (!user) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `User with ID ${userId} not found`,
        },
      };
    }

    if (user.isBlacklisted) {
      return { success: true, data: false };
    }

    const now = new Date();
    if (user.timeoutUntil && user.timeoutUntil > now) {
      return { success: true, data: false };
    }

    return { success: true, data: true };
  } catch (error) {
    console.error('Error checking if user can act:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to check user action status',
      },
    };
  }
}

/**
 * Get the remaining timeout duration for a user
 *
 * @param userId - The ID of the user
 * @returns Remaining timeout in milliseconds, or 0 if not timed out
 */
export async function getRemainingTimeout(userId: string): Promise<ModerationResult<number>> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timeoutUntil: true, isBlacklisted: true },
    });

    if (!user) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `User with ID ${userId} not found`,
        },
      };
    }

    // Blacklisted = infinite timeout
    if (user.isBlacklisted) {
      return { success: true, data: Infinity };
    }

    if (!user.timeoutUntil) {
      return { success: true, data: 0 };
    }

    const now = new Date();
    const remaining = user.timeoutUntil.getTime() - now.getTime();

    return { success: true, data: Math.max(0, remaining) };
  } catch (error) {
    console.error('Error getting remaining timeout:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get remaining timeout',
      },
    };
  }
}

/**
 * Format a duration in milliseconds to a human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string
 */
export function formatTimeoutDuration(ms: number): string {
  if (ms === Infinity) {
    return 'Permanent';
  }

  if (ms <= 0) {
    return 'None';
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h`;
    }
    return `${days} day${days > 1 ? 's' : ''}`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }

  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

/**
 * Get strike severity label
 *
 * @param strikeCount - Number of strikes
 * @returns Severity label and color
 */
export function getStrikeSeverity(strikeCount: number): {
  label: string;
  color: 'green' | 'yellow' | 'orange' | 'red';
  description: string;
} {
  switch (strikeCount) {
    case 0:
      return {
        label: 'Good Standing',
        color: 'green',
        description: 'No strikes on record',
      };
    case 1:
      return {
        label: 'Warning',
        color: 'yellow',
        description: '1 strike - One more results in a 7-day ban',
      };
    case 2:
      return {
        label: 'Final Warning',
        color: 'orange',
        description: '2 strikes - Next strike is a permanent ban',
      };
    case 3:
    default:
      return {
        label: 'Blacklisted',
        color: 'red',
        description: 'Permanently banned from the platform',
      };
  }
}
