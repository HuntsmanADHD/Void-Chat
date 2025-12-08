'use client';

import { useState, useCallback, useRef } from 'react';
import {
  validateFile,
  encryptFileData,
  getFileKeyForChannel,
  deriveFileKeyForDM,
} from '@/lib/fileEncryption';
import type { ScanStatus, UploadAttachmentResponse, ScanStatusResponse } from '@/types/api';

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
  /** Recipient wallet for DMs */
  recipientWallet?: string;
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
// CONSTANTS
// =============================================================================

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30;

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for handling file uploads with encryption and scanning
 */
export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  const {
    channelId,
    channelKey,
    recipientWallet,
    recipientPublicKey,
    senderSecretKey,
    authToken,
    onUploadComplete,
    onScanComplete,
    onError,
  } = options;


  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
    scanStatus: null,
    attachmentId: null,
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Poll for scan status until complete
   */
  const pollScanStatus = useCallback(
    async (attachmentId: string): Promise<ScanStatus> => {
      for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        try {
          const response = await fetch(`/api/attachments/${attachmentId}/scan-status`, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          });

          if (response.ok) {
            const data: ScanStatusResponse = await response.json();

            if (data.scanStatus !== 'PENDING' && data.scanStatus !== 'SCANNING') {
              return data.scanStatus;
            }
          }
        } catch (error) {
          console.error('[useFileUpload] Poll error:', error);
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      return 'ERROR';
    },
    [authToken]
  );

  /**
   * Upload a file
   */
  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      // Cancel any existing upload
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      // Validate file
      const validation = validateFile(file);
      if (!validation.valid) {
        const errorMsg = validation.error || 'Invalid file';
        setState((prev) => ({ ...prev, error: errorMsg }));
        onError?.(errorMsg);
        return null;
      }

      setState({
        isUploading: true,
        progress: 0,
        error: null,
        scanStatus: null,
        attachmentId: null,
      });

      try {
        // Read file data
        const fileData = await file.arrayBuffer();
        setState((prev) => ({ ...prev, progress: 10 }));

        // Get encryption key
        let key: Uint8Array | null = null;

        if (channelId && channelKey) {
          // Channel message - use channel key
          key = getFileKeyForChannel(channelKey);
        } else if (recipientWallet && recipientPublicKey && senderSecretKey) {
          // DM - derive key from shared secret
          key = deriveFileKeyForDM(senderSecretKey, recipientPublicKey);
        }

        if (!key) {
          throw new Error('Encryption key not available');
        }

        setState((prev) => ({ ...prev, progress: 20 }));

        // Encrypt file
        const encrypted = encryptFileData(fileData, key);
        if (!encrypted) {
          throw new Error('Failed to encrypt file');
        }

        setState((prev) => ({ ...prev, progress: 50 }));

        // Prepare form data
        const formData = new FormData();
        // Convert Uint8Array to Blob - use slice to get a proper ArrayBuffer
        formData.append('file', new Blob([new Uint8Array(encrypted.encryptedData)]));
        formData.append('fileName', file.name);
        formData.append('fileType', file.type);
        formData.append('nonce', encrypted.nonce);

        if (channelId) {
          formData.append('channelId', channelId);
        } else if (recipientWallet) {
          formData.append('recipientWallet', recipientWallet);
        }

        setState((prev) => ({ ...prev, progress: 60 }));

        // Upload
        const response = await fetch('/api/attachments', {
          method: 'POST',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          body: formData,
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Upload failed');
        }

        const result: UploadAttachmentResponse = await response.json();
        setState((prev) => ({
          ...prev,
          progress: 80,
          scanStatus: 'SCANNING',
          attachmentId: result.attachmentId,
        }));

        onUploadComplete?.(result.attachmentId);

        // Poll for scan status
        const finalStatus = await pollScanStatus(result.attachmentId);

        setState((prev) => ({
          ...prev,
          progress: 100,
          scanStatus: finalStatus,
          isUploading: false,
        }));

        onScanComplete?.(finalStatus, result.attachmentId);

        if (finalStatus === 'QUARANTINED') {
          const errorMsg = 'File blocked: potential threat detected';
          setState((prev) => ({ ...prev, error: errorMsg }));
          onError?.(errorMsg);
          return null;
        }

        if (finalStatus === 'ERROR') {
          const errorMsg = 'File scan failed. Please try again.';
          setState((prev) => ({ ...prev, error: errorMsg }));
          onError?.(errorMsg);
          return null;
        }

        return result.attachmentId;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // Upload was cancelled
          return null;
        }

        const errorMsg = error instanceof Error ? error.message : 'Upload failed';
        setState((prev) => ({
          ...prev,
          isUploading: false,
          error: errorMsg,
        }));
        onError?.(errorMsg);
        return null;
      }
    },
    [
      channelId,
      channelKey,
      recipientWallet,
      recipientPublicKey,
      senderSecretKey,
      authToken,
      pollScanStatus,
      onUploadComplete,
      onScanComplete,
      onError,
    ]
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
    abortControllerRef.current?.abort();
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
