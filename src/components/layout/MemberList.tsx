'use client';

import React from 'react';
import { Crown, Shield, AlertTriangle, BadgeCheck, Coins } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { truncateWallet } from '@/lib/format';

export interface Member {
  id: string;
  walletAddress: string;
  xHandle?: string | null;
  xVerified?: boolean;
  imageUrl?: string | null;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  role?: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  tokenBalance?: bigint | number;
  strikes?: number;
  isOnline?: boolean;
}

export interface MemberListProps {
  /** List of members to display */
  members: Member[];
  /** Token balance threshold for "Verified Holder" badge */
  verifiedHolderThreshold?: bigint | number;
  /** Community owner wallet (for crown icon) */
  ownerWallet?: string;
  /** Click handler for member */
  onMemberClick?: (member: Member) => void;
  /** Whether this is for a DM (shows user profile instead) */
  isDM?: boolean;
  /** DM user for profile view */
  dmUser?: Member;
  /** Format token balance for display */
  formatBalance?: (balance: bigint | number) => string;
}

const DEFAULT_VERIFIED_THRESHOLD = BigInt(1_000_000); // 1M tokens

function defaultFormatBalance(balance: bigint | number): string {
  const num = typeof balance === 'bigint' ? Number(balance) : balance;
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

function getRoleIcon(role: Member['role'], isOwner: boolean) {
  if (isOwner) {
    return <Crown size={14} className="text-zinc-300" />;
  }
  switch (role) {
    case 'ADMIN':
      return <Shield size={14} className="text-zinc-400" />;
    case 'MODERATOR':
      return <Shield size={14} className="text-zinc-500" />;
    default:
      return null;
  }
}

interface MemberItemProps {
  member: Member;
  isOwner: boolean;
  verifiedThreshold: bigint | number;
  formatBalance: (balance: bigint | number) => string;
  onClick?: () => void;
}

const MemberItem = React.memo(function MemberItem({
  member,
  isOwner,
  verifiedThreshold,
  formatBalance,
  onClick,
}: MemberItemProps) {
  const balance = member.tokenBalance ?? 0;
  const threshold = typeof verifiedThreshold === 'bigint'
    ? verifiedThreshold
    : BigInt(verifiedThreshold);
  const balanceNum = typeof balance === 'bigint' ? balance : BigInt(balance);
  const isVerifiedHolder = balanceNum >= threshold;
  const hasStrikes = (member.strikes ?? 0) > 0;

  return (
    <div
      className="member-item group"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <Avatar
        walletAddress={member.walletAddress}
        imageUrl={member.imageUrl}
        size="sm"
        status={member.status}
        showStatus
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {/* Role icon */}
          {getRoleIcon(member.role, isOwner)}

          {/* Name */}
          <span
            className="text-sm text-[var(--text-secondary)] truncate group-hover:text-[var(--text-primary)]"
            title={member.walletAddress}
          >
            {member.xHandle ? `@${member.xHandle}` : truncateWallet(member.walletAddress)}
          </span>

          {/* X verified badge */}
          {member.xVerified && (
            <BadgeCheck size={14} className="text-zinc-400 flex-shrink-0" />
          )}

          {/* Verified holder badge */}
          {isVerifiedHolder && (
            <span className="verified-holder flex-shrink-0" title="Verified Holder">
              <Coins size={14} />
            </span>
          )}

          {/* Strike indicator */}
          {hasStrikes && (
            <span
              className="strike-indicator flex-shrink-0"
              title={`${member.strikes} strike${member.strikes !== 1 ? 's' : ''}`}
            >
              <AlertTriangle size={14} />
            </span>
          )}
        </div>

        {/* Token balance - shown on hover or for high balances */}
        {balance > 0 && (
          <div className="flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-xs text-[var(--clawed-secondary)] font-mono">
              {formatBalance(balance)} $CLAWED
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

interface UserProfileProps {
  user: Member;
  verifiedThreshold: bigint | number;
  formatBalance: (balance: bigint | number) => string;
}

function UserProfile({ user, verifiedThreshold, formatBalance }: UserProfileProps) {
  const balance = user.tokenBalance ?? 0;
  const threshold = typeof verifiedThreshold === 'bigint'
    ? verifiedThreshold
    : BigInt(verifiedThreshold);
  const balanceNum = typeof balance === 'bigint' ? balance : BigInt(balance);
  const isVerifiedHolder = balanceNum >= threshold;
  const hasStrikes = (user.strikes ?? 0) > 0;

  return (
    <div className="p-4">
      {/* Profile header */}
      <div className="flex flex-col items-center text-center mb-4">
        <Avatar
          walletAddress={user.walletAddress}
          imageUrl={user.imageUrl}
          size="xl"
          status={user.status}
          showStatus
        />
        <div className="mt-3">
          <h3
            className="text-lg font-semibold text-[var(--text-primary)]"
            title={user.walletAddress}
          >
            {user.xHandle ? `@${user.xHandle}` : truncateWallet(user.walletAddress)}
          </h3>
          {user.xHandle && (
            <p className="wallet-address mt-1" title={user.walletAddress}>
              {truncateWallet(user.walletAddress)}
            </p>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap justify-center gap-2 mb-4">
        {user.xVerified && (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-zinc-700 to-zinc-600 text-zinc-200 border border-zinc-500/30">
            <BadgeCheck size={12} className="mr-1" />
            X Verified
          </span>
        )}
        {isVerifiedHolder && (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-zinc-600 to-zinc-500 text-zinc-100 border border-zinc-400/30">
            <Coins size={12} className="mr-1" />
            Verified Holder
          </span>
        )}
        {hasStrikes && (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-zinc-800 to-zinc-700 text-zinc-300 border border-zinc-600/30">
            <AlertTriangle size={12} className="mr-1" />
            {user.strikes} Strike{user.strikes !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Token balance */}
      <div className="bg-[var(--discord-dark)] rounded-lg p-3 mb-4">
        <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">
          Token Balance
        </p>
        <div className="token-balance justify-center">
          <Coins size={16} />
          <span>{formatBalance(balance)} $CLAWED</span>
        </div>
      </div>

      {/* Wallet address */}
      <div className="bg-[var(--discord-dark)] rounded-lg p-3">
        <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">
          Wallet Address
        </p>
        <p className="text-sm text-[var(--text-secondary)] font-mono break-all">
          {user.walletAddress}
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
  verifiedHolderThreshold = DEFAULT_VERIFIED_THRESHOLD,
  ownerWallet,
  onMemberClick,
  isDM = false,
  dmUser,
  formatBalance = defaultFormatBalance,
}: MemberListProps) {
  // If DM view, show user profile instead of member list
  if (isDM && dmUser) {
    return (
      <div className="w-60 bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 border-l border-zinc-800/50 h-full min-h-0 overflow-y-auto">
        <UserProfile
          user={dmUser}
          verifiedThreshold={verifiedHolderThreshold}
          formatBalance={formatBalance}
        />
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

  // Sort by role priority: Owner > Admin > Moderator > Member
  const sortByRole = (a: Member, b: Member) => {
    const roleOrder = { OWNER: 0, ADMIN: 1, MODERATOR: 2, MEMBER: 3 };
    const aIsOwner = a.walletAddress === ownerWallet;
    const bIsOwner = b.walletAddress === ownerWallet;
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
                  isOwner={member.walletAddress === ownerWallet}
                  verifiedThreshold={verifiedHolderThreshold}
                  formatBalance={formatBalance}
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
                  isOwner={member.walletAddress === ownerWallet}
                  verifiedThreshold={verifiedHolderThreshold}
                  formatBalance={formatBalance}
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
