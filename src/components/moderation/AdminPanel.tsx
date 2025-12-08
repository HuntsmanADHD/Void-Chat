'use client';

/**
 * Clawed Messenger - Admin Panel Component
 *
 * Admin interface for reviewing and managing reports.
 * Features:
 * - List pending reports
 * - Show reported user, message content, category
 * - Actions: Dismiss, Issue Warning, Issue Strike
 * - Filter by category, date
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { StrikeIndicator } from './StrikeIndicator';

// =============================================================================
// TYPES
// =============================================================================

export type ReportCategory = 'SPAM' | 'HARASSMENT' | 'SCAM' | 'ILLEGAL' | 'OTHER';
export type ReportStatus = 'PENDING' | 'REVIEWED' | 'DISMISSED' | 'ACTION_TAKEN';

export interface ReportUser {
  id: string;
  walletAddress: string;
  xHandle?: string | null;
  strikes?: number;
  isBlacklisted?: boolean;
}

export interface ReportMessage {
  id: string;
  encryptedContent: string;
  nonce: string;
  createdAt: Date | string;
}

export interface Report {
  id: string;
  reporterId: string;
  reportedUserId: string;
  messageId?: string | null;
  category: ReportCategory;
  description: string;
  status: ReportStatus;
  createdAt: Date | string;
  reviewedAt?: Date | string | null;
  reporter: ReportUser;
  reportedUser: ReportUser;
  message?: ReportMessage | null;
}

export interface AdminPanelProps {
  /** List of reports to display */
  reports: Report[];
  /** Whether data is loading */
  isLoading?: boolean;
  /** Callback when dismissing a report */
  onDismiss: (reportId: string) => Promise<void>;
  /** Callback when issuing a warning */
  onWarn: (reportId: string) => Promise<void>;
  /** Callback when issuing a strike */
  onStrike: (reportId: string, userId: string, reason: string) => Promise<void>;
  /** Callback to refresh reports */
  onRefresh?: () => void;
  /** Function to decrypt message content (optional) */
  decryptMessage?: (encryptedContent: string, nonce: string) => Promise<string | null>;
}

type SortField = 'date' | 'category' | 'strikes';
type SortOrder = 'asc' | 'desc';

// =============================================================================
// CONSTANTS
// =============================================================================

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Harassment',
  SCAM: 'Scam',
  ILLEGAL: 'Illegal Content',
  OTHER: 'Other',
};

const CATEGORY_COLORS: Record<ReportCategory, string> = {
  SPAM: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  HARASSMENT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  SCAM: 'bg-red-500/20 text-red-400 border-red-500/30',
  ILLEGAL: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  OTHER: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateWallet(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getTimeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

// =============================================================================
// SUBCOMPONENTS
// =============================================================================

interface ReportCardProps {
  report: Report;
  onDismiss: () => void;
  onWarn: () => void;
  onStrike: () => void;
  isProcessing: boolean;
  decryptedMessage?: string | null;
}

function ReportCard({
  report,
  onDismiss,
  onWarn,
  onStrike,
  isProcessing,
  decryptedMessage,
}: ReportCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [strikeReason, setStrikeReason] = useState('');
  const [showStrikeInput, setShowStrikeInput] = useState(false);

  const handleStrike = useCallback(() => {
    if (strikeReason.trim()) {
      onStrike();
      setShowStrikeInput(false);
      setStrikeReason('');
    }
  }, [onStrike, strikeReason]);

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-3">
          {/* Category Badge */}
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
              CATEGORY_COLORS[report.category]
            }`}
          >
            {CATEGORY_LABELS[report.category]}
          </span>

          {/* Time */}
          <span className="text-sm text-gray-500">
            {getTimeAgo(report.createdAt)}
          </span>
        </div>

        {/* Report ID */}
        <span className="text-xs text-gray-600 font-mono">
          #{report.id.slice(0, 8)}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Users */}
        <div className="grid grid-cols-2 gap-4">
          {/* Reporter */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">
              Reporter
            </label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-gray-300 font-mono text-sm">
                {report.reporter.xHandle || truncateWallet(report.reporter.walletAddress)}
              </span>
            </div>
          </div>

          {/* Reported User */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">
              Reported User
            </label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-white font-mono text-sm">
                {report.reportedUser.xHandle || truncateWallet(report.reportedUser.walletAddress)}
              </span>
              {(report.reportedUser.strikes ?? 0) > 0 && (
                <StrikeIndicator
                  strikeCount={report.reportedUser.strikes ?? 0}
                  isBlacklisted={report.reportedUser.isBlacklisted}
                  size="sm"
                />
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">
            Description
          </label>
          <p className="mt-1 text-gray-300 text-sm">{report.description}</p>
        </div>

        {/* Message Preview (if applicable) */}
        {report.message && (
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">
              Reported Message
            </label>
            <div className="mt-1 p-3 bg-gray-900 rounded-lg border border-gray-700">
              {decryptedMessage !== undefined ? (
                decryptedMessage ? (
                  <p className="text-gray-300 text-sm">{decryptedMessage}</p>
                ) : (
                  <p className="text-gray-500 text-sm italic">
                    Unable to decrypt message (encrypted content)
                  </p>
                )
              ) : (
                <p className="text-gray-500 text-sm italic">
                  Message is encrypted - content unavailable
                </p>
              )}
              <p className="text-xs text-gray-600 mt-2">
                Sent: {formatDate(report.message.createdAt)}
              </p>
            </div>
          </div>
        )}

        {/* Details Toggle */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
          {showDetails ? 'Hide details' : 'Show details'}
        </button>

        {/* Expanded Details */}
        {showDetails && (
          <div className="pt-3 border-t border-gray-700 space-y-2 text-sm text-gray-400">
            <p>
              <span className="text-gray-500">Report ID:</span> {report.id}
            </p>
            <p>
              <span className="text-gray-500">Created:</span> {formatDate(report.createdAt)}
            </p>
            <p>
              <span className="text-gray-500">Reporter Wallet:</span>{' '}
              <span className="font-mono">{report.reporter.walletAddress}</span>
            </p>
            <p>
              <span className="text-gray-500">Reported Wallet:</span>{' '}
              <span className="font-mono">{report.reportedUser.walletAddress}</span>
            </p>
            <p>
              <span className="text-gray-500">Current Strikes:</span>{' '}
              {report.reportedUser.strikes ?? 0}/3
            </p>
          </div>
        )}

        {/* Strike Reason Input */}
        {showStrikeInput && (
          <div className="pt-3 border-t border-gray-700 space-y-2">
            <label className="text-sm text-gray-400">
              Strike Reason (will be shown to user)
            </label>
            <input
              type="text"
              value={strikeReason}
              onChange={(e) => setStrikeReason(e.target.value)}
              placeholder="Enter reason for strike..."
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
              disabled={isProcessing}
            />
            <div className="flex gap-2">
              <button
                onClick={handleStrike}
                disabled={isProcessing || !strikeReason.trim()}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Strike
              </button>
              <button
                onClick={() => {
                  setShowStrikeInput(false);
                  setStrikeReason('');
                }}
                disabled={isProcessing}
                className="px-3 py-1.5 text-gray-400 hover:text-white text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {!showStrikeInput && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-700 bg-gray-800/50">
          <button
            onClick={onDismiss}
            disabled={isProcessing}
            className="px-3 py-1.5 text-gray-400 hover:text-white hover:bg-gray-700 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Dismiss
          </button>
          <button
            onClick={onWarn}
            disabled={isProcessing}
            className="px-3 py-1.5 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 text-sm font-medium rounded-lg border border-yellow-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Issue Warning
          </button>
          <button
            onClick={() => setShowStrikeInput(true)}
            disabled={isProcessing || report.reportedUser.isBlacklisted}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Issue Strike
          </button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function AdminPanel({
  reports,
  isLoading = false,
  onDismiss,
  onWarn,
  onStrike,
  onRefresh,
  decryptMessage,
}: AdminPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<ReportCategory | 'ALL'>('ALL');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [decryptedMessages, setDecryptedMessages] = useState<Record<string, string | null>>({});

  // Filter and sort reports
  const filteredReports = useMemo(() => {
    let result = [...reports];

    // Apply category filter
    if (categoryFilter !== 'ALL') {
      result = result.filter((r) => r.category === categoryFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'date':
          comparison =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
        case 'strikes':
          comparison = (a.reportedUser.strikes ?? 0) - (b.reportedUser.strikes ?? 0);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [reports, categoryFilter, sortField, sortOrder]);

  // Handle actions
  const handleAction = useCallback(
    async (reportId: string, action: () => Promise<void>) => {
      setProcessingIds((prev) => new Set(prev).add(reportId));
      try {
        await action();
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(reportId);
          return next;
        });
      }
    },
    []
  );

  // Decrypt messages when reports change
  useEffect(() => {
    if (!decryptMessage) return;

    const decryptNewMessages = async () => {
      for (const report of filteredReports) {
        if (report.message && !(report.message.id in decryptedMessages)) {
          try {
            const decrypted = await decryptMessage(
              report.message.encryptedContent,
              report.message.nonce
            );
            setDecryptedMessages((prev) => ({ ...prev, [report.message!.id]: decrypted }));
          } catch {
            setDecryptedMessages((prev) => ({ ...prev, [report.message!.id]: null }));
          }
        }
      }
    };

    decryptNewMessages();
  }, [filteredReports, decryptMessage, decryptedMessages]);

  // Category filter counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: reports.length };
    for (const category of Object.keys(CATEGORY_LABELS)) {
      counts[category] = reports.filter((r) => r.category === category).length;
    }
    return counts;
  }, [reports]);

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
        <div>
          <h1 className="text-xl font-semibold text-white">Report Review</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {filteredReports.length} pending report{filteredReports.length !== 1 ? 's' : ''}
          </p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg disabled:opacity-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                clipRule="evenodd"
              />
            </svg>
            Refresh
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-700 bg-gray-800/50 overflow-x-auto">
        {/* Category Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Category:</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ReportCategory | 'ALL')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All ({categoryCounts.ALL})</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label} ({categoryCounts[value] || 0})
              </option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Sort by:</span>
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="date">Date</option>
            <option value="category">Category</option>
            <option value="strikes">User Strikes</option>
          </select>
          <button
            onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg"
            title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 transition-transform ${sortOrder === 'asc' ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-gray-400">
              <svg
                className="animate-spin h-5 w-5"
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
              Loading reports...
            </div>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-12 w-12 text-gray-600 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-400">No pending reports</h3>
            <p className="text-gray-500 mt-1">
              {categoryFilter !== 'ALL'
                ? `No reports in the ${CATEGORY_LABELS[categoryFilter]} category`
                : 'All reports have been reviewed'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredReports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                onDismiss={() => handleAction(report.id, () => onDismiss(report.id))}
                onWarn={() => handleAction(report.id, () => onWarn(report.id))}
                onStrike={() =>
                  handleAction(report.id, () =>
                    onStrike(
                      report.id,
                      report.reportedUserId,
                      `Violation: ${CATEGORY_LABELS[report.category]}`
                    )
                  )
                }
                isProcessing={processingIds.has(report.id)}
                decryptedMessage={
                  report.message?.id ? decryptedMessages[report.message.id] : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-gray-700 bg-gray-800/50 text-sm text-gray-500">
        <span>
          Showing {filteredReports.length} of {reports.length} reports
        </span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            Warning
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            2 Strikes
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Blacklisted
          </span>
        </div>
      </div>
    </div>
  );
}

export default AdminPanel;
