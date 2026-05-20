/**
 * Void Chat - Community-Driven Moderation System
 *
 * Every member is equal. No admins. No hierarchy.
 * Reports accumulate per-community. At threshold, user is auto-kicked.
 * Kicked from enough communities = automatic platform ban.
 */

import { prisma } from './prisma.js';

const PLATFORM_BAN_THRESHOLD = 3;

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
  dynamicThreshold: number;
}

export async function fileReport(
  reporterId: string,
  reportedUserId: string,
  communityId: string,
  category: 'SPAM' | 'HARASSMENT' | 'SCAM' | 'ILLEGAL' | 'OTHER',
  description: string,
  messageRef?: string
): Promise<ModerationResult<ReportResult>> {
  try {
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

    if (reporterMembership.joinedAt >= reportedMembership.joinedAt) {
      return { success: false, error: 'Cannot report members who joined before you' };
    }

    const existingReport = await prisma.report.findUnique({
      where: {
        reporterId_reportedUserId_communityId: {
          reporterId,
          reportedUserId,
          communityId,
        },
      },
    });

    if (existingReport) {
      return { success: false, error: 'You have already reported this user in this community' };
    }

    const existingKick = await prisma.communityKick.findUnique({
      where: {
        userId_communityId: { userId: reportedUserId, communityId },
      },
    });

    if (existingKick) {
      return { success: false, error: 'This user has already been kicked from this community' };
    }

    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { reportThreshold: true },
    });

    if (!community) {
      return { success: false, error: 'Community not found' };
    }

    const memberCount = await prisma.membership.count({
      where: { communityId },
    });
    const dynamicThreshold = Math.max(3, Math.ceil(memberCount / 9));
    const threshold = Math.max(dynamicThreshold, community.reportThreshold);

    await prisma.report.create({
      data: {
        reporterId,
        reportedUserId,
        communityId,
        category,
        description,
        messageRef: messageRef || null,
      },
    });

    const reportCount = await prisma.report.count({
      where: {
        reportedUserId,
        communityId,
        reporter: {
          memberships: {
            some: {
              communityId,
              joinedAt: { lt: reportedMembership.joinedAt },
            },
          },
        },
      },
    });

    let userKicked = false;
    let userBanned = false;

    if (reportCount >= threshold) {
      await prisma.$transaction([
        prisma.membership.delete({
          where: { userId_communityId: { userId: reportedUserId, communityId } },
        }),
        prisma.communityKick.create({
          data: {
            userId: reportedUserId,
            communityId,
            reportCount,
          },
        }),
      ]);

      userKicked = true;

      const totalKicks = await prisma.communityKick.count({
        where: { userId: reportedUserId },
      });

      if (totalKicks >= PLATFORM_BAN_THRESHOLD) {
        await prisma.user.update({
          where: { id: reportedUserId },
          data: { isBlacklisted: true },
        });
        userBanned = true;
      }
    }

    return {
      success: true,
      data: {
        reported: true,
        userKicked,
        userBanned,
        reportCount,
        threshold,
        dynamicThreshold,
      },
    };
  } catch (error) {
    console.error('[Moderation] fileReport error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to file report',
    };
  }
}

export async function isUserBanned(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBlacklisted: true },
  });
  return user?.isBlacklisted ?? false;
}

export async function isPublicIdBanned(publicId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { publicId },
    select: { isBlacklisted: true },
  });
  return user?.isBlacklisted ?? false;
}

export async function isKickedFromCommunity(
  userId: string,
  communityId: string
): Promise<boolean> {
  const kick = await prisma.communityKick.findUnique({
    where: { userId_communityId: { userId, communityId } },
  });
  return !!kick;
}
