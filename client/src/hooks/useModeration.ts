/**
 * Void Chat - useModeration Hook
 *
 * React hook for community-driven moderation:
 * - reportUser: Submit a report against a user in a community
 * - checkCanSendMessage: Check if current user can send messages (not banned)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';

// =============================================================================
// TYPES
// =============================================================================

export type ReportCategory = 'SPAM' | 'HARASSMENT' | 'SCAM' | 'ILLEGAL' | 'OTHER';

export interface ModerationStatus {
  userId: string;
  isBlacklisted: boolean;
  canSendMessages: boolean;
  canFileReports: boolean;
}

export interface ReportResult {
  success: boolean;
  reported?: boolean;
  userKicked?: boolean;
  userBanned?: boolean;
  reportCount?: number;
  threshold?: number;
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
}

export interface UseModerationReturn {
  /** Current user's moderation status */
  status: ModerationStatus | null;
  /** Whether status is loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: ModerationError | null;
  /** Submit a report against a user in a community */
  reportUser: (
    reportedUserId: string,
    communityId: string,
    category: ReportCategory,
    description: string,
    messageId?: string
  ) => Promise<ReportResult>;
  /** Check if current user can send messages */
  checkCanSendMessage: () => Promise<boolean>;
  /** Refresh current user's status */
  refreshStatus: () => Promise<void>;
  /** Whether a report is being submitted */
  isReporting: boolean;
}

// =============================================================================
// HOOK
// =============================================================================

export function useModeration(options: UseModerationOptions = {}): UseModerationReturn {
  const { userId, autoFetch = true } = options;

  const [status, setStatus] = useState<ModerationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [error, setError] = useState<ModerationError | null>(null);

  const mountedRef = useRef(true);

  /**
   * Refresh current user's moderation status
   */
  const refreshStatus = useCallback(async () => {
    if (!userId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<{ isBlacklisted?: boolean }>(
        `/api/auth/blacklist?wallet=${userId}`
      );

      if (mountedRef.current) {
        const isBlacklisted = (response.success && response.data?.isBlacklisted) ?? false;
        setStatus({
          userId,
          isBlacklisted,
          canSendMessages: !isBlacklisted,
          canFileReports: !isBlacklisted,
        });
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
  }, [userId]);

  /**
   * Submit a report against a user in a community
   */
  const reportUser = useCallback(
    async (
      reportedUserId: string,
      communityId: string,
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
        const response = await apiClient.post<{
          reported?: boolean;
          userKicked?: boolean;
          userBanned?: boolean;
          reportCount?: number;
          threshold?: number;
          error?: string;
        }>('/api/reports', {
          reportedUserId,
          communityId,
          category,
          description,
          messageId,
        });

        if (!response.success) {
          throw new Error(response.error?.message || 'Failed to submit report');
        }

        const data = response.data;
        return {
          success: true,
          reported: data?.reported,
          userKicked: data?.userKicked,
          userBanned: data?.userBanned,
          reportCount: data?.reportCount,
          threshold: data?.threshold,
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

    // If we have cached status, use it
    if (status) {
      return status.canSendMessages;
    }

    // Default to allowing (not banned until proven otherwise)
    return true;
  }, [userId, status]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && userId) {
      refreshStatus();
    }
  }, [autoFetch, userId, refreshStatus]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    status,
    isLoading,
    error,
    reportUser,
    checkCanSendMessage,
    refreshStatus,
    isReporting,
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

  return { canAct: true, isLoading: false, reason: null };
}

export default useModeration;
