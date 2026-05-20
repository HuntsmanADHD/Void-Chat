'use client';

import React, { useMemo } from 'react';

/**
 * Community data structure
 */
export interface CommunityData {
  id: string;
  name: string;
  description?: string;
  icon?: string | null;
  /** Banner image URL */
  banner?: string | null;
  /** Member count */
  memberCount: number;
  /** Online member count */
  onlineCount?: number;
  /** Whether the current user is a member */
  isMember?: boolean;
  /** Whether the community is verified */
  isVerified?: boolean;
  /** Community tags */
  tags?: string[];
  /** Owner public ID */
  ownerId?: string;
}

export interface CommunityCardProps {
  /** Community data */
  community: CommunityData;
  /** Callback when join button is clicked */
  onJoin?: (communityId: string) => void;
  /** Callback when card is clicked */
  onClick?: (communityId: string) => void;
  /** Whether join action is in progress */
  isJoining?: boolean;
  /** Card size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

/**
 * Format member count
 */
function formatMemberCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  } else if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Generate gradient from community ID for placeholder icons (void aesthetic)
 */
function generateGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  // Void aesthetic: zinc color variations
  const lightness1 = 35 + (Math.abs(hash % 15)); // 35-50%
  const lightness2 = 25 + (Math.abs((hash >> 8) % 15)); // 25-40%

  return `linear-gradient(135deg, hsl(240, 5%, ${lightness1}%), hsl(240, 5%, ${lightness2}%))`;
}

/**
 * Verified badge component
 */
function VerifiedBadge() {
  return (
    <div
      className="absolute -bottom-1 -right-1 w-5 h-5 bg-gradient-to-r from-zinc-500 to-zinc-400 rounded-full flex items-center justify-center border border-zinc-400/30"
      title="Verified Community"
    >
      <svg className="w-3 h-3 text-zinc-100" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

/**
 * Community card component for Void Chat
 *
 * Features:
 * - Community icon with gradient fallback
 * - Name and description
 * - Member count with online indicator
 * - Join button
 * - Verified community badge
 * - Tags
 */
export const CommunityCard = React.memo(function CommunityCard({
  community,
  onJoin,
  onClick,
  isJoining = false,
  size = 'md',
  className = '',
}: CommunityCardProps) {
  const canJoin = useMemo(() => {
    return !community.isMember;
  }, [community.isMember]);

  const placeholderGradient = useMemo(
    () => generateGradient(community.id),
    [community.id]
  );

  const sizeClasses = {
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5',
  };

  const iconSizes = {
    sm: 'w-10 h-10',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  const handleClick = () => {
    if (onClick) {
      onClick(community.id);
    }
  };

  const handleJoin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onJoin && canJoin) {
      onJoin(community.id);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 rounded-xl overflow-hidden transition-all duration-200 border border-zinc-800/50 ${
        onClick ? 'cursor-pointer hover:from-zinc-800 hover:via-zinc-850 hover:to-zinc-900 hover:shadow-lg hover:scale-[1.02] hover:border-zinc-700/50' : ''
      } ${className}`}
    >
      {/* Banner (if available) */}
      {community.banner && size === 'lg' && (
        <div className="h-24 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={community.banner}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className={sizeClasses[size]}>
        <div className="flex items-start gap-3">
          {/* Community icon */}
          <div className="relative flex-shrink-0">
            {community.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={community.icon}
                alt={community.name}
                className={`${iconSizes[size]} rounded-xl object-cover`}
              />
            ) : (
              <div
                className={`${iconSizes[size]} rounded-xl flex items-center justify-center text-zinc-200 font-bold text-lg border border-zinc-700/30`}
                style={{ background: placeholderGradient }}
              >
                {community.name.charAt(0).toUpperCase()}
              </div>
            )}
            {community.isVerified && <VerifiedBadge />}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Name */}
            <h3 className={`font-semibold text-white truncate ${size === 'lg' ? 'text-lg' : ''}`}>
              {community.name}
            </h3>

            {/* Description */}
            {community.description && size !== 'sm' && (
              <p className="text-sm text-zinc-400 line-clamp-2 mt-1">
                {community.description}
              </p>
            )}

            {/* Stats row */}
            <div className="flex items-center gap-3 mt-2">
              {/* Member count */}
              <div className="flex items-center gap-1 text-zinc-400">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                </svg>
                <span className={size === 'sm' ? 'text-xs' : 'text-sm'}>
                  {formatMemberCount(community.memberCount)}
                </span>
              </div>

              {/* Online count */}
              {community.onlineCount !== undefined && (
                <div className="flex items-center gap-1 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className={size === 'sm' ? 'text-xs' : 'text-sm'}>
                    {formatMemberCount(community.onlineCount)} online
                  </span>
                </div>
              )}
            </div>

            {/* Free to join badge */}
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1 ${size === 'sm' ? 'text-xs' : 'text-sm'} text-emerald-400`}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                Free to join
              </span>
            </div>

            {/* Tags */}
            {community.tags && community.tags.length > 0 && size === 'lg' && (
              <div className="flex flex-wrap gap-1 mt-3">
                {community.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs bg-zinc-800 text-zinc-400 rounded-full border border-zinc-700/30"
                  >
                    {tag}
                  </span>
                ))}
                {community.tags.length > 3 && (
                  <span className="px-2 py-0.5 text-xs text-zinc-500">
                    +{community.tags.length - 3} more
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Join button */}
        {onJoin && !community.isMember && (
          <div className="mt-4">
            <button
              onClick={handleJoin}
              disabled={!canJoin || isJoining}
              className={`w-full py-2 px-4 rounded-lg font-medium transition-all ${
                canJoin && !isJoining
                  ? 'bg-gradient-to-r from-zinc-700 via-zinc-600 to-zinc-500 hover:from-zinc-600 hover:via-zinc-500 hover:to-zinc-400 text-white border border-zinc-500/30'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/30'
              }`}
            >
              {isJoining ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Joining...
                </span>
              ) : (
                'Join Community'
              )}
            </button>
          </div>
        )}

        {/* Member badge */}
        {community.isMember && (
          <div className="mt-4 flex items-center justify-center gap-2 py-2 text-emerald-400">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm font-medium">Member</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default CommunityCard;
