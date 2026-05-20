/**
 * Void Chat - Strike Indicator Component
 *
 * Displays a user's strike count with visual indicators.
 * Shows warning icon with strike count and tooltip with details.
 * Colors: yellow (1 strike), orange (2 strikes), red (blacklisted)
 */

import React, { useState, useRef, useEffect } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface StrikeInfo {
  id: string;
  strikeNumber: number;
  reason: string;
  createdAt: Date | string;
  expiresAt: Date | string | null;
  isActive: boolean;
}

export interface StrikeIndicatorProps {
  /** Number of strikes (0-3) */
  strikeCount: number;
  /** Whether user is blacklisted */
  isBlacklisted?: boolean;
  /** Detailed strike information (optional) */
  strikes?: StrikeInfo[];
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show count label */
  showCount?: boolean;
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Custom className */
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getStrikeColor(strikeCount: number, isBlacklisted: boolean): string {
  if (isBlacklisted || strikeCount >= 3) {
    return 'text-red-500';
  }
  if (strikeCount === 2) {
    return 'text-orange-500';
  }
  if (strikeCount === 1) {
    return 'text-yellow-500';
  }
  return 'text-gray-500';
}

function getStrikeBgColor(strikeCount: number, isBlacklisted: boolean): string {
  if (isBlacklisted || strikeCount >= 3) {
    return 'bg-red-500/10';
  }
  if (strikeCount === 2) {
    return 'bg-orange-500/10';
  }
  if (strikeCount === 1) {
    return 'bg-yellow-500/10';
  }
  return 'bg-gray-500/10';
}

function getStrikeLabel(strikeCount: number, isBlacklisted: boolean): string {
  if (isBlacklisted) {
    return 'Blacklisted';
  }
  switch (strikeCount) {
    case 0:
      return 'Good Standing';
    case 1:
      return '1 Strike - Warning';
    case 2:
      return '2 Strikes - Final Warning';
    case 3:
      return '3 Strikes - Blacklisted';
    default:
      return `${strikeCount} Strikes`;
  }
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimeRemaining(expiresAt: Date | string): string {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const now = new Date();
  const diff = expiry.getTime() - now.getTime();

  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h remaining`;
  }
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m remaining`;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function StrikeIndicator({
  strikeCount,
  isBlacklisted = false,
  strikes = [],
  size = 'md',
  showCount = true,
  showTooltip = true,
  className = '',
}: StrikeIndicatorProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const indicatorRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Track if should render
  const shouldRender = strikeCount > 0 || isBlacklisted;

  // Update tooltip position
  useEffect(() => {
    if (isTooltipVisible && indicatorRef.current && tooltipRef.current) {
      const indicatorRect = indicatorRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      // Position tooltip above the indicator
      let top = indicatorRect.top - tooltipRect.height - 8;
      let left = indicatorRect.left + indicatorRect.width / 2 - tooltipRect.width / 2;

      // Adjust if tooltip goes off screen
      if (top < 8) {
        top = indicatorRect.bottom + 8;
      }
      if (left < 8) {
        left = 8;
      }
      if (left + tooltipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - tooltipRect.width - 8;
      }

      setTooltipPosition({ top, left });
    }
  }, [isTooltipVisible]);

  // Size classes
  const sizeClasses = {
    sm: {
      container: 'gap-1 px-1.5 py-0.5',
      icon: 'h-3 w-3',
      text: 'text-xs',
    },
    md: {
      container: 'gap-1.5 px-2 py-1',
      icon: 'h-4 w-4',
      text: 'text-sm',
    },
    lg: {
      container: 'gap-2 px-2.5 py-1.5',
      icon: 'h-5 w-5',
      text: 'text-base',
    },
  };

  const colorClass = getStrikeColor(strikeCount, isBlacklisted);
  const bgColorClass = getStrikeBgColor(strikeCount, isBlacklisted);

  // Don't render if no strikes and not blacklisted
  if (!shouldRender) {
    return null;
  }

  return (
    <>
      <div
        ref={indicatorRef}
        className={`
          inline-flex items-center rounded-full cursor-help
          ${sizeClasses[size].container}
          ${colorClass}
          ${bgColorClass}
          ${className}
        `}
        onMouseEnter={() => showTooltip && setIsTooltipVisible(true)}
        onMouseLeave={() => setIsTooltipVisible(false)}
        role="status"
        aria-label={getStrikeLabel(strikeCount, isBlacklisted)}
      >
        {/* Warning Icon */}
        {isBlacklisted ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={sizeClasses[size].icon}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={sizeClasses[size].icon}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        )}

        {/* Strike Count */}
        {showCount && (
          <span className={`font-medium ${sizeClasses[size].text}`}>
            {isBlacklisted ? 'Banned' : strikeCount}
          </span>
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && isTooltipVisible && (
        <div
          ref={tooltipRef}
          className="fixed z-50 max-w-xs p-3 bg-gray-800 border border-gray-700 rounded-lg shadow-xl"
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
          }}
        >
          {/* Header */}
          <div className={`font-semibold mb-2 ${colorClass}`}>
            {getStrikeLabel(strikeCount, isBlacklisted)}
          </div>

          {/* Strike Details */}
          {strikes.length > 0 ? (
            <div className="space-y-2">
              {strikes.map((strike) => (
                <div
                  key={strike.id}
                  className="text-sm border-l-2 border-gray-600 pl-2"
                >
                  <div className="text-gray-300">
                    Strike {strike.strikeNumber}: {strike.reason}
                  </div>
                  <div className="text-gray-500 text-xs">
                    {formatDate(strike.createdAt)}
                    {strike.expiresAt && strike.isActive && (
                      <span className="ml-2">
                        ({formatTimeRemaining(strike.expiresAt)})
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-400">
              {isBlacklisted
                ? 'This user has been permanently banned from the platform.'
                : strikeCount === 1
                ? 'One more strike will result in a 7-day timeout.'
                : strikeCount === 2
                ? 'Next strike will result in a permanent ban.'
                : 'User has strikes on record.'}
            </div>
          )}

          {/* Consequence Info */}
          {!isBlacklisted && strikeCount > 0 && strikeCount < 3 && (
            <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-500">
              {strikeCount === 1 && 'Strike 2: 7-day timeout | Strike 3: Permanent ban'}
              {strikeCount === 2 && 'Next violation: Permanent ban'}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// =============================================================================
// VARIANTS
// =============================================================================

/**
 * Compact strike indicator for use in message lists
 */
export function CompactStrikeIndicator({
  strikeCount,
  isBlacklisted = false,
  className = '',
}: {
  strikeCount: number;
  isBlacklisted?: boolean;
  className?: string;
}) {
  if (strikeCount === 0 && !isBlacklisted) {
    return null;
  }

  const colorClass = getStrikeColor(strikeCount, isBlacklisted);

  return (
    <span
      className={`inline-flex items-center ${colorClass} ${className}`}
      title={getStrikeLabel(strikeCount, isBlacklisted)}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-3 w-3"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

/**
 * Strike badge for user profiles
 */
export function StrikeBadge({
  strikeCount,
  isBlacklisted = false,
  strikes = [],
  className = '',
}: {
  strikeCount: number;
  isBlacklisted?: boolean;
  strikes?: StrikeInfo[];
  className?: string;
}) {
  return (
    <StrikeIndicator
      strikeCount={strikeCount}
      isBlacklisted={isBlacklisted}
      strikes={strikes}
      size="lg"
      showCount={true}
      showTooltip={true}
      className={className}
    />
  );
}

/**
 * Blacklist indicator - shows only when user is blacklisted
 */
export function BlacklistIndicator({ className = '' }: { className?: string }) {
  return (
    <div
      className={`
        inline-flex items-center gap-2 px-3 py-1.5
        bg-red-900/30 border border-red-700 rounded-lg
        text-red-400
        ${className}
      `}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
          clipRule="evenodd"
        />
      </svg>
      <span className="font-medium">Blacklisted</span>
    </div>
  );
}

export default StrikeIndicator;
