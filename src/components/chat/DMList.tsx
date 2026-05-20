'use client';

import React, { useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';

/**
 * DM conversation data
 */
export interface DMConversation {
  /** Public ID of the other user */
  publicId: string;
  /** Avatar URL */
  avatarUrl?: string | null;
  /** Online status */
  isOnline?: boolean;
  /** Last message preview (decrypted) */
  lastMessage?: string | null;
  /** Last message timestamp */
  lastMessageTime?: Date | string;
  /** Number of unread messages */
  unreadCount?: number;
}

export interface DMListProps {
  /** List of DM conversations */
  conversations: DMConversation[];
  /** Currently selected conversation ID */
  selectedId?: string | null;
  /** Callback when conversation is selected */
  onSelect: (publicId: string) => void;
  /** Whether the list is loading */
  isLoading?: boolean;
  /** Callback to start a new DM */
  onNewDM?: () => void;
  /** Additional class names */
  className?: string;
}

function formatLastMessageTime(date: Date | string): string {
  const now = new Date();
  const messageDate = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - messageDate.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'now';
  else if (diffMin < 60) return `${diffMin}m`;
  else if (diffHour < 24) return `${diffHour}h`;
  else if (diffDay < 7) return `${diffDay}d`;
  else return messageDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function DMConversationItem({
  conversation,
  isSelected,
  onClick,
}: {
  conversation: DMConversation;
  isSelected: boolean;
  onClick: () => void;
}) {
  const displayName = useMemo(() => truncateAddress(conversation.publicId), [conversation.publicId]);

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        isSelected ? 'bg-zinc-700' : 'hover:bg-zinc-800'
      }`}
    >
      <div className="relative flex-shrink-0">
        <Avatar publicId={conversation.publicId} imageUrl={conversation.avatarUrl} size="md" />
        {conversation.isOnline !== undefined && (
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-800 ${
            conversation.isOnline ? 'bg-emerald-500' : 'bg-zinc-500'
          }`} />
        )}
      </div>

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white truncate">{displayName}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-zinc-400 truncate flex-1">
            {conversation.lastMessage || 'No messages yet'}
          </p>
          {conversation.lastMessageTime && (
            <span className="text-xs text-zinc-500 flex-shrink-0">
              {formatLastMessageTime(conversation.lastMessageTime)}
            </span>
          )}
        </div>
      </div>

      {conversation.unreadCount !== undefined && conversation.unreadCount > 0 && (
        <div className="flex-shrink-0">
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-medium bg-zinc-600 text-white rounded-full">
            {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
          </span>
        </div>
      )}
    </button>
  );
}

function DMListSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-zinc-700" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-24 bg-zinc-700 rounded" />
            <div className="h-3 w-32 bg-zinc-800 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyDMList({ onNewDM }: { onNewDM?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <div className="w-12 h-12 mb-3 rounded-full bg-zinc-800 flex items-center justify-center">
        <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </div>
      <p className="text-sm text-zinc-400 mb-3">No conversations yet</p>
      {onNewDM && (
        <button onClick={onNewDM} className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors" aria-label="Start a new conversation">
          Start a new conversation
        </button>
      )}
    </div>
  );
}

export function DMList({
  conversations,
  selectedId,
  onSelect,
  isLoading = false,
  onNewDM,
  className = '',
}: DMListProps) {
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (!a.lastMessageTime && !b.lastMessageTime) return 0;
      if (!a.lastMessageTime) return 1;
      if (!b.lastMessageTime) return -1;
      const timeA = new Date(a.lastMessageTime).getTime();
      const timeB = new Date(b.lastMessageTime).getTime();
      return timeB - timeA;
    });
  }, [conversations]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Direct Messages</h2>
        {onNewDM && (
          <button onClick={onNewDM} className="p-1 text-zinc-400 hover:text-white transition-colors" title="New message" aria-label="Start a new direct message">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
        {isLoading ? (
          <DMListSkeleton />
        ) : sortedConversations.length === 0 ? (
          <EmptyDMList onNewDM={onNewDM} />
        ) : (
          <div className="space-y-1 p-2">
            {sortedConversations.map((conversation) => (
              <DMConversationItem
                key={conversation.publicId}
                conversation={conversation}
                isSelected={selectedId === conversation.publicId}
                onClick={() => onSelect(conversation.publicId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DMList;
