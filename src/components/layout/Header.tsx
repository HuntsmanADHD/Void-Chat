'use client';

import React from 'react';
import {
  Hash,
  AtSign,
  Search,
  Settings,
  Pin,
  Users,
  HelpCircle,
  Inbox,
  Menu,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { truncatePublicId as truncateId } from '@/lib/format';

export interface HeaderUser {
  publicId: string;
  imageUrl?: string | null;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
}

export interface HeaderProps {
  /** Type of view - channel or DM */
  type: 'channel' | 'dm';
  /** Channel name or DM recipient name */
  name: string;
  /** Channel description or user info */
  description?: string;
  /** For DM view - the user you're chatting with */
  dmUser?: HeaderUser;
  /** Whether the right sidebar (member list) is visible */
  memberListVisible?: boolean;
  /** Toggle member list visibility */
  onToggleMemberList?: () => void;
  /** Toggle mobile sidebar */
  onToggleMobileSidebar?: () => void;
  /** Open search */
  onOpenSearch?: () => void;
  /** Open notifications */
  onOpenNotifications?: () => void;
  /** Open settings */
  onOpenSettings?: () => void;
  /** Open pinned messages */
  onOpenPinned?: () => void;
  /** Open help */
  onOpenHelp?: () => void;
  /** Notification count */
  notificationCount?: number;
}

export function Header({
  type,
  name,
  description,
  dmUser,
  memberListVisible = true,
  onToggleMemberList,
  onToggleMobileSidebar,
  onOpenSearch,
  onOpenNotifications,
  onOpenSettings,
  onOpenPinned,
  onOpenHelp,
  notificationCount = 0,
}: HeaderProps) {
  return (
    <header className="h-12 min-h-[48px] flex items-center px-4 bg-gradient-to-r from-black via-zinc-950 to-black border-b border-zinc-800/50 shadow-lg">
      {/* Mobile menu button */}
      <button
        className="md:hidden p-1.5 mr-2 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        onClick={onToggleMobileSidebar}
        aria-label="Toggle sidebar"
      >
        <Menu size={20} />
      </button>

      {/* Channel/DM info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {type === 'channel' ? (
          <>
            <Hash size={20} className="text-zinc-500 flex-shrink-0" />
            <h1 className="font-semibold text-zinc-100 truncate">
              {name}
            </h1>
            {description && (
              <>
                <div className="hidden sm:block w-px h-6 bg-[var(--discord-hover)] mx-2" />
                <p className="hidden sm:block text-sm text-[var(--text-muted)] truncate">
                  {description}
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <AtSign size={20} className="text-[var(--text-muted)] flex-shrink-0" />
            {dmUser && (
              <div className="flex items-center gap-2 min-w-0">
                <Avatar
                  publicId={dmUser.publicId}
                  imageUrl={dmUser.imageUrl}
                  size="xs"
                  status={dmUser.status}
                  showStatus
                />
                <div className="min-w-0">
                  <h1
                    className="font-semibold text-[var(--text-primary)] truncate"
                    title={dmUser.publicId}
                  >
                    {truncateId(dmUser.publicId)}
                  </h1>
                </div>
              </div>
            )}
            {!dmUser && (
              <h1 className="font-semibold text-[var(--text-primary)] truncate">
                {name}
              </h1>
            )}
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        {/* Pinned messages - only for channels */}
        {type === 'channel' && (
          <button
            onClick={onOpenPinned}
            className="hidden sm:flex p-1.5 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Pinned messages"
          >
            <Pin size={20} />
          </button>
        )}

        {/* Member list toggle - only for channels */}
        {type === 'channel' && onToggleMemberList && (
          <button
            className={`hidden sm:flex p-1.5 rounded transition-colors ${
              memberListVisible
                ? 'bg-[var(--discord-active)] text-[var(--text-primary)]'
                : 'hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            onClick={onToggleMemberList}
            aria-label="Toggle member list"
            aria-pressed={memberListVisible}
          >
            <Users size={20} />
          </button>
        )}

        {/* Search */}
        <div className="hidden md:flex items-center">
          <button
            className="flex items-center gap-2 px-2 py-1 rounded bg-gradient-to-r from-zinc-800 to-zinc-700 text-zinc-400 text-sm hover:from-zinc-700 hover:to-zinc-600 hover:text-zinc-300 transition-all border border-zinc-700/50"
            onClick={onOpenSearch}
            aria-label="Search"
          >
            <span className="hidden lg:inline">Search</span>
            <Search size={16} />
          </button>
        </div>

        {/* Mobile search */}
        <button
          className="md:hidden p-1.5 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          onClick={onOpenSearch}
          aria-label="Search"
        >
          <Search size={20} />
        </button>

        {/* Inbox/Notifications */}
        <button
          className="relative p-1.5 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          onClick={onOpenNotifications}
          aria-label="Notifications"
        >
          <Inbox size={20} />
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center px-1 text-xs font-bold bg-[var(--accent-danger)] text-white rounded-full">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </button>

        {/* Help */}
        <button
          onClick={onOpenHelp}
          className="hidden sm:flex p-1.5 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Help"
        >
          <HelpCircle size={20} />
        </button>

        {/* Settings */}
        <button
          className="p-1.5 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}

export default Header;
