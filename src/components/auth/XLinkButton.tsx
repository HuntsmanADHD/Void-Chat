'use client';

/**
 * XLinkButton Component
 *
 * Button for linking/unlinking X (Twitter) account to wallet.
 * Only visible when wallet is connected.
 *
 * Features:
 * - Link X account via OAuth
 * - Display linked X handle
 * - Unlink X account
 * - Dark theme styling matching Discord aesthetic
 * - Loading and error states
 */

import { FC, useState, useCallback } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { useXAuth } from '@/hooks/useXAuth';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import { formatXHandle, getXProfileUrl } from '@/lib/x-auth';

/**
 * X (Twitter) icon component
 */
const XIcon: FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={className}
    fill="currentColor"
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

/**
 * Check icon for verified status
 */
const CheckIcon: FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    className={className}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

/**
 * Link icon
 */
const LinkIcon: FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    className={className}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
    />
  </svg>
);

/**
 * Unlink icon
 */
const UnlinkIcon: FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    className={className}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13.181 8.68a4.503 4.503 0 011.903 6.405m-9.768-2.782L3.56 14.06a4.5 4.5 0 006.364 6.364l3.182-3.182m0 0l-1.414-1.414m1.414 1.414l1.414 1.414m-1.414-1.414L11.05 14.97m8.39-8.388l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-3.182 3.182m0 0l1.414 1.414m-1.414-1.414L10.236 3.06"
    />
  </svg>
);

/**
 * Loading spinner component
 */
const LoadingSpinner: FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    className={`animate-spin ${className}`}
    fill="none"
    viewBox="0 0 24 24"
  >
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
);

interface XLinkButtonProps {
  /** Additional CSS classes */
  className?: string;
  /** Compact mode - smaller button */
  compact?: boolean;
  /** Show verification badge */
  showVerificationBadge?: boolean;
  /** Callback when link status changes */
  onLinkStatusChange?: (linked: boolean, handle?: string) => void;
}

/**
 * XLinkButton Component
 *
 * Allows users to link/unlink their X (Twitter) account to their wallet.
 * Only renders when wallet is connected.
 */
export const XLinkButton: FC<XLinkButtonProps> = ({
  className = '',
  compact = false,
  showVerificationBadge = true,
  onLinkStatusChange,
}) => {
  const { isConnected, isAuthenticated } = useWalletAuth();
  const {
    xAccountStatus,
    isLoading,
    isLinking,
    isUnlinking,
    error,
    unlinkXAccount,
    clearError,
  } = useXAuth();

  const [showConfirmUnlink, setShowConfirmUnlink] = useState(false);

  /**
   * Handle link button click
   * Initiates X OAuth flow
   */
  const handleLink = useCallback(async () => {
    clearError();

    // First, initiate OAuth flow with NextAuth
    const result = await signIn('twitter', {
      redirect: false,
      callbackUrl: '/auth/x-link/complete',
    });

    if (result?.error) {
      console.error('[XLinkButton] OAuth error:', result.error);
      return;
    }

    // If OAuth was successful, the callback page will handle linking
    if (result?.url) {
      window.location.href = result.url;
    }
  }, [clearError]);

  /**
   * Handle unlink button click
   * Shows confirmation first
   */
  const handleUnlinkClick = useCallback(() => {
    setShowConfirmUnlink(true);
  }, []);

  /**
   * Confirm and execute unlink
   */
  const handleConfirmUnlink = useCallback(async () => {
    setShowConfirmUnlink(false);

    const success = await unlinkXAccount();

    if (success) {
      // Sign out of NextAuth session
      await signOut({ redirect: false });
      onLinkStatusChange?.(false);
    }
  }, [unlinkXAccount, onLinkStatusChange]);

  /**
   * Cancel unlink
   */
  const handleCancelUnlink = useCallback(() => {
    setShowConfirmUnlink(false);
  }, []);

  // Don't render if wallet is not connected
  if (!isConnected) {
    return null;
  }

  // Don't render if not authenticated with wallet
  if (!isAuthenticated) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-3 py-2 text-zinc-500 text-sm ${className}`}
      >
        <XIcon className="w-4 h-4" />
        <span>Sign in to link X</span>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-3 py-2 bg-zinc-800 rounded-lg text-zinc-400 ${className}`}
      >
        <LoadingSpinner className="w-4 h-4" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  // Linked state - show handle and unlink option
  if (xAccountStatus?.linked && xAccountStatus.xHandle) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {/* X Handle Display */}
        <a
          href={getXProfileUrl(xAccountStatus.xHandle)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 transition-colors"
        >
          <XIcon className="w-4 h-4 text-zinc-300" />
          <span className="text-zinc-200 text-sm font-medium">
            {formatXHandle(xAccountStatus.xHandle)}
          </span>
          {showVerificationBadge && xAccountStatus.xVerified && (
            <CheckIcon className="w-4 h-4 text-emerald-400" />
          )}
        </a>

        {/* Unlink Button or Confirmation */}
        {showConfirmUnlink ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirmUnlink}
              disabled={isUnlinking}
              className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isUnlinking ? (
                <LoadingSpinner className="w-4 h-4" />
              ) : (
                'Confirm'
              )}
            </button>
            <button
              onClick={handleCancelUnlink}
              disabled={isUnlinking}
              className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleUnlinkClick}
            className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
            title="Unlink X account"
          >
            <UnlinkIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // Not linked state - show link button
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        onClick={handleLink}
        disabled={isLinking}
        className={`
          inline-flex items-center justify-center gap-2
          ${compact ? 'px-3 py-1.5' : 'px-4 py-2.5'}
          bg-zinc-800 hover:bg-zinc-700
          border border-zinc-600 hover:border-zinc-500
          rounded-lg
          text-zinc-200 hover:text-white
          ${compact ? 'text-xs' : 'text-sm'}
          font-medium
          transition-all duration-150
          disabled:opacity-50 disabled:cursor-not-allowed
        `}
      >
        {isLinking ? (
          <>
            <LoadingSpinner className="w-4 h-4" />
            <span>Linking...</span>
          </>
        ) : (
          <>
            <XIcon className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
            <span>{compact ? 'Link X' : 'Link X Account'}</span>
            <LinkIcon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </>
        )}
      </button>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg">
          <span className="text-red-400 text-xs">{error}</span>
          <button
            onClick={clearError}
            className="text-red-500 hover:text-red-400 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Helper text */}
      {!compact && !error && (
        <p className="text-zinc-500 text-xs">
          Link your X account for profile transparency
        </p>
      )}
    </div>
  );
};

/**
 * XLinkBadge Component
 *
 * Compact badge showing X link status.
 * For use in user profiles, member lists, etc.
 */
export const XLinkBadge: FC<{
  xHandle?: string | null;
  xVerified?: boolean;
  className?: string;
}> = ({ xHandle, xVerified = false, className = '' }) => {
  if (!xHandle) {
    return null;
  }

  return (
    <a
      href={getXProfileUrl(xHandle)}
      target="_blank"
      rel="noopener noreferrer"
      className={`
        inline-flex items-center gap-1
        px-2 py-0.5
        bg-zinc-800/80 hover:bg-zinc-700
        rounded-full
        text-xs
        transition-colors
        ${className}
      `}
    >
      <XIcon className="w-3 h-3 text-zinc-400" />
      <span className="text-zinc-300">{formatXHandle(xHandle)}</span>
      {xVerified && <CheckIcon className="w-3 h-3 text-emerald-400" />}
    </a>
  );
};

/**
 * XVerificationStatus Component
 *
 * Shows detailed X verification status.
 * For use in settings/profile pages.
 */
export const XVerificationStatus: FC<{
  className?: string;
}> = ({ className = '' }) => {
  const { isConnected, isAuthenticated } = useWalletAuth();
  const { xAccountStatus, isLoading } = useXAuth();

  if (!isConnected || !isAuthenticated) {
    return (
      <div className={`p-4 bg-zinc-900 rounded-xl border border-zinc-800 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-zinc-800 rounded-lg">
            <XIcon className="w-5 h-5 text-zinc-500" />
          </div>
          <div>
            <h4 className="text-zinc-300 font-medium">X Account</h4>
            <p className="text-zinc-500 text-sm">
              Connect wallet to link X account
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`p-4 bg-zinc-900 rounded-xl border border-zinc-800 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-zinc-800 rounded-lg">
            <LoadingSpinner className="w-5 h-5 text-zinc-400" />
          </div>
          <div>
            <h4 className="text-zinc-300 font-medium">X Account</h4>
            <p className="text-zinc-500 text-sm">Loading status...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 bg-zinc-900 rounded-xl border border-zinc-800 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg ${
              xAccountStatus?.linked ? 'bg-emerald-900/30' : 'bg-zinc-800'
            }`}
          >
            <XIcon
              className={`w-5 h-5 ${
                xAccountStatus?.linked ? 'text-emerald-400' : 'text-zinc-500'
              }`}
            />
          </div>
          <div>
            <h4 className="text-zinc-300 font-medium">
              {xAccountStatus?.linked ? 'X Account Linked' : 'X Account'}
            </h4>
            {xAccountStatus?.linked ? (
              <a
                href={getXProfileUrl(xAccountStatus.xHandle!)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                {formatXHandle(xAccountStatus.xHandle!)}
              </a>
            ) : (
              <p className="text-zinc-500 text-sm">
                Optional - adds profile transparency
              </p>
            )}
          </div>
        </div>

        <XLinkButton compact showVerificationBadge={false} />
      </div>

      {xAccountStatus?.linked && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            {xAccountStatus.xVerified ? (
              <>
                <CheckIcon className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400 text-sm">Verified</span>
              </>
            ) : (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-zinc-600" />
                <span className="text-zinc-500 text-sm">Linked</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default XLinkButton;
