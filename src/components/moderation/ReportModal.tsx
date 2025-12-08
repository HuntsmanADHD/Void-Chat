'use client';

/**
 * Clawed Messenger - Report Modal Component
 *
 * Modal dialog for reporting users or messages.
 * Allows selection of report category and description.
 * Dark theme, accessible design.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export type ReportCategory = 'SPAM' | 'HARASSMENT' | 'SCAM' | 'ILLEGAL' | 'OTHER';

export interface ReportModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Callback when report is submitted */
  onSubmit: (data: ReportSubmission) => Promise<void>;
  /** ID of the user being reported */
  userId: string;
  /** Display name or wallet address of the user being reported */
  userName?: string;
  /** Optional ID of the message being reported */
  messageId?: string;
  /** Whether submission is in progress */
  isSubmitting?: boolean;
}

export interface ReportSubmission {
  userId: string;
  messageId?: string;
  category: ReportCategory;
  description: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const REPORT_CATEGORIES: { value: ReportCategory; label: string; description: string }[] = [
  {
    value: 'SPAM',
    label: 'Spam',
    description: 'Unsolicited advertising, repetitive messages, or promotional content',
  },
  {
    value: 'HARASSMENT',
    label: 'Harassment',
    description: 'Bullying, threats, personal attacks, or targeted abuse',
  },
  {
    value: 'SCAM',
    label: 'Scam',
    description: 'Fraudulent schemes, phishing attempts, or deceptive practices',
  },
  {
    value: 'ILLEGAL',
    label: 'Illegal Content',
    description: 'Content that violates laws or promotes illegal activities',
  },
  {
    value: 'OTHER',
    label: 'Other',
    description: 'Other violations not covered by the above categories',
  },
];

const MIN_DESCRIPTION_LENGTH = 10;
const MAX_DESCRIPTION_LENGTH = 1000;

// =============================================================================
// COMPONENT
// =============================================================================

export function ReportModal({
  isOpen,
  onClose,
  onSubmit,
  userId,
  userName,
  messageId,
  isSubmitting = false,
}: ReportModalProps) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setCategory(null);
      setDescription('');
      setError(null);
      setShowSuccess(false);
    }
  }, [isOpen]);

  // Focus trap and escape key handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    // Focus first focusable element
    firstFocusableRef.current?.focus();

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isSubmitting]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    // Validation
    if (!category) {
      setError('Please select a report category');
      return;
    }

    if (description.trim().length < MIN_DESCRIPTION_LENGTH) {
      setError(`Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`);
      return;
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      setError(`Description must be less than ${MAX_DESCRIPTION_LENGTH} characters`);
      return;
    }

    setError(null);

    try {
      await onSubmit({
        userId,
        messageId,
        category,
        description: description.trim(),
      });
      setShowSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    }
  }, [category, description, userId, messageId, onSubmit]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isSubmitting) {
        onClose();
      }
    },
    [onClose, isSubmitting]
  );

  if (!isOpen) return null;

  const displayName = userName || `${userId.slice(0, 8)}...`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-lg mx-4 bg-gray-900 rounded-lg shadow-2xl border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {!showSuccess && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
            <h2 id="report-modal-title" className="text-xl font-semibold text-white">
              Report User
            </h2>
            <button
              ref={firstFocusableRef}
              onClick={onClose}
              disabled={isSubmitting}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Close modal"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Success View */}
        {showSuccess ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Report Submitted</h3>
            <p className="text-zinc-400 mb-6">Thank you for helping keep Clawed safe. Our team will review this report.</p>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Content */}
            <div className="px-6 py-4 space-y-6">
          {/* User being reported */}
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <p className="text-sm text-gray-400">Reporting user:</p>
            <p className="text-white font-medium truncate">{displayName}</p>
            {messageId && (
              <p className="text-xs text-gray-500 mt-1">
                Including message reference
              </p>
            )}
          </div>

          {/* Category Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              What is the issue? <span className="text-red-400">*</span>
            </label>
            <div className="space-y-2">
              {REPORT_CATEGORIES.map((cat) => (
                <label
                  key={cat.value}
                  className={`flex items-start p-3 rounded-lg border cursor-pointer transition-all ${
                    category === cat.value
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-gray-700 hover:border-gray-600 bg-gray-800/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="report-category"
                    value={cat.value}
                    checked={category === cat.value}
                    onChange={() => setCategory(cat.value)}
                    disabled={isSubmitting}
                    className="mt-1 h-4 w-4 text-indigo-500 border-gray-600 focus:ring-indigo-500 focus:ring-offset-gray-900"
                  />
                  <div className="ml-3">
                    <span className="block text-white font-medium">{cat.label}</span>
                    <span className="block text-sm text-gray-400">{cat.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="report-description"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Describe the issue <span className="text-red-400">*</span>
            </label>
            <textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              placeholder="Please provide details about the issue..."
              rows={4}
              maxLength={MAX_DESCRIPTION_LENGTH}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex justify-between mt-1">
              <p className="text-xs text-gray-500">
                Minimum {MIN_DESCRIPTION_LENGTH} characters
              </p>
              <p
                className={`text-xs ${
                  description.length > MAX_DESCRIPTION_LENGTH * 0.9
                    ? 'text-yellow-400'
                    : 'text-gray-500'
                }`}
              >
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Warning */}
          <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
            <p className="text-sm text-yellow-400/90">
              False reports may result in action against your account. Only submit reports for
              genuine violations.
            </p>
          </div>
        </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !category || description.trim().length < MIN_DESCRIPTION_LENGTH}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
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
                    Submitting...
                  </>
                ) : (
                  <>
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
                    Submit Report
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ReportModal;
