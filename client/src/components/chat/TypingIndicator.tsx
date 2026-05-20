/**
 * TypingIndicator Component for Void Chat
 * Displays animated dots when users are typing in a channel or DM
 *
 * Features:
 * - Shows who is typing (by public ID or display name)
 * - Animated bouncing dots
 * - Supports multiple typing users
 * - Auto-hides stale typing indicators
 */

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import type { TypingUser } from '@/types/p2p';

/**
 * Props for the TypingIndicator component
 */
interface TypingIndicatorProps {
  /** List of users currently typing */
  typingUsers: TypingUser[];
  /** Map of public IDs to display names */
  displayNames?: Map<string, string>;
  /** Current user's public ID (to exclude from display) */
  currentUserId?: string;
  /** Maximum number of names to show before "and X more" */
  maxNames?: number;
  /** Timeout in ms after which to consider typing indicator stale */
  staleTimeout?: number;
  /** Optional className for custom styling */
  className?: string;
}

/**
 * Format public ID for display
 */
function formatId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

/**
 * Animated dots component
 */
function AnimatedDots(): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      <span
        className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
        style={{ animationDelay: '300ms' }}
      />
    </span>
  );
}

/**
 * TypingIndicator Component
 * Shows who is currently typing with animated dots
 */
export function TypingIndicator({
  typingUsers,
  displayNames = new Map(),
  currentUserId,
  maxNames = 3,
  staleTimeout = 10000,
  className = '',
}: TypingIndicatorProps): React.ReactElement | null {
  const [activeTypers, setActiveTypers] = useState<TypingUser[]>([]);

  // Filter out current user and stale typing indicators
  useEffect(() => {
    const now = Date.now();
    const filtered = typingUsers.filter((user) => {
      // Exclude current user
      if (currentUserId && user.publicId === currentUserId) {
        return false;
      }
      // Exclude stale indicators
      if (now - user.startedAt > staleTimeout) {
        return false;
      }
      return true;
    });

    setActiveTypers(filtered);

    // Set up interval to refresh and remove stale indicators
    const interval = setInterval(() => {
      const currentTime = Date.now();
      setActiveTypers((current) =>
        current.filter((user) => currentTime - user.startedAt <= staleTimeout)
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [typingUsers, currentUserId, staleTimeout]);

  // Generate display text
  const displayText = useMemo(() => {
    if (activeTypers.length === 0) return null;

    const names = activeTypers.slice(0, maxNames).map((user) => {
      const displayName = displayNames.get(user.publicId);
      return displayName || formatId(user.publicId);
    });

    const remaining = activeTypers.length - maxNames;

    if (names.length === 1) {
      return `${names[0]} is typing`;
    }

    if (remaining > 0) {
      return `${names.join(', ')} and ${remaining} more are typing`;
    }

    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing`;
    }

    const lastPerson = names.pop();
    return `${names.join(', ')}, and ${lastPerson} are typing`;
  }, [activeTypers, displayNames, maxNames]);

  // Don't render if no one is typing
  if (!displayText) {
    return null;
  }

  return (
    <div
      className={`flex items-center text-sm text-gray-400 py-1.5 px-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center">
        {displayText}
        <AnimatedDots />
      </span>
    </div>
  );
}

/**
 * Compact typing indicator (just dots, for inline use)
 */
interface CompactTypingIndicatorProps {
  /** Whether someone is typing */
  isTyping: boolean;
  /** Optional className */
  className?: string;
}

export function CompactTypingIndicator({
  isTyping,
  className = '',
}: CompactTypingIndicatorProps): React.ReactElement | null {
  if (!isTyping) return null;

  return (
    <span className={`inline-flex items-center ${className}`}>
      <AnimatedDots />
    </span>
  );
}

/**
 * Hook to get typing users for a specific channel or DM
 */
export function useTypingDisplay(
  typingUsers: Map<string, TypingUser[]>,
  channelId?: string,
  dmRecipientId?: string
): TypingUser[] {
  return useMemo(() => {
    const key = channelId || dmRecipientId || '';
    return typingUsers.get(key) || [];
  }, [typingUsers, channelId, dmRecipientId]);
}

export default TypingIndicator;
