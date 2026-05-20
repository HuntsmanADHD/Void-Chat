'use client';

import { useState, useCallback } from 'react';
import type { ScanStatus } from '@/types/api';

// =============================================================================
// TYPES
// =============================================================================

interface UploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
  scanStatus: ScanStatus | null;
  attachmentId: string | null;
}

interface UseFileUploadOptions {
  /** Channel ID for channel messages */
  channelId?: string;
  /** Channel encryption key (base64) */
  channelKey?: string;
  /** Recipient ID for DMs */
  recipientId?: string;
  /** Recipient public key for DMs (base64) */
  recipientPublicKey?: string;
  /** Sender's secret key (base64) - for DM encryption */
  senderSecretKey?: string;
  /** Auth token for API requests */
  authToken?: string;
  /** Callback when upload completes successfully */
  onUploadComplete?: (attachmentId: string) => void;
  /** Callback when scan completes */
  onScanComplete?: (status: ScanStatus, attachmentId: string) => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

interface UseFileUploadReturn extends UploadState {
  /** Upload a file */
  uploadFile: (file: File) => Promise<string | null>;
  /** Clear error state */
  clearError: () => void;
  /** Reset upload state */
  reset: () => void;
  /** Selected file (for preview) */
  selectedFile: File | null;
  /** Set selected file */
  setSelectedFile: (file: File | null) => void;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for handling file uploads (stubbed — file sharing will be P2P later)
 */
export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  const { onError } = options;

  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
    scanStatus: null,
    attachmentId: null,
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  /**
   * Upload a file — stubbed, always returns null
   */
  const uploadFile = useCallback(
    async (_file: File): Promise<string | null> => {
      const errorMsg = 'File sharing is not yet available';
      setState((prev) => ({ ...prev, error: errorMsg }));
      onError?.(errorMsg);
      return null;
    },
    [onError]
  );

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  /**
   * Reset upload state
   */
  const reset = useCallback(() => {
    setState({
      isUploading: false,
      progress: 0,
      error: null,
      scanStatus: null,
      attachmentId: null,
    });
    setSelectedFile(null);
  }, []);

  return {
    ...state,
    uploadFile,
    clearError,
    reset,
    selectedFile,
    setSelectedFile,
  };
}

export default useFileUpload;
