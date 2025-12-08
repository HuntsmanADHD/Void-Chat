'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const initialFetchDone = useRef(false);

  // Fetch notifications from API
  const fetchNotifications = useCallback(async () => {
    if (!authToken || !enabled) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/notifications?page=1&limit=20', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const data = await response.json();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [authToken, enabled]);

  // Mark notifications as read
  const markAsRead = useCallback(async (notificationIds?: string[]) => {
    if (!authToken) return;

    try {
      const response = await fetch('/api/notifications', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ notificationIds }),
      });

      if (response.ok) {
        const data = await response.json();

        if (notificationIds && notificationIds.length > 0) {
          setNotifications((prev) =>
            prev.map((n) =>
              notificationIds.includes(n.id) ? { ...n, read: true } : n
            )
          );
          setUnreadCount((prev) => Math.max(0, prev - data.updatedCount));
        } else {
          setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
          setUnreadCount(0);
        }
      }
    } catch (err) {
      console.error('Failed to mark notifications as read:', err);
    }
  }, [authToken]);

  // Add a new notification (from socket)
  const addNotification = useCallback((notification: NotificationResponse) => {
    setNotifications((prev) => [notification, ...prev]);
    if (!notification.read) {
      setUnreadCount((prev) => prev + 1);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (authToken && enabled && !initialFetchDone.current) {
      initialFetchDone.current = true;
      fetchNotifications();
    }
  }, [authToken, enabled, fetchNotifications]);

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
      senderWallet?: string;
      senderXHandle?: string;
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
        senderId: null, // Not included in socket payload
        senderWallet: data.senderWallet || null,
        senderXHandle: data.senderXHandle || null,
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
