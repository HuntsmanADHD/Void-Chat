/**
 * Notifications Library
 * Server-side functions for creating and managing notifications
 */

import { prisma } from '@/lib/prisma';
import type { NotificationType } from '@prisma/client';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  messageId?: string;
  channelId?: string;
  communityId?: string;
  senderId?: string;
}

/**
 * Create a new notification
 */
export async function createNotification(params: CreateNotificationParams) {
  const { userId, type, title, body, messageId, channelId, communityId, senderId } = params;

  // Don't create self-notifications
  if (senderId && senderId === userId) {
    return null;
  }

  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body: body || null,
      messageId: messageId || null,
      channelId: channelId || null,
      communityId: communityId || null,
      senderId: senderId || null,
    },
    include: {
      sender: {
        select: {
          walletAddress: true,
          xHandle: true,
        },
      },
    },
  });

  return notification;
}

/**
 * Create a DM received notification
 */
export async function notifyDmReceived(
  recipientId: string,
  senderId: string,
  messageId: string,
  senderDisplayName: string
) {
  return createNotification({
    userId: recipientId,
    type: 'DM_RECEIVED',
    title: 'New Direct Message',
    body: `${senderDisplayName} sent you a message`,
    messageId,
    senderId,
  });
}

/**
 * Create a mention notification
 */
export async function notifyMention(
  userId: string,
  senderId: string,
  messageId: string,
  channelId: string,
  communityId: string,
  senderDisplayName: string,
  channelName: string
) {
  return createNotification({
    userId,
    type: 'MENTION',
    title: 'You were mentioned',
    body: `${senderDisplayName} mentioned you in #${channelName}`,
    messageId,
    channelId,
    communityId,
    senderId,
  });
}

/**
 * Create a reaction notification
 */
export async function notifyReaction(
  messageOwnerId: string,
  reactorId: string,
  messageId: string,
  channelId: string | null,
  reactorDisplayName: string,
  emoji: string
) {
  return createNotification({
    userId: messageOwnerId,
    type: 'REACTION',
    title: 'New Reaction',
    body: `${reactorDisplayName} reacted with ${emoji}`,
    messageId,
    channelId: channelId || undefined,
    senderId: reactorId,
  });
}

/**
 * Create a community invite notification
 */
export async function notifyCommunityInvite(
  userId: string,
  inviterId: string,
  communityId: string,
  communityName: string,
  inviterDisplayName: string
) {
  return createNotification({
    userId,
    type: 'COMMUNITY_INVITE',
    title: 'Community Invitation',
    body: `${inviterDisplayName} invited you to join ${communityName}`,
    communityId,
    senderId: inviterId,
  });
}

/**
 * Create a strike received notification
 */
export async function notifyStrikeReceived(
  userId: string,
  strikeNumber: number,
  reason: string
) {
  let title: string;
  let body: string;

  switch (strikeNumber) {
    case 1:
      title = 'Warning: Strike 1';
      body = `You received a warning. Reason: ${reason}. 24-hour timeout applied.`;
      break;
    case 2:
      title = 'Strike 2 Issued';
      body = `You received Strike 2. Reason: ${reason}. 7-day platform-wide timeout applied.`;
      break;
    case 3:
      title = 'Account Permanently Banned';
      body = `Strike 3 issued. Reason: ${reason}. Your account has been permanently blacklisted.`;
      break;
    default:
      title = 'Strike Notification';
      body = reason;
  }

  return createNotification({
    userId,
    type: 'STRIKE_RECEIVED',
    title,
    body,
  });
}

/**
 * Create an appeal update notification
 */
export async function notifyAppealUpdate(
  userId: string,
  appealStatus: 'APPROVED' | 'REJECTED',
  reviewNote?: string
) {
  const isApproved = appealStatus === 'APPROVED';

  return createNotification({
    userId,
    type: 'APPEAL_UPDATE',
    title: isApproved ? 'Appeal Approved' : 'Appeal Rejected',
    body: reviewNote || (isApproved
      ? 'Your appeal has been approved and the strike has been removed.'
      : 'Your appeal has been rejected. The strike will remain on your account.'),
  });
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      userId,
      read: false,
    },
  });
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(
  userId: string,
  page: number = 1,
  limit: number = 20
) {
  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      include: {
        sender: {
          select: {
            walletAddress: true,
            xHandle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);

  return {
    notifications,
    total,
    unreadCount,
    page,
    limit,
    hasMore: skip + notifications.length < total,
  };
}

/**
 * Mark notifications as read
 */
export async function markNotificationsRead(
  userId: string,
  notificationIds?: string[]
) {
  const where = notificationIds && notificationIds.length > 0
    ? { userId, id: { in: notificationIds }, read: false }
    : { userId, read: false };

  const result = await prisma.notification.updateMany({
    where,
    data: { read: true },
  });

  return result.count;
}

/**
 * Delete old read notifications (cleanup job)
 */
export async function deleteOldNotifications(daysOld: number = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await prisma.notification.deleteMany({
    where: {
      read: true,
      createdAt: { lt: cutoffDate },
    },
  });

  return result.count;
}
