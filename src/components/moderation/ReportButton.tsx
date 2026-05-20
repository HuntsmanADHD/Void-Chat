'use client';

/**
 * Void Chat - Report Button Component
 *
 * Small flag icon button that opens the ReportModal.
 * Can be used on messages or user profiles.
 */

import React, { useState, useCallback } from 'react';
import { ReportModal, ReportSubmission } from './ReportModal';

// =============================================================================
// TYPES
// =============================================================================

export interface ReportButtonProps {
  /** ID of the user to report */
  userId: string;
  /** Display name of the user (optional) */
  userName?: string;
  /** Optional ID of the message being reported */
  messageId?: string;
  /** Callback when report is submitted */
  onReport?: (submission: ReportSubmission) => Promise<void>;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show text label */
  showLabel?: boolean;
  /** Custom className */
  className?: string;
  /** Disable the button */
  disabled?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ReportButton({
  userId,
  userName,
  messageId,
  onReport,
  size = 'sm',
  showLabel = false,
  className = '',
  disabled = false,
}: ReportButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentlySubmitted, setRecentlySubmitted] = useState(false);

  const handleOpenModal = useCallback(() => {
    if (!disabled && !recentlySubmitted) {
      setIsModalOpen(true);
    }
  }, [disabled, recentlySubmitted]);

  const handleCloseModal = useCallback(() => {
    if (!isSubmitting) {
      setIsModalOpen(false);
    }
  }, [isSubmitting]);

  const handleSubmit = useCallback(
    async (submission: ReportSubmission) => {
      setIsSubmitting(true);
      try {
        if (onReport) {
          await onReport(submission);
        } else {
          // Default: call API endpoint
          const response = await fetch('/api/reports', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(submission),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to submit report');
          }
        }

        // Set cooldown after successful submission
        setRecentlySubmitted(true);
        setTimeout(() => {
          setRecentlySubmitted(false);
        }, 30000); // 30 seconds cooldown
      } finally {
        setIsSubmitting(false);
      }
    },
    [onReport]
  );

  // Size classes
  const sizeClasses = {
    sm: 'p-1.5',
    md: 'p-2',
    lg: 'p-2.5',
  };

  const iconSizes = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <>
      <button
        onClick={handleOpenModal}
        disabled={disabled || recentlySubmitted}
        className={`
          inline-flex items-center gap-1.5
          ${sizeClasses[size]}
          ${recentlySubmitted ? 'text-emerald-400' : 'text-gray-400 hover:text-red-400 hover:bg-red-400/10'}
          rounded-lg transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-red-500/50
          disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent
          ${className}
        `}
        title={recentlySubmitted ? "Report submitted - cooldown active" : "Report user"}
        aria-label={recentlySubmitted ? "Report submitted - cooldown active" : `Report ${userName || 'user'}`}
      >
        {recentlySubmitted ? (
          /* Check Icon */
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={iconSizes[size]}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          /* Flag Icon */
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={iconSizes[size]}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {showLabel && <span className={textSizes[size]}>{recentlySubmitted ? 'Reported' : 'Report'}</span>}
      </button>

      <ReportModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
        userId={userId}
        userName={userName}
        messageId={messageId}
        isSubmitting={isSubmitting}
      />
    </>
  );
}

// =============================================================================
// VARIANTS
// =============================================================================

/**
 * Report button for use on individual messages
 */
export function MessageReportButton({
  userId,
  userName,
  messageId,
  onReport,
  className = '',
}: {
  userId: string;
  userName?: string;
  messageId: string;
  onReport?: (submission: ReportSubmission) => Promise<void>;
  className?: string;
}) {
  return (
    <ReportButton
      userId={userId}
      userName={userName}
      messageId={messageId}
      onReport={onReport}
      size="sm"
      showLabel={false}
      className={`opacity-0 group-hover:opacity-100 ${className}`}
    />
  );
}

/**
 * Report button for use on user profiles
 */
export function ProfileReportButton({
  userId,
  userName,
  onReport,
  className = '',
}: {
  userId: string;
  userName?: string;
  onReport?: (submission: ReportSubmission) => Promise<void>;
  className?: string;
}) {
  return (
    <ReportButton
      userId={userId}
      userName={userName}
      onReport={onReport}
      size="md"
      showLabel={true}
      className={className}
    />
  );
}

/**
 * Report button styled as a dropdown menu item
 */
export function ReportMenuItem({
  userId,
  userName,
  messageId,
  onReport,
  onClick,
}: {
  userId: string;
  userName?: string;
  messageId?: string;
  onReport?: (submission: ReportSubmission) => Promise<void>;
  onClick?: () => void;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentlySubmitted, setRecentlySubmitted] = useState(false);

  const handleClick = useCallback(() => {
    if (!recentlySubmitted) {
      setIsModalOpen(true);
      onClick?.();
    }
  }, [onClick, recentlySubmitted]);

  const handleSubmit = useCallback(
    async (submission: ReportSubmission) => {
      setIsSubmitting(true);
      try {
        if (onReport) {
          await onReport(submission);
        } else {
          const response = await fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submission),
          });
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to submit report');
          }
        }

        // Set cooldown after successful submission
        setRecentlySubmitted(true);
        setTimeout(() => {
          setRecentlySubmitted(false);
        }, 30000); // 30 seconds cooldown
      } finally {
        setIsSubmitting(false);
      }
    },
    [onReport]
  );

  return (
    <>
      <button
        onClick={handleClick}
        disabled={recentlySubmitted}
        className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
          recentlySubmitted
            ? 'text-emerald-400 cursor-not-allowed opacity-50'
            : 'text-gray-300 hover:text-red-400 hover:bg-red-400/10'
        }`}
        title={recentlySubmitted ? "Report submitted - cooldown active" : undefined}
      >
        {recentlySubmitted ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {recentlySubmitted ? 'Reported' : 'Report'}
      </button>

      <ReportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        userId={userId}
        userName={userName}
        messageId={messageId}
        isSubmitting={isSubmitting}
      />
    </>
  );
}

export default ReportButton;
