'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Plus,
  Hash,
  Volume2,
  ChevronDown,
  ChevronRight,
  Settings,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  X,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { truncatePublicId as truncateId } from '@/lib/format';

export interface Community {
  id: string;
  name: string;
  icon?: string | null;
  unreadCount?: number;
  hasNotification?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  unreadCount?: number;
  isActive?: boolean;
}

export interface DirectMessage {
  id: string;
  recipientId: string;
  recipientImageUrl?: string | null;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  unreadCount?: number;
  isActive?: boolean;
}

export interface CurrentUser {
  publicId: string;
  imageUrl?: string | null;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  isMuted?: boolean;
  isDeafened?: boolean;
}

export interface SidebarProps {
  /** List of communities the user is in */
  communities: Community[];
  /** Currently selected community ID */
  activeCommunityId?: string | null;
  /** Channels in the active community */
  channels?: Channel[];
  /** Direct messages */
  directMessages: DirectMessage[];
  /** Current user info */
  currentUser: CurrentUser;
  /** Whether viewing DMs section */
  isDMView?: boolean;
  /** Community selection handler */
  onSelectCommunity?: (communityId: string) => void;
  /** Channel selection handler */
  onSelectChannel?: (channelId: string) => void;
  /** DM selection handler */
  onSelectDM?: (dmId: string) => void;
  /** Switch to DM view */
  onSwitchToDMs?: () => void;
  /** Add community handler */
  onAddCommunity?: () => void;
  /** Add channel handler */
  onAddChannel?: () => void;
  /** User settings handler */
  onUserSettings?: () => void;
  /** Toggle mute handler */
  onToggleMute?: () => void;
  /** Toggle deafen handler */
  onToggleDeafen?: () => void;
  /** Mobile close handler */
  onMobileClose?: () => void;
  /** Whether sidebar is in mobile mode */
  isMobile?: boolean;
}

export const Sidebar = React.memo(function Sidebar({
  communities,
  activeCommunityId,
  channels = [],
  directMessages,
  currentUser,
  isDMView = false,
  onSelectCommunity,
  onSelectChannel,
  onSelectDM,
  onSwitchToDMs,
  onAddCommunity,
  onAddChannel,
  onUserSettings,
  onToggleMute,
  onToggleDeafen,
  onMobileClose,
  isMobile = false,
}: SidebarProps) {
  const [channelsExpanded, setChannelsExpanded] = useState(true);
  const [dmsExpanded, setDmsExpanded] = useState(true);

  // Group channels by category (for now, just one group)
  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  return (
    <div className="flex h-full">
      {/* Server/Community list - narrow strip with void gradient */}
      <div className="w-[72px] bg-gradient-to-b from-black via-zinc-950 to-black flex flex-col items-center py-3 gap-2 min-h-0 overflow-y-auto scrollbar-hidden border-r border-zinc-800/30">
        {/* Home/DMs button - Void Chat Logo */}
        <div className="relative group">
          <div
            className={`server-icon ${isDMView ? 'active' : ''} overflow-hidden`}
            onClick={onSwitchToDMs}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSwitchToDMs?.();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Direct Messages"
          >
            <Image
              src="/images/logo.png"
              alt="Void Chat"
              width={48}
              height={48}
              className="w-full h-full object-cover"
            />
          </div>
          {isDMView && (
            <span className="server-icon-indicator h-10 top-1" />
          )}
          {/* Tooltip */}
          <div className="tooltip left-full ml-4 top-1/2 -translate-y-1/2 group-hover:opacity-100">
            Direct Messages
          </div>
        </div>

        {/* Divider */}
        <div className="w-8 h-0.5 bg-gradient-to-r from-transparent via-zinc-600 to-transparent rounded-full" />

        {/* Community icons */}
        {communities.map((community) => (
          <div key={community.id} className="relative group">
            <div
              className={`server-icon ${activeCommunityId === community.id ? 'active' : ''}`}
              onClick={() => onSelectCommunity?.(community.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectCommunity?.(community.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={community.name}
            >
              {community.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={community.icon}
                  alt={community.name}
                  className="w-full h-full rounded-[inherit] object-cover"
                />
              ) : (
                <span className="text-sm font-semibold text-white">
                  {community.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            {/* Active indicator */}
            {activeCommunityId === community.id && (
              <span className="server-icon-indicator h-10 top-1" />
            )}
            {/* Hover indicator */}
            {activeCommunityId !== community.id && (
              <span className="server-icon-indicator h-0 group-hover:h-5 top-3.5" />
            )}
            {/* Notification badge */}
            {community.unreadCount && community.unreadCount > 0 && (
              <span className="absolute -bottom-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-xs font-bold bg-[var(--accent-danger)] text-white rounded-full">
                {community.unreadCount > 99 ? '99+' : community.unreadCount}
              </span>
            )}
            {/* Tooltip */}
            <div className="tooltip left-full ml-4 top-1/2 -translate-y-1/2 group-hover:opacity-100">
              {community.name}
            </div>
          </div>
        ))}

        {/* Add community button */}
        <div className="relative group">
          <div
            className="server-icon hover:bg-gradient-to-r hover:from-zinc-700 hover:to-zinc-500 hover:text-zinc-100 text-zinc-400"
            onClick={onAddCommunity}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAddCommunity?.();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Add a Community"
          >
            <Plus size={24} />
          </div>
          <div className="tooltip left-full ml-4 top-1/2 -translate-y-1/2 group-hover:opacity-100">
            Add a Community
          </div>
        </div>
      </div>

      {/* Channel/DM list */}
      <div className="w-60 bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 flex flex-col min-h-0">
        {/* Header */}
        <div className="h-12 min-h-[48px] flex items-center justify-between px-4 border-b border-zinc-800/50 shadow-lg bg-gradient-to-r from-black/50 to-zinc-900/50 backdrop-blur-sm">
          {isDMView ? (
            <h2 className="font-semibold text-[var(--text-primary)] truncate">
              Direct Messages
            </h2>
          ) : (
            <h2 className="font-semibold text-[var(--text-primary)] truncate">
              {communities.find((c) => c.id === activeCommunityId)?.name || 'Community'}
            </h2>
          )}
          {isMobile && (
            <button
              onClick={onMobileClose}
              className="p-1 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Close sidebar"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pt-4">
          {isDMView ? (
            /* DMs Section */
            <>
              <div
                className="section-header"
                onClick={() => setDmsExpanded(!dmsExpanded)}
              >
                <div className="flex items-center gap-1">
                  {dmsExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <span>Direct Messages</span>
                </div>
                <Plus
                  size={16}
                  className="opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle new DM
                  }}
                />
              </div>
              {dmsExpanded && (
                <div className="space-y-0.5">
                  {directMessages.map((dm) => (
                    <div
                      key={dm.id}
                      className={`channel-item ${dm.isActive ? 'active' : ''}`}
                      onClick={() => onSelectDM?.(dm.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectDM?.(dm.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <Avatar
                        publicId={dm.recipientId}
                        imageUrl={dm.recipientImageUrl}
                        size="sm"
                        status={dm.status}
                        showStatus
                      />
                      <div className="flex-1 min-w-0">
                        <span
                          className="block truncate text-sm"
                          title={dm.recipientId}
                        >
                          {truncateId(dm.recipientId)}
                        </span>
                      </div>
                      {dm.unreadCount && dm.unreadCount > 0 && (
                        <span className="min-w-[18px] h-[18px] flex items-center justify-center px-1 text-xs font-bold bg-[var(--accent-danger)] text-white rounded-full">
                          {dm.unreadCount}
                        </span>
                      )}
                    </div>
                  ))}
                  {directMessages.length === 0 && (
                    <p className="px-4 py-2 text-sm text-[var(--text-muted)]">
                      No direct messages yet
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Channels Section */
            <>
              {/* Text Channels */}
              <div
                className="section-header group"
                onClick={() => setChannelsExpanded(!channelsExpanded)}
              >
                <div className="flex items-center gap-1">
                  {channelsExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <span>Text Channels</span>
                </div>
                <Plus
                  size={16}
                  className="opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddChannel?.();
                  }}
                />
              </div>
              {channelsExpanded && (
                <div className="space-y-0.5">
                  {textChannels.map((channel) => (
                    <div
                      key={channel.id}
                      className={`channel-item ${channel.isActive ? 'active' : ''}`}
                      onClick={() => onSelectChannel?.(channel.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectChannel?.(channel.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <Hash size={18} className="flex-shrink-0 opacity-60" />
                      <span className="flex-1 truncate">{channel.name}</span>
                      {channel.unreadCount && channel.unreadCount > 0 && (
                        <span className="min-w-[18px] h-[18px] flex items-center justify-center px-1 text-xs font-bold bg-[var(--accent-danger)] text-white rounded-full">
                          {channel.unreadCount}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Voice Channels */}
              {voiceChannels.length > 0 && (
                <>
                  <div className="section-header group mt-4">
                    <div className="flex items-center gap-1">
                      <ChevronDown size={12} />
                      <span>Voice Channels</span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {voiceChannels.map((channel) => (
                      <div
                        key={channel.id}
                        className={`channel-item ${channel.isActive ? 'active' : ''}`}
                        onClick={() => onSelectChannel?.(channel.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectChannel?.(channel.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <Volume2 size={18} className="flex-shrink-0 opacity-60" />
                        <span className="flex-1 truncate">{channel.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* User panel */}
        <div className="h-[52px] bg-gradient-to-r from-black via-zinc-950 to-black flex items-center px-2 gap-2 border-t border-zinc-800/50">
          <div className="flex items-center gap-2 flex-1 min-w-0 p-1 rounded hover:bg-[var(--discord-hover)] cursor-pointer">
            <Avatar
              publicId={currentUser.publicId}
              imageUrl={currentUser.imageUrl}
              size="sm"
              status={currentUser.status}
              showStatus
            />
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-medium text-[var(--text-primary)] truncate"
                title={currentUser.publicId}
              >
                {truncateId(currentUser.publicId)}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {currentUser.status === 'online' ? 'Online' : currentUser.status}
              </p>
            </div>
          </div>

          {/* Voice controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleMute}
              className={`p-1.5 rounded transition-colors ${
                currentUser.isMuted
                  ? 'bg-[var(--accent-danger)] text-white'
                  : 'hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              aria-label={currentUser.isMuted ? 'Unmute' : 'Mute'}
              title={currentUser.isMuted ? 'Unmute' : 'Mute'}
            >
              {currentUser.isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              onClick={onToggleDeafen}
              className={`p-1.5 rounded transition-colors ${
                currentUser.isDeafened
                  ? 'bg-[var(--accent-danger)] text-white'
                  : 'hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              aria-label={currentUser.isDeafened ? 'Undeafen' : 'Deafen'}
              title={currentUser.isDeafened ? 'Undeafen' : 'Deafen'}
            >
              {currentUser.isDeafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
            </button>
            <button
              className="p-1.5 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              onClick={onUserSettings}
              aria-label="User Settings"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default Sidebar;
