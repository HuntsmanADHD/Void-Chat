'use client';

import React from 'react';
import { Crown } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { truncatePublicId } from '@/lib/format';

export interface Member {
  id: string;
  publicId: string;
  imageUrl?: string | null;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  role?: 'OWNER' | 'MEMBER';
  isOnline?: boolean;
}

export interface MemberListProps {
  /** List of members to display */
  members: Member[];
  /** Community owner ID (for crown icon) */
  ownerId?: string;
  /** Click handler for member */
  onMemberClick?: (member: Member) => void;
  /** Whether this is for a DM (shows user profile instead) */
  isDM?: boolean;
  /** DM user for profile view */
  dmUser?: Member;
}

function getRoleIcon(role: Member['role'], isOwner: boolean) {
  if (isOwner) {
    return <Crown size={14} className="text-zinc-300" />;
  }
  return null;
}

interface MemberItemProps {
  member: Member;
  isOwner: boolean;
  onClick?: () => void;
}

const MemberItem = React.memo(function MemberItem({
  member,
  isOwner,
  onClick,
}: MemberItemProps) {
  return (
    <div
      className="member-item group"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <Avatar
        publicId={member.publicId}
        imageUrl={member.imageUrl}
        size="sm"
        status={member.status}
        showStatus
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {getRoleIcon(member.role, isOwner)}
          <span
            className="text-sm text-[var(--text-secondary)] truncate group-hover:text-[var(--text-primary)]"
            title={member.publicId}
          >
            {truncatePublicId(member.publicId)}
          </span>
        </div>
      </div>
    </div>
  );
});

interface UserProfileProps {
  user: Member;
}

function UserProfile({ user }: UserProfileProps) {
  return (
    <div className="p-4">
      {/* Profile header */}
      <div className="flex flex-col items-center text-center mb-4">
        <Avatar
          publicId={user.publicId}
          imageUrl={user.imageUrl}
          size="xl"
          status={user.status}
          showStatus
        />
        <div className="mt-3">
          <h3
            className="text-lg font-semibold text-[var(--text-primary)]"
            title={user.publicId}
          >
            {truncatePublicId(user.publicId)}
          </h3>
        </div>
      </div>

      {/* Public ID */}
      <div className="bg-[var(--discord-dark)] rounded-lg p-3">
        <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">
          Public ID
        </p>
        <p className="text-sm text-[var(--text-secondary)] font-mono break-all">
          {user.publicId}
        </p>
      </div>

      {/* Status */}
      <div className="mt-4 flex items-center justify-center gap-2">
        <span
          className={`w-3 h-3 rounded-full ${
            user.status === 'online'
              ? 'bg-[var(--status-online)]'
              : user.status === 'idle'
              ? 'bg-[var(--status-idle)]'
              : user.status === 'dnd'
              ? 'bg-[var(--status-dnd)]'
              : 'bg-[var(--status-offline)]'
          }`}
        />
        <span className="text-sm text-[var(--text-muted)] capitalize">
          {user.status || 'offline'}
        </span>
      </div>
    </div>
  );
}

export function MemberList({
  members,
  ownerId,
  onMemberClick,
  isDM = false,
  dmUser,
}: MemberListProps) {
  // If DM view, show user profile instead of member list
  if (isDM && dmUser) {
    return (
      <div className="w-60 bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 border-l border-zinc-800/50 h-full min-h-0 overflow-y-auto">
        <UserProfile user={dmUser} />
      </div>
    );
  }

  // Group members by online status
  const onlineMembers = members.filter(
    (m) => m.status === 'online' || m.status === 'idle' || m.status === 'dnd'
  );
  const offlineMembers = members.filter(
    (m) => !m.status || m.status === 'offline'
  );

  // Sort by role priority: Owner > Member
  const sortByRole = (a: Member, b: Member) => {
    const roleOrder: Record<string, number> = { OWNER: 0, MEMBER: 1 };
    const aIsOwner = a.publicId === ownerId;
    const bIsOwner = b.publicId === ownerId;
    if (aIsOwner) return -1;
    if (bIsOwner) return 1;
    const aOrder = roleOrder[a.role || 'MEMBER'];
    const bOrder = roleOrder[b.role || 'MEMBER'];
    return aOrder - bOrder;
  };

  const sortedOnline = [...onlineMembers].sort(sortByRole);
  const sortedOffline = [...offlineMembers].sort(sortByRole);

  return (
    <div className="w-60 bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 border-l border-zinc-800/50 h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="py-4">
        {/* Online members */}
        {sortedOnline.length > 0 && (
          <>
            <div className="section-header">
              <span>Online - {sortedOnline.length}</span>
            </div>
            <div className="space-y-0.5">
              {sortedOnline.map((member) => (
                <MemberItem
                  key={member.id}
                  member={member}
                  isOwner={member.publicId === ownerId}
                  onClick={() => onMemberClick?.(member)}
                />
              ))}
            </div>
          </>
        )}

        {/* Offline members */}
        {sortedOffline.length > 0 && (
          <>
            <div className="section-header mt-4">
              <span>Offline - {sortedOffline.length}</span>
            </div>
            <div className="space-y-0.5">
              {sortedOffline.map((member) => (
                <MemberItem
                  key={member.id}
                  member={member}
                  isOwner={member.publicId === ownerId}
                  onClick={() => onMemberClick?.(member)}
                />
              ))}
            </div>
          </>
        )}

        {/* Empty state */}
        {members.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">No members yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default MemberList;
