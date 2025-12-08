'use client';

import React, { useEffect, useCallback } from 'react';
import {
  X,
  Crown,
  Shield,
  AlertTriangle,
  BadgeCheck,
  Coins,
  MessageSquare,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { Avatar } from './Avatar';

export interface UserProfileData {
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
  joinedAt?: string | Date;
  publicKey?: string;
}

export interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfileData | null;
  verifiedHolderThreshold?: bigint | number;
  ownerWallet?: string;
  onStartDM?: (walletAddress: string) => void;
  formatBalance?: (balance: bigint | number) => string;
  currentUserWallet?: string;
}

const DEFAULT_VERIFIED_THRESHOLD = BigInt(1_000_000);

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

function truncateWallet(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getRoleBadge(role: UserProfileData['role'], isOwner: boolean) {
  if (isOwner) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent-gold)]/20 text-[var(--accent-gold)]">
        <Crown size={12} />
        Owner
      </span>
    );
  }
  switch (role) {
    case 'ADMIN':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent-danger)]/20 text-[var(--accent-danger)]">
          <Shield size={12} />
          Admin
        </span>
      );
    case 'MODERATOR':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]">
          <Shield size={12} />
          Moderator
        </span>
      );
    default:
      return null;
  }
}

function getStatusText(status?: string) {
  switch (status) {
    case 'online':
      return 'Online';
    case 'idle':
      return 'Idle';
    case 'dnd':
      return 'Do Not Disturb';
    default:
      return 'Offline';
  }
}

function getStatusColor(status?: string) {
  switch (status) {
    case 'online':
      return 'bg-[var(--status-online)]';
    case 'idle':
      return 'bg-[var(--status-idle)]';
    case 'dnd':
      return 'bg-[var(--status-dnd)]';
    default:
      return 'bg-[var(--status-offline)]';
  }
}

export function UserProfileModal({
  isOpen,
  onClose,
  user,
  verifiedHolderThreshold = DEFAULT_VERIFIED_THRESHOLD,
  ownerWallet,
  onStartDM,
  formatBalance = defaultFormatBalance,
  currentUserWallet,
}: UserProfileModalProps) {
  const [copied, setCopied] = React.useState(false);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Copy wallet address
  const handleCopyWallet = useCallback(async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [user]);

  // Handle DM button click
  const handleStartDM = useCallback(() => {
    if (user && onStartDM) {
      onStartDM(user.walletAddress);
      onClose();
    }
  }, [user, onStartDM, onClose]);

  if (!isOpen || !user) return null;

  const balance = user.tokenBalance ?? 0;
  const threshold =
    typeof verifiedHolderThreshold === 'bigint'
      ? verifiedHolderThreshold
      : BigInt(verifiedHolderThreshold);
  const balanceNum = typeof balance === 'bigint' ? balance : BigInt(balance);
  const isVerifiedHolder = balanceNum >= threshold;
  const hasStrikes = (user.strikes ?? 0) > 0;
  const isOwner = user.walletAddress === ownerWallet;
  const isSelf = user.walletAddress === currentUserWallet;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--discord-secondary)] rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Banner/Header */}
        <div className="relative h-24 bg-gradient-to-br from-[var(--clawed-primary)] to-[var(--clawed-secondary)]">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Avatar - overlapping banner */}
        <div className="relative px-4 -mt-12">
          <div className="w-24 h-24 rounded-full ring-4 ring-[var(--discord-secondary)] overflow-hidden">
            <Avatar
              walletAddress={user.walletAddress}
              imageUrl={user.imageUrl}
              size="xl"
              status={user.status}
              showStatus
            />
          </div>
        </div>

        {/* Content */}
        <div className="px-4 pb-4 pt-2">
          {/* Name and badges */}
          <div className="mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">
                {user.xHandle ? `@${user.xHandle}` : truncateWallet(user.walletAddress)}
              </h2>
              {user.xVerified && (
                <BadgeCheck size={18} className="text-[var(--text-link)]" />
              )}
            </div>
            {user.xHandle && (
              <p className="text-sm text-[var(--text-muted)] font-mono mt-0.5">
                {truncateWallet(user.walletAddress)}
              </p>
            )}
          </div>

          {/* Role and status badges */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {getRoleBadge(user.role, isOwner)}
            {isVerifiedHolder && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent-gold)]/20 text-[var(--accent-gold)]">
                <Coins size={12} />
                Verified Holder
              </span>
            )}
            {hasStrikes && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent-warning)]/20 text-[var(--accent-warning)]">
                <AlertTriangle size={12} />
                {user.strikes} Strike{user.strikes !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 mb-4">
            <span className={`w-3 h-3 rounded-full ${getStatusColor(user.status)}`} />
            <span className="text-sm text-[var(--text-secondary)]">
              {getStatusText(user.status)}
            </span>
          </div>

          {/* Info sections */}
          <div className="space-y-3">
            {/* Token balance */}
            <div className="p-3 bg-[var(--discord-dark)] rounded-lg">
              <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">
                $CLAWED Balance
              </p>
              <div className="flex items-center gap-2 text-[var(--clawed-secondary)]">
                <Coins size={16} />
                <span className="font-semibold">{formatBalance(balance)}</span>
              </div>
            </div>

            {/* Wallet address */}
            <div className="p-3 bg-[var(--discord-dark)] rounded-lg">
              <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">
                Wallet Address
              </p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-[var(--text-secondary)] font-mono truncate">
                  {user.walletAddress}
                </p>
                <button
                  onClick={handleCopyWallet}
                  className="flex-shrink-0 p-1.5 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Copy wallet address"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {/* X/Twitter link */}
            {user.xHandle && (
              <div className="p-3 bg-[var(--discord-dark)] rounded-lg">
                <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">
                  X / Twitter
                </p>
                <a
                  href={`https://x.com/${user.xHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-[var(--text-link)] hover:underline"
                >
                  @{user.xHandle}
                  <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>

          {/* Actions */}
          {!isSelf && onStartDM && (
            <div className="mt-4">
              <button
                onClick={handleStartDM}
                className="w-full py-2.5 px-4 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <MessageSquare size={18} />
                Send Message
              </button>
            </div>
          )}

          {/* View on Solscan */}
          <div className="mt-3 text-center">
            <a
              href={`https://solscan.io/account/${user.walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-link)] transition-colors"
            >
              View on Solscan
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UserProfileModal;
