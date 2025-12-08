'use client';

/**
 * Void Chat - useModeration Hook
 *
 * React hook for moderation-related functionality:
 * - reportUser: Submit a report against a user
 * - checkCanSendMessage: Check if current user can send messages
 * - getUserModerationStatus: Get moderation status for a user
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export type ReportCategory = 'SPAM' | 'HARASSMENT' | 'SCAM' | 'ILLEGAL' | 'OTHER';

export interface ModerationStatus {
  userId: string;
  walletAddress: string;
  strikeCount: number;
  isBlacklisted: boolean;
  isTimedOut: boolean;
  timeoutUntil: Date | null;
  remainingTimeout: number;
  canSendMessages: boolean;
  canFileReports: boolean;
  strikes: StrikeInfo[];
}

export interface StrikeInfo {
  id: string;
  strikeNumber: number;
  reason: string;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
}

export interface ReportResult {
  success: boolean;
  reportId?: string;
  error?: string;
}

export interface ModerationError {
  code: string;
  message: string;
}

export interface UseModerationOptions {
  /** Current user's ID */
  userId?: string;
  /** Whether to auto-fetch status on mount */
  autoFetch?: boolean;
  /** Polling interval for status updates (ms) */
  pollInterval?: number;
}

export interface UseModerationReturn {
  /** Current user's moderation status */
  status: ModerationStatus | null;
  /** Whether status is loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: ModerationError | null;
  /** Submit a report against a user */
  reportUser: (
    userId: string,
    category: ReportCategory,
    description: string,
    messageId?: string
  ) => Promise<ReportResult>;
  /** Check if current user can send messages */
  checkCanSendMessage: () => Promise<boolean>;
  /** Get moderation status for a specific user */
  getUserModerationStatus: (userId: string) => Promise<ModerationStatus | null>;
  /** Refresh current user's status */
  refreshStatus: () => Promise<void>;
  /** Whether a report is being submitted */
  isReporting: boolean;
  /** Formatted remaining timeout string */
  formattedTimeout: string | null;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
  if (ms <= 0) return '';
  if (ms === Infinity) return 'Permanent';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h`;
    }
    return `${days} day${days > 1 ? 's' : ''}`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }

  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

/**
 * Parse date string to Date object
 */
function parseDate(date: string | Date | null): Date | null {
  if (!date) return null;
  return typeof date === 'string' ? new Date(date) : date;
}

/**
 * Calculate remaining timeout in milliseconds
 */
function calculateRemainingTimeout(timeoutUntil: Date | null, isBlacklisted: boolean): number {
  if (isBlacklisted) return Infinity;
  if (!timeoutUntil) return 0;

  const now = new Date();
  const remaining = timeoutUntil.getTime() - now.getTime();
  return Math.max(0, remaining);
}

// =============================================================================
// HOOK
// =============================================================================

export function useModeration(options: UseModerationOptions = {}): UseModerationReturn {
  const { userId, autoFetch = true, pollInterval } = options;

  const [status, setStatus] = useState<ModerationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [error, setError] = useState<ModerationError | null>(null);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  /**
   * Fetch moderation status for a user from the API
   */
  const getUserModerationStatus = useCallback(
    async (targetUserId: string): Promise<ModerationStatus | null> => {
      try {
        const response = await fetch(`/api/moderation/status/${targetUserId}`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to fetch moderation status');
        }

        const data = await response.json();

        // Parse dates and calculate derived values
        const timeoutUntil = parseDate(data.timeoutUntil);
        const isBlacklisted = data.isBlacklisted ?? false;
        const isTimedOut = timeoutUntil ? timeoutUntil > new Date() : false;
        const remainingTimeout = calculateRemainingTimeout(timeoutUntil, isBlacklisted);

        const moderationStatus: ModerationStatus = {
          userId: data.userId,
          walletAddress: data.walletAddress,
          strikeCount: data.strikeCount ?? 0,
          isBlacklisted,
          isTimedOut,
          timeoutUntil,
          remainingTimeout,
          canSendMessages: !isBlacklisted && !isTimedOut,
          canFileReports: !isBlacklisted,
          strikes: (data.strikes ?? []).map((s: Record<string, unknown>) => ({
            id: s.id as string,
            strikeNumber: s.strikeNumber as number,
            reason: s.reason as string,
            createdAt: parseDate(s.createdAt as string | Date) ?? new Date(),
            expiresAt: parseDate(s.expiresAt as string | Date | null),
            isActive: s.isActive as boolean ?? true,
          })),
        };

        return moderationStatus;
      } catch (err) {
        console.error('Failed to get moderation status:', err);
        return null;
      }
    },
    []
  );

  /**
   * Refresh current user's moderation status
   */
  const refreshStatus = useCallback(async () => {
    if (!userId) return;

    setIsLoading(true);
    setError(null);

    try {
      const newStatus = await getUserModerationStatus(userId);

      if (mountedRef.current) {
        setStatus(newStatus);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError({
          code: 'FETCH_ERROR',
          message: err instanceof Error ? err.message : 'Failed to fetch status',
        });
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [userId, getUserModerationStatus]);

  /**
   * Submit a report against a user
   */
  const reportUser = useCallback(
    async (
      targetUserId: string,
      category: ReportCategory,
      description: string,
      messageId?: string
    ): Promise<ReportResult> => {
      // Check if current user can file reports
      if (status && !status.canFileReports) {
        return {
          success: false,
          error: 'You are not allowed to file reports',
        };
      }

      setIsReporting(true);
      setError(null);

      try {
        const response = await fetch('/api/reports', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: targetUserId,
            category,
            description,
            messageId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Failed to submit report');
        }

        return {
          success: true,
          reportId: data.reportId,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to submit report';

        if (mountedRef.current) {
          setError({
            code: 'REPORT_ERROR',
            message: errorMessage,
          });
        }

        return {
          success: false,
          error: errorMessage,
        };
      } finally {
        if (mountedRef.current) {
          setIsReporting(false);
        }
      }
    },
    [status]
  );

  /**
   * Check if current user can send messages
   */
  const checkCanSendMessage = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;

    try {
      // If we have cached status, use it
      if (status) {
        return status.canSendMessages;
      }

      // Otherwise fetch fresh status
      const freshStatus = await getUserModerationStatus(userId);
      return freshStatus?.canSendMessages ?? false;
    } catch {
      // On error, default to not allowing (fail-safe)
      return false;
    }
  }, [userId, status, getUserModerationStatus]);

  /**
   * Calculate formatted timeout string
   */
  const formattedTimeout = status?.remainingTimeout
    ? formatDuration(status.remainingTimeout)
    : null;

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && userId) {
      refreshStatus();
    }
  }, [autoFetch, userId, refreshStatus]);

  // Set up polling if interval provided
  useEffect(() => {
    if (pollInterval && userId) {
      pollRef.current = setInterval(() => {
        refreshStatus();
      }, pollInterval);

      return () => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
        }
      };
    }
    return undefined;
  }, [pollInterval, userId, refreshStatus]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  // Update remaining timeout periodically if user is timed out
  useEffect(() => {
    if (!status?.isTimedOut || status.isBlacklisted) return;

    const interval = setInterval(() => {
      if (!status.timeoutUntil) return;

      const remaining = calculateRemainingTimeout(status.timeoutUntil, false);

      if (remaining <= 0) {
        // Timeout has expired, refresh status
        refreshStatus();
      } else {
        // Update remaining time
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                remainingTimeout: remaining,
                isTimedOut: remaining > 0,
                canSendMessages: remaining <= 0,
              }
            : null
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [status?.isTimedOut, status?.timeoutUntil, status?.isBlacklisted, refreshStatus]);

  return {
    status,
    isLoading,
    error,
    reportUser,
    checkCanSendMessage,
    getUserModerationStatus,
    refreshStatus,
    isReporting,
    formattedTimeout,
  };
}

// =============================================================================
// ADDITIONAL HOOKS
// =============================================================================

/**
 * Hook for checking if a user can perform an action
 * Returns a simple boolean and loading state
 */
export function useCanAct(userId?: string): {
  canAct: boolean;
  isLoading: boolean;
  reason: string | null;
} {
  const { status, isLoading } = useModeration({ userId, autoFetch: true });

  if (isLoading || !status) {
    return { canAct: true, isLoading, reason: null };
  }

  if (status.isBlacklisted) {
    return {
      canAct: false,
      isLoading: false,
      reason: 'Your account has been permanently banned',
    };
  }

  if (status.isTimedOut) {
    return {
      canAct: false,
      isLoading: false,
      reason: `You are timed out for ${formatDuration(status.remainingTimeout)}`,
    };
  }

  return { canAct: true, isLoading: false, reason: null };
}

/**
 * Hook for tracking strike count with visual feedback
 */
export function useStrikeDisplay(userId?: string): {
  strikeCount: number;
  isBlacklisted: boolean;
  strikes: StrikeInfo[];
  severity: 'none' | 'warning' | 'danger' | 'critical';
  color: string;
} {
  const { status } = useModeration({ userId, autoFetch: true });

  if (!status) {
    return {
      strikeCount: 0,
      isBlacklisted: false,
      strikes: [],
      severity: 'none',
      color: 'text-gray-500',
    };
  }

  let severity: 'none' | 'warning' | 'danger' | 'critical' = 'none';
  let color = 'text-gray-500';

  if (status.isBlacklisted || status.strikeCount >= 3) {
    severity = 'critical';
    color = 'text-red-500';
  } else if (status.strikeCount === 2) {
    severity = 'danger';
    color = 'text-orange-500';
  } else if (status.strikeCount === 1) {
    severity = 'warning';
    color = 'text-yellow-500';
  }

  return {
    strikeCount: status.strikeCount,
    isBlacklisted: status.isBlacklisted,
    strikes: status.strikes,
    severity,
    color,
  };
}

export default useModeration;
