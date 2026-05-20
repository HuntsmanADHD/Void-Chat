/**
 * Void Chat - Community-Driven Moderation System
 *
 * Every member is equal. No admins. No hierarchy.
 * Reports accumulate per-community. At threshold, user is auto-kicked.
 * Kicked from enough communities = automatic platform ban.
 */

import { prisma } from './prisma';

// Platform ban threshold: kicked from this many communities = permanent ban
const PLATFORM_BAN_THRESHOLD = 3;

// Types
export interface ModerationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ReportResult {
  reported: boolean;
  userKicked: boolean;
  userBanned: boolean;
  reportCount: number;
  threshold: number;
}

/**
 * File a report against a user in a community.
 * If the report count hits the community threshold, the user is auto-kicked.
 * If the user has been kicked from enough communities, they are platform-banned.
 *
 * Anti-raid: only counts reports from members who joined before the reported user.
 */
export async function fileReport(
  reporterId: string,
  reportedUserId: string,
  communityId: string,
  category: 'SPAM' | 'HARASSMENT' | 'SCAM' | 'ILLEGAL' | 'OTHER',
  description: string,
  messageId?: string
): Promise<ModerationResult<ReportResult>> {
  try {
    // Verify both users are members of this community
    const [reporterMembership, reportedMembership] = await Promise.all([
      prisma.membership.findUnique({
        where: { userId_communityId: { userId: reporterId, communityId } },
      }),
      prisma.membership.findUnique({
        where: { userId_communityId: { userId: reportedUserId, communityId } },
      }),
    ]);

    if (!reporterMembership) {
      return { success: false, error: 'You are not a member of this community' };
    }

    if (!reportedMembership) {
      return { success: false, error: 'Reported user is not a member of this community' };
    }

    // Anti-raid: reporter must have joined before the reported user
    if (reporterMembership.joinedAt > reportedMembership.joinedAt) {
      return { success: false, error: 'Cannot report members who joined before you' };
    }

    // All checks and mutations in a single transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Check if already reported this user in this community
      const existingReport = await tx.report.findUnique({
        where: {
          reporterId_reportedUserId_communityId: {
            reporterId,
            reportedUserId,
            communityId,
          },
        },
      });

      if (existingReport) {
        return { success: false as const, error: 'You have already reported this user in this community' };
      }

      // Check if user was already kicked from this community
      const existingKick = await tx.communityKick.findUnique({
        where: {
          userId_communityId: { userId: reportedUserId, communityId },
        },
      });

      if (existingKick) {
        return { success: false as const, error: 'This user has already been kicked from this community' };
      }

      // Get community threshold
      const community = await tx.community.findUnique({
        where: { id: communityId },
        select: { reportThreshold: true },
      });

      if (!community) {
        return { success: false as const, error: 'Community not found' };
      }

      // Create the report
      await tx.report.create({
        data: {
          reporterId,
          reportedUserId,
          communityId,
          category,
          description,
          messageId: messageId || null,
        },
      });

      // Count unique reports against this user in this community
      // Only from members who joined BEFORE the reported user (anti-raid)
      const eligibleReporters = await tx.membership.findMany({
        where: { communityId, joinedAt: { lt: reportedMembership.joinedAt } },
        select: { userId: true },
      });
      const reporterIds = eligibleReporters.map(r => r.userId);
      const reportCount = await tx.report.count({
        where: { reportedUserId, communityId, reporterId: { in: reporterIds } },
      });

      let userKicked = false;
      let userBanned = false;

      // Check if threshold is met
      if (reportCount >= community.reportThreshold) {
        // Auto-kick: remove membership and record the kick
        await tx.membership.delete({
          where: { userId_communityId: { userId: reportedUserId, communityId } },
        });
        await tx.communityKick.create({
          data: {
            userId: reportedUserId,
            communityId,
            reportCount,
          },
        });

        userKicked = true;

        // Check platform ban threshold
        const totalKicks = await tx.communityKick.count({
          where: { userId: reportedUserId },
        });

        if (totalKicks >= PLATFORM_BAN_THRESHOLD) {
          await tx.user.update({
            where: { id: reportedUserId },
            data: { isBlacklisted: true },
          });
          userBanned = true;
        }
      }

      return {
        success: true as const,
        data: {
          reported: true,
          userKicked,
          userBanned,
          reportCount,
          threshold: community.reportThreshold,
        },
      };
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    console.error('[Moderation] fileReport error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to file report',
    };
  }
}

/**
 * Check if a user is banned from the platform
 */
export async function isUserBanned(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBlacklisted: true },
  });
  return user?.isBlacklisted ?? false;
}

/**
 * Check if a user is banned by publicId
 */
export async function isPublicIdBanned(publicId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { publicId },
    select: { isBlacklisted: true },
  });
  return user?.isBlacklisted ?? false;
}

/**
 * Get a user's kick count across all communities
 */
export async function getKickCount(userId: string): Promise<number> {
  return prisma.communityKick.count({ where: { userId } });
}

/**
 * Check if a user has been kicked from a specific community
 */
export async function isKickedFromCommunity(
  userId: string,
  communityId: string
): Promise<boolean> {
  const kick = await prisma.communityKick.findUnique({
    where: { userId_communityId: { userId, communityId } },
  });
  return !!kick;
}
