import React, { useMemo, useState, useCallback } from 'react';

/**
 * Channel category data
 */
export interface ChannelCategory {
  id: string;
  name: string;
  channels: Channel[];
  isCollapsed?: boolean;
}

/**
 * Channel data
 */
export interface Channel {
  id: string;
  name: string;
  /** Category ID if organized in categories */
  categoryId?: string;
  /** Channel type */
  type?: 'text' | 'voice' | 'announcement';
  /** Whether the channel is private */
  isPrivate?: boolean;
  /** Whether the channel is NSFW */
  isNsfw?: boolean;
  /** Number of unread messages */
  unreadCount?: number;
  /** Whether there are mentions */
  hasMentions?: boolean;
  /** Description for tooltip */
  description?: string;
}

export interface ChannelListProps {
  /** List of channels (flat or organized in categories) */
  channels: Channel[];
  /** Channel categories */
  categories?: ChannelCategory[];
  /** Currently selected channel ID */
  selectedChannelId?: string | null;
  /** Callback when channel is selected */
  onSelect: (channelId: string) => void;
  /** Whether the current user can create channels */
  canCreateChannel?: boolean;
  /** Callback to create a new channel */
  onCreateChannel?: (categoryId?: string) => void;
  /** Whether the list is loading */
  isLoading?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * Channel icon based on type
 */
function ChannelIcon({
  type = 'text',
  isPrivate = false,
}: {
  type?: Channel['type'];
  isPrivate?: boolean;
  isNsfw?: boolean;
}) {
  if (isPrivate) {
    return (
      <svg className="w-5 h-5 text-zinc-400" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (type === 'voice') {
    return (
      <svg className="w-5 h-5 text-zinc-400" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (type === 'announcement') {
    return (
      <svg className="w-5 h-5 text-zinc-400" fill="currentColor" viewBox="0 0 20 20">
        <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
      </svg>
    );
  }

  // Default text channel
  return (
    <span className="text-xl text-zinc-400 font-normal leading-none">#</span>
  );
}

/**
 * Single channel item component
 */
function ChannelItem({
  channel,
  isSelected,
  onClick,
}: {
  channel: Channel;
  isSelected: boolean;
  onClick: () => void;
}) {
  const hasUnread = channel.unreadCount !== undefined && channel.unreadCount > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors group ${
        isSelected
          ? 'bg-zinc-700 text-white'
          : hasUnread
          ? 'text-white hover:bg-zinc-800'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`}
      title={channel.description}
    >
      {/* Channel icon */}
      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
        <ChannelIcon
          type={channel.type}
          isPrivate={channel.isPrivate}
          isNsfw={channel.isNsfw}
        />
      </div>

      {/* Channel name */}
      <span
        className={`flex-1 text-left truncate ${
          hasUnread ? 'font-semibold' : 'font-normal'
        }`}
      >
        {channel.name}
      </span>

      {/* NSFW badge */}
      {channel.isNsfw && (
        <span className="px-1 py-0.5 text-[10px] font-bold uppercase bg-red-900/50 text-red-400 rounded">
          NSFW
        </span>
      )}

      {/* Unread indicators */}
      {channel.hasMentions && (
        <span className="w-2 h-2 rounded-full bg-red-500" title="You were mentioned" />
      )}
      {hasUnread && !channel.hasMentions && (
        <span className="w-2 h-2 rounded-full bg-white" />
      )}
    </button>
  );
}

/**
 * Category header component
 */
function CategoryHeader({
  category,
  isCollapsed,
  onToggle,
  canCreate,
  onCreate,
}: {
  category: ChannelCategory;
  isCollapsed: boolean;
  onToggle: () => void;
  canCreate?: boolean;
  onCreate?: () => void;
}) {
  return (
    <div className="flex items-center px-1 py-1 group">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 flex-1 text-left"
        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${category.name}`}
        aria-expanded={!isCollapsed}
      >
        <svg
          className={`w-3 h-3 text-zinc-500 transition-transform ${
            isCollapsed ? '' : 'rotate-90'
          }`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {category.name}
        </span>
      </button>

      {canCreate && (
        <button
          onClick={onCreate}
          className="p-0.5 text-zinc-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
          title="Create channel"
          aria-label={`Create channel in ${category.name}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Loading skeleton
 */
function ChannelListSkeleton() {
  return (
    <div className="space-y-4 p-2">
      {[1, 2].map((cat) => (
        <div key={cat} className="space-y-1">
          <div className="h-4 w-20 bg-zinc-700 rounded animate-pulse" />
          {[1, 2, 3].map((ch) => (
            <div key={ch} className="flex items-center gap-2 px-2 py-1.5 animate-pulse">
              <div className="w-5 h-5 bg-zinc-700 rounded" />
              <div className="h-4 w-24 bg-zinc-700 rounded" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state
 */
function EmptyChannelList({
  canCreate,
  onCreate,
}: {
  canCreate?: boolean;
  onCreate?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <div className="w-12 h-12 mb-3 rounded-full bg-zinc-800 flex items-center justify-center">
        <span className="text-2xl text-zinc-600">#</span>
      </div>
      <p className="text-sm text-zinc-400 mb-3">No channels yet</p>
      {canCreate && onCreate && (
        <button
          onClick={onCreate}
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Create a channel
        </button>
      )}
    </div>
  );
}

/**
 * Channel list component for Void Chat
 *
 * Features:
 * - Shows channels organized by category
 * - Channel type icons (text, voice, announcement)
 * - Private channel lock icon
 * - Unread indicators
 * - Mention indicators
 * - Collapsible categories
 * - Create channel button for admins
 */
export function ChannelList({
  channels,
  categories,
  selectedChannelId,
  onSelect,
  canCreateChannel = false,
  onCreateChannel,
  isLoading = false,
  className = '',
}: ChannelListProps) {
  // Track collapsed categories
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Toggle category collapse
  const toggleCategory = useCallback((categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  // Organize channels by category
  const organizedChannels = useMemo(() => {
    if (categories && categories.length > 0) {
      return categories;
    }

    // Group uncategorized channels
    const uncategorized = channels.filter((c) => !c.categoryId);
    if (uncategorized.length > 0) {
      return [
        {
          id: 'uncategorized',
          name: 'Channels',
          channels: uncategorized,
        },
      ];
    }

    return [];
  }, [channels, categories]);

  if (isLoading) {
    return (
      <div className={className}>
        <ChannelListSkeleton />
      </div>
    );
  }

  if (channels.length === 0 && (!categories || categories.length === 0)) {
    return (
      <div className={className}>
        <EmptyChannelList
          canCreate={canCreateChannel}
          onCreate={() => onCreateChannel?.()}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent ${className}`}>
      {organizedChannels.map((category) => {
        const isCollapsed = collapsedCategories.has(category.id);

        return (
          <div key={category.id} className="mb-4">
            {/* Category header */}
            <CategoryHeader
              category={category}
              isCollapsed={isCollapsed}
              onToggle={() => toggleCategory(category.id)}
              canCreate={canCreateChannel}
              onCreate={() => onCreateChannel?.(category.id)}
            />

            {/* Channels */}
            {!isCollapsed && (
              <div className="mt-1 space-y-0.5">
                {category.channels.map((channel) => (
                  <ChannelItem
                    key={channel.id}
                    channel={channel}
                    isSelected={selectedChannelId === channel.id}
                    onClick={() => onSelect(channel.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Create channel button at bottom for admins */}
      {canCreateChannel && (
        <div className="px-2 mt-auto pt-4">
          <button
            onClick={() => onCreateChannel?.()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            aria-label="Create a new channel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Create Channel
          </button>
        </div>
      )}
    </div>
  );
}

export default ChannelList;
