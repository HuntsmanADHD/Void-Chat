'use client';

import { useState, useEffect, useCallback } from 'react';
import type { NotificationResponse } from '@/types/api';
import type { Socket } from 'socket.io-client';

interface UseNotificationsOptions {
  authToken?: string;
  socket?: Socket | null;
  enabled?: boolean;
}

interface UseNotificationsReturn {
  unreadCount: number;
  notifications: NotificationResponse[];
  loading: boolean;
  error: string | null;
  fetchNotifications: () => Promise<void>;
  markAsRead: (notificationIds?: string[]) => Promise<void>;
  addNotification: (notification: NotificationResponse) => void;
}

export function useNotifications({
  authToken,
  socket,
  enabled = true,
}: UseNotificationsOptions): UseNotificationsReturn {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No-op: notification API endpoint no longer exists; notifications come via socket only
  const fetchNotifications = useCallback(async () => {}, []);

  // No-op: notification API endpoint no longer exists
  const markAsRead = useCallback(async () => {}, []);

  // Add a new notification (from socket)
  const addNotification = useCallback((notification: NotificationResponse) => {
    setNotifications((prev) => [notification, ...prev]);
    if (!notification.read) {
      setUnreadCount((prev) => prev + 1);
    }
  }, []);

  // Socket listener for real-time notifications
  useEffect(() => {
    if (!socket || !enabled) return;

    const handleNotification = (data: {
      id: string;
      type: string;
      title: string;
      body?: string;
      messageId?: string;
      channelId?: string;
      communityId?: string;
      senderId?: string;
      timestamp: number;
    }) => {
      const notification: NotificationResponse = {
        id: data.id,
        type: data.type as NotificationResponse['type'],
        title: data.title,
        body: data.body || null,
        read: false,
        messageId: data.messageId || null,
        channelId: data.channelId || null,
        communityId: data.communityId || null,
        senderId: null,
        senderPublicId: data.senderId || null,
        createdAt: new Date(data.timestamp).toISOString(),
      };

      addNotification(notification);
    };

    socket.on('notification', handleNotification);

    return () => {
      socket.off('notification', handleNotification);
    };
  }, [socket, enabled, addNotification]);

  return {
    unreadCount,
    notifications,
    loading,
    error,
    fetchNotifications,
    markAsRead,
    addNotification,
  };
}

export default useNotifications;
