/**
 * OnlineStatus Component for Void Chat
 * Displays online/offline status indicators for users
 *
 * Features:
 * - Visual status dot (green/gray/yellow)
 * - Status text display
 * - P2P connection indicator
 * - Last seen timestamp
 * - Multiple size variants
 */

'use client';

import React, { useMemo } from 'react';

/**
 * User status types
 */
export type UserStatus = 'online' | 'offline' | 'away' | 'busy' | 'p2p-connected';

/**
 * Status dot size variants
 */
export type StatusSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Props for the StatusDot component
 */
interface StatusDotProps {
  /** Current status */
  status: UserStatus;
  /** Size of the dot */
  size?: StatusSize;
  /** Whether to show pulse animation for online status */
  pulse?: boolean;
  /** Optional className */
  className?: string;
}

/**
 * Get CSS classes for status dot based on status
 */
function getStatusClasses(status: UserStatus): string {
  switch (status) {
    case 'online':
      return 'bg-green-500';
    case 'p2p-connected':
      return 'bg-blue-500';
    case 'away':
      return 'bg-yellow-500';
    case 'busy':
      return 'bg-red-500';
    case 'offline':
    default:
      return 'bg-gray-500';
  }
}

/**
 * Get size classes for status dot
 */
function getSizeClasses(size: StatusSize): string {
  switch (size) {
    case 'xs':
      return 'w-2 h-2';
    case 'sm':
      return 'w-2.5 h-2.5';
    case 'md':
      return 'w-3 h-3';
    case 'lg':
      return 'w-4 h-4';
  }
}

/**
 * StatusDot Component
 * A simple dot indicator showing user status
 */
export function StatusDot({
  status,
  size = 'sm',
  pulse = true,
  className = '',
}: StatusDotProps): React.ReactElement {
  const statusClasses = getStatusClasses(status);
  const sizeClasses = getSizeClasses(size);
  const shouldPulse = pulse && (status === 'online' || status === 'p2p-connected');

  return (
    <span
      className={`
        relative inline-block rounded-full
        ${statusClasses}
        ${sizeClasses}
        ${className}
      `}
      role="status"
      aria-label={`Status: ${status}`}
    >
      {shouldPulse && (
        <span
          className={`
            absolute inset-0 rounded-full animate-ping opacity-75
            ${statusClasses}
          `}
          style={{ animationDuration: '2s' }}
        />
      )}
    </span>
  );
}

/**
 * Props for the OnlineStatus component
 */
interface OnlineStatusProps {
  /** Is the user online */
  isOnline: boolean;
  /** Is the user connected via P2P (optional) */
  isP2PConnected?: boolean;
  /** Last seen timestamp (optional) */
  lastSeen?: number;
  /** Whether to show status text */
  showText?: boolean;
  /** Size of the status dot */
  size?: StatusSize;
  /** Whether to show pulse animation */
  pulse?: boolean;
  /** Optional className */
  className?: string;
}

/**
 * Format last seen timestamp
 */
function formatLastSeen(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  // Less than a minute
  if (diff < 60000) {
    return 'Just now';
  }

  // Less than an hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }

  // Less than a day
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // More than a day
  const days = Math.floor(diff / 86400000);
  return `${days}d ago`;
}

/**
 * OnlineStatus Component
 * Displays online/offline status with optional text
 */
export function OnlineStatus({
  isOnline,
  isP2PConnected = false,
  lastSeen,
  showText = false,
  size = 'sm',
  pulse = true,
  className = '',
}: OnlineStatusProps): React.ReactElement {
  const status: UserStatus = useMemo(() => {
    if (isP2PConnected) return 'p2p-connected';
    if (isOnline) return 'online';
    return 'offline';
  }, [isOnline, isP2PConnected]);

  const statusText = useMemo(() => {
    if (isP2PConnected) return 'P2P Connected';
    if (isOnline) return 'Online';
    if (lastSeen) return `Last seen ${formatLastSeen(lastSeen)}`;
    return 'Offline';
  }, [isOnline, isP2PConnected, lastSeen]);

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      role="status"
    >
      <StatusDot status={status} size={size} pulse={pulse} />
      {showText && (
        <span
          className={`text-xs ${
            status === 'offline' ? 'text-gray-500' : 'text-gray-300'
          }`}
        >
          {statusText}
        </span>
      )}
    </span>
  );
}

/**
 * Props for the OnlineStatusBadge component
 */
interface OnlineStatusBadgeProps {
  /** Is the user online */
  isOnline: boolean;
  /** Is the user connected via P2P */
  isP2PConnected?: boolean;
  /** Optional className */
  className?: string;
}

/**
 * OnlineStatusBadge Component
 * A badge-style status indicator with icon
 */
export function OnlineStatusBadge({
  isOnline,
  isP2PConnected = false,
  className = '',
}: OnlineStatusBadgeProps): React.ReactElement {
  if (isP2PConnected) {
    return (
      <span
        className={`
          inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
          bg-blue-500/20 text-blue-400 border border-blue-500/30
          ${className}
        `}
      >
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        P2P
      </span>
    );
  }

  if (isOnline) {
    return (
      <span
        className={`
          inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
          bg-green-500/20 text-green-400 border border-green-500/30
          ${className}
        `}
      >
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
        Online
      </span>
    );
  }

  return (
    <span
      className={`
        inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
        bg-gray-500/20 text-gray-400 border border-gray-500/30
        ${className}
      `}
    >
      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full" />
      Offline
    </span>
  );
}

/**
 * Props for the ConnectionQuality component
 */
interface ConnectionQualityProps {
  /** Is P2P connected */
  isP2P: boolean;
  /** Latency in ms (optional) */
  latency?: number;
  /** Optional className */
  className?: string;
}

/**
 * ConnectionQuality Component
 * Shows connection type and quality indicator
 */
export function ConnectionQuality({
  isP2P,
  latency,
  className = '',
}: ConnectionQualityProps): React.ReactElement {
  // Determine quality based on latency
  const quality = useMemo(() => {
    if (!latency) return 'unknown';
    if (latency < 50) return 'excellent';
    if (latency < 100) return 'good';
    if (latency < 200) return 'fair';
    return 'poor';
  }, [latency]);

  const qualityColor = useMemo(() => {
    switch (quality) {
      case 'excellent':
        return 'text-green-400';
      case 'good':
        return 'text-green-500';
      case 'fair':
        return 'text-yellow-500';
      case 'poor':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  }, [quality]);

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${className}`}>
      {/* Connection type icon */}
      {isP2P ? (
        <svg
          className="w-3.5 h-3.5 text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-label="P2P Connection"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      ) : (
        <svg
          className="w-3.5 h-3.5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-label="Server Relay"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
          />
        </svg>
      )}

      {/* Quality bars */}
      <span className="flex items-end gap-0.5 h-3">
        <span
          className={`w-0.5 h-1 rounded-sm ${
            quality !== 'unknown' ? qualityColor : 'bg-gray-600'
          }`}
        />
        <span
          className={`w-0.5 h-1.5 rounded-sm ${
            quality === 'excellent' || quality === 'good' || quality === 'fair'
              ? qualityColor
              : 'bg-gray-600'
          }`}
        />
        <span
          className={`w-0.5 h-2 rounded-sm ${
            quality === 'excellent' || quality === 'good'
              ? qualityColor
              : 'bg-gray-600'
          }`}
        />
        <span
          className={`w-0.5 h-2.5 rounded-sm ${
            quality === 'excellent' ? qualityColor : 'bg-gray-600'
          }`}
        />
      </span>

      {/* Latency display */}
      {latency !== undefined && (
        <span className={`${qualityColor}`}>{latency}ms</span>
      )}
    </span>
  );
}

/**
 * Props for the OnlineUserCount component
 */
interface OnlineUserCountProps {
  /** Number of online users */
  count: number;
  /** Total number of users (optional) */
  total?: number;
  /** Optional className */
  className?: string;
}

/**
 * OnlineUserCount Component
 * Shows count of online users
 */
export function OnlineUserCount({
  count,
  total,
  className = '',
}: OnlineUserCountProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-gray-400 ${className}`}
    >
      <StatusDot status="online" size="xs" pulse={false} />
      <span>
        {count} online
        {total !== undefined && ` / ${total}`}
      </span>
    </span>
  );
}

export default OnlineStatus;
