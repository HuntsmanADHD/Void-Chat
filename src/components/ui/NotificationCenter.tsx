'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Bell,
  MessageSquare,
  AtSign,
  Heart,
  Users,
  AlertTriangle,
  CheckCircle,
  Check,
  CheckCheck,
} from 'lucide-react';
import type { NotificationResponse, NotificationType } from '@/types/api';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (notification: NotificationResponse) => void;
  authToken?: string;
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'DM_RECEIVED':
      return <MessageSquare size={16} className="text-[var(--accent-primary)]" />;
    case 'MENTION':
      return <AtSign size={16} className="text-[var(--accent-warning)]" />;
    case 'REACTION':
      return <Heart size={16} className="text-[var(--accent-danger)]" />;
    case 'COMMUNITY_INVITE':
      return <Users size={16} className="text-[var(--accent-success)]" />;
    case 'STRIKE_RECEIVED':
      return <AlertTriangle size={16} className="text-[var(--accent-danger)]" />;
    case 'APPEAL_UPDATE':
      return <CheckCircle size={16} className="text-[var(--accent-primary)]" />;
    default:
      return <Bell size={16} className="text-[var(--text-muted)]" />;
  }
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function NotificationCenter({
  isOpen,
  onClose,
  onNavigate,
  authToken,
}: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  const fetchNotifications = useCallback(async (pageNum: number = 1) => {
    if (!authToken) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/notifications?page=${pageNum}&limit=20`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const data = await response.json();

      if (pageNum === 1) {
        setNotifications(data.notifications);
      } else {
        setNotifications((prev) => [...prev, ...data.notifications]);
      }

      setUnreadCount(data.unreadCount);
      setHasMore(data.hasMore);
      setPage(pageNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications(1);
    }
  }, [isOpen, fetchNotifications]);

  const markAsRead = async (notificationIds?: string[]) => {
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
        // Update local state
        if (notificationIds && notificationIds.length > 0) {
          setNotifications((prev) =>
            prev.map((n) =>
              notificationIds.includes(n.id) ? { ...n, read: true } : n
            )
          );
          setUnreadCount((prev) => Math.max(0, prev - notificationIds.length));
        } else {
          // Mark all as read
          setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
          setUnreadCount(0);
        }
      }
    } catch (err) {
      console.error('Failed to mark notifications as read:', err);
    }
  };

  const handleNotificationClick = (notification: NotificationResponse) => {
    // Mark as read if unread
    if (!notification.read) {
      markAsRead([notification.id]);
    }

    // Navigate if handler provided
    if (onNavigate) {
      onNavigate(notification);
    }
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      fetchNotifications(page + 1);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-[var(--discord-bg)] shadow-xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--discord-dark)]">
          <div className="flex items-center gap-2">
            <Bell size={20} className="text-[var(--text-primary)]" />
            <h2 className="font-semibold text-[var(--text-primary)]">Notifications</h2>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-[var(--accent-danger)] text-white rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={() => markAsRead()}
                className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--discord-hover)] rounded transition-colors"
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && notifications.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent-primary)]" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <AlertTriangle size={32} className="text-[var(--accent-danger)] mb-2" />
              <p className="text-[var(--text-muted)]">{error}</p>
              <button
                onClick={() => fetchNotifications(1)}
                className="mt-2 px-3 py-1 text-sm text-[var(--accent-primary)] hover:underline"
              >
                Try again
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <Bell size={32} className="text-[var(--text-muted)] mb-2" />
              <p className="text-[var(--text-muted)]">No notifications yet</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[var(--discord-dark)]">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      onClick={() => handleNotificationClick(notification)}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        notification.read
                          ? 'hover:bg-[var(--discord-hover)]'
                          : 'bg-[var(--discord-darker)] hover:bg-[var(--discord-hover)]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--discord-dark)] flex items-center justify-center">
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[var(--text-primary)] truncate">
                              {notification.title}
                            </span>
                            {!notification.read && (
                              <span className="flex-shrink-0 w-2 h-2 bg-[var(--accent-primary)] rounded-full" />
                            )}
                          </div>
                          {notification.body && (
                            <p className="text-sm text-[var(--text-muted)] line-clamp-2 mt-0.5">
                              {notification.body}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
                            <span>{formatTimeAgo(notification.createdAt)}</span>
                            {notification.senderXHandle && (
                              <>
                                <span>-</span>
                                <span>@{notification.senderXHandle}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {notification.read && (
                          <Check size={16} className="text-[var(--text-muted)] flex-shrink-0" />
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              {/* Load more */}
              {hasMore && (
                <div className="p-4">
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="w-full py-2 text-sm text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Animation styles */}
      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

export default NotificationCenter;
