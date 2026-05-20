'use client';

import React, { useState, useCallback, ReactNode } from 'react';
import { Sidebar, type Community, type Channel, type DirectMessage, type CurrentUser } from './Sidebar';
import { Header, type HeaderUser } from './Header';
import { MemberList, type Member } from './MemberList';
import { truncatePublicId as truncateId } from '@/lib/format';

export interface AppLayoutProps {
  /** List of communities the user is in */
  communities: Community[];
  /** Currently selected community ID */
  activeCommunityId?: string | null;
  /** Channels in the active community */
  channels?: Channel[];
  /** Direct messages */
  directMessages: DirectMessage[];
  /** Members in the active community */
  members?: Member[];
  /** Current user info */
  currentUser: CurrentUser;
  /** Active channel info for header */
  activeChannel?: {
    id: string;
    name: string;
    description?: string;
  } | null;
  /** Active DM recipient for header and member list */
  activeDMUser?: HeaderUser & Member;
  /** Whether viewing DMs section */
  isDMView?: boolean;
  /** Community owner ID for member list */
  communityOwnerId?: string;
  /** Notification count for header */
  notificationCount?: number;
  /** Main content (message area) */
  children: ReactNode;
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
  /** Member click handler */
  onMemberClick?: (member: Member) => void;
}

export const AppLayout = React.memo(function AppLayout({
  communities,
  activeCommunityId,
  channels = [],
  directMessages,
  members = [],
  currentUser,
  activeChannel,
  activeDMUser,
  isDMView = false,
  communityOwnerId,
  communityOwnerId,
  notificationCount = 0,
  children,
  onSelectCommunity,
  onSelectChannel,
  onSelectDM,
  onSwitchToDMs,
  onAddCommunity,
  onAddChannel,
  onUserSettings,
  onToggleMute,
  onToggleDeafen,
  onOpenSearch,
  onOpenNotifications,
  onOpenSettings,
  onOpenPinned,
  onOpenHelp,
  onMemberClick,
}: AppLayoutProps) {
  // Mobile sidebar state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Member list visibility state
  const [memberListVisible, setMemberListVisible] = useState(true);

  const toggleMobileSidebar = useCallback(() => {
    setMobileSidebarOpen((prev) => !prev);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const toggleMemberList = useCallback(() => {
    setMemberListVisible((prev) => !prev);
  }, []);

  // Determine header type and content
  const headerType = isDMView ? 'dm' : 'channel';
  const headerName = isDMView
    ? activeDMUser?.publicId
      ? truncateId(activeDMUser.publicId)
      : 'Direct Message'
    : activeChannel?.name || 'general';
  const headerDescription = !isDMView ? activeChannel?.description : undefined;

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-black">
      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-gradient-to-br from-black/70 via-zinc-900/60 to-black/70 z-40 md:hidden backdrop-blur-sm"
          onClick={closeMobileSidebar}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar */}
      <div
        className={`
          fixed md:relative inset-y-0 left-0 z-50
          transform transition-transform duration-200 ease-in-out
          ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <Sidebar
          communities={communities}
          activeCommunityId={activeCommunityId}
          channels={channels}
          directMessages={directMessages}
          currentUser={currentUser}
          isDMView={isDMView}
          onSelectCommunity={(id) => {
            onSelectCommunity?.(id);
            closeMobileSidebar();
          }}
          onSelectChannel={(id) => {
            onSelectChannel?.(id);
            closeMobileSidebar();
          }}
          onSelectDM={(id) => {
            onSelectDM?.(id);
            closeMobileSidebar();
          }}
          onSwitchToDMs={() => {
            onSwitchToDMs?.();
            closeMobileSidebar();
          }}
          onAddCommunity={onAddCommunity}
          onAddChannel={onAddChannel}
          onUserSettings={onUserSettings}
          onToggleMute={onToggleMute}
          onToggleDeafen={onToggleDeafen}
          onMobileClose={closeMobileSidebar}
          isMobile={mobileSidebarOpen}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <Header
          type={headerType}
          name={headerName}
          description={headerDescription}
          dmUser={isDMView ? activeDMUser : undefined}
          memberListVisible={memberListVisible}
          onToggleMemberList={!isDMView ? toggleMemberList : undefined}
          onToggleMobileSidebar={toggleMobileSidebar}
          onOpenSearch={onOpenSearch}
          onOpenNotifications={onOpenNotifications}
          onOpenSettings={onOpenSettings}
          onOpenPinned={onOpenPinned}
          onOpenHelp={onOpenHelp}
          notificationCount={notificationCount}
        />

        {/* Content + Member list wrapper */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Message area */}
          <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-gradient-to-br from-zinc-950 via-black to-zinc-950">
            {children}
          </main>

          {/* Right Sidebar - Member list or User profile */}
          <div
            className={`
              hidden lg:block transition-all duration-200 ease-in-out
              ${memberListVisible ? 'w-60' : 'w-0 overflow-hidden'}
            `}
          >
            {memberListVisible && (
              <MemberList
                members={members}
                ownerId={communityOwnerId}
                ownerId={communityOwnerId}
                onMemberClick={onMemberClick}
                isDM={isDMView}
                dmUser={activeDMUser}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default AppLayout;
