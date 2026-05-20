/**
 * Notifications Library
 *
 * Notifications are now handled client-side via socket events.
 * These functions are kept as no-ops to maintain call-site compatibility.
 */

/**
 * Create a DM received notification (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function notifyDmReceived(
  _recipientId: string,
  _senderId: string,
  _messageId: string,
  _senderDisplayName: string
) {
  return null;
}

/**
 * Create a mention notification (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function notifyMention(
  _userId: string,
  _senderId: string,
  _messageId: string,
  _channelId: string,
  _communityId: string,
  _senderDisplayName: string,
  _channelName: string
) {
  return null;
}

/**
 * Create a reaction notification (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function notifyReaction(
  _messageOwnerId: string,
  _reactorId: string,
  _messageId: string,
  _channelId: string | null,
  _reactorDisplayName: string,
  _emoji: string
) {
  return null;
}

/**
 * Create a community invite notification (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function notifyCommunityInvite(
  _userId: string,
  _inviterId: string,
  _communityId: string,
  _communityName: string,
  _inviterDisplayName: string
) {
  return null;
}

/**
 * Create a community kicked notification (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function notifyCommunityKicked(
  _userId: string,
  _communityId: string,
  _communityName: string
) {
  return null;
}

/**
 * Create a platform banned notification (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function notifyPlatformBanned(_userId: string) {
  return null;
}

/**
 * Get unread notification count (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function getUnreadNotificationCount(_userId: string): Promise<number> {
  return 0;
}

/**
 * Get notifications for a user (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function getUserNotifications(
  _userId: string,
  page: number = 1,
  limit: number = 20
) {
  return {
    notifications: [],
    total: 0,
    unreadCount: 0,
    page,
    limit,
    hasMore: false,
  };
}

/**
 * Mark notifications as read (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function markNotificationsRead(
  _userId: string,
  _notificationIds?: string[]
) {
  return 0;
}

/**
 * Delete old read notifications (no-op)
 * Notifications are now handled client-side via socket events.
 */
export async function deleteOldNotifications(_daysOld: number = 30) {
  return 0;
}
