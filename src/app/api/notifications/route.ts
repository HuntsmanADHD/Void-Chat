/**
 * GET /api/notifications
 * Get notifications for the authenticated user
 *
 * Query params:
 * - page: number (default 1)
 * - limit: number (default 20, max 50)
 *
 * PUT /api/notifications
 * Mark notifications as read
 *
 * Request body:
 * {
 *   notificationIds?: string[] // If empty, marks all as read
 * }
 */

import { NextRequest } from 'next/server';
import {
  authenticateRequest,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { getUserNotifications, markNotificationsRead } from '@/lib/notifications';
import type {
  NotificationListResponse,
  MarkNotificationsReadRequest,
  MarkNotificationsReadResponse,
} from '@/types/api';

export { OPTIONS };

/**
 * GET /api/notifications
 * Get user's notifications
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

    // Parse query params
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    // Get notifications
    const result = await getUserNotifications(user.id, page, limit);

    // Format response
    const response: NotificationListResponse = {
      notifications: result.notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        read: n.read,
        messageId: n.messageId,
        channelId: n.channelId,
        communityId: n.communityId,
        senderId: n.senderId,
        senderWallet: n.sender?.walletAddress || null,
        senderXHandle: n.sender?.xHandle || null,
        createdAt: n.createdAt.toISOString(),
      })),
      total: result.total,
      unreadCount: result.unreadCount,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /notifications error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * PUT /api/notifications
 * Mark notifications as read
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

    // Parse request body
    const body = await req.json() as MarkNotificationsReadRequest;
    const { notificationIds } = body;

    // Validate notificationIds if provided
    if (notificationIds !== undefined && !Array.isArray(notificationIds)) {
      return createErrorResponse('notificationIds must be an array', 400);
    }

    // Mark notifications as read
    const updatedCount = await markNotificationsRead(user.id, notificationIds);

    const response: MarkNotificationsReadResponse = {
      success: true,
      updatedCount,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] PUT /notifications error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
