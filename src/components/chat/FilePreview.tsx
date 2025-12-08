'use client';

import React, { useMemo, useEffect, useState } from 'react';
import { formatFileSize, isImageType } from '@/lib/fileEncryption';
import type { ScanStatus } from '@/types/api';

interface FilePreviewProps {
  file: File | null;
  onRemove: () => void;
  uploadProgress?: number;
  scanStatus?: ScanStatus | null;
  error?: string | null;
}

/**
 * File preview component
 * Shows selected file with upload progress and scan status
 */
export function FilePreview({
  file,
  onRemove,
  uploadProgress,
  scanStatus,
  error,
}: FilePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Generate preview URL for images
  useEffect(() => {
    if (file && isImageType(file.type)) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
    return undefined;
  }, [file]);

  // Get icon for file type
  const FileIcon = useMemo(() => {
    if (!file) return null;

    if (isImageType(file.type)) {
      return (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
            clipRule="evenodd"
          />
        </svg>
      );
    }

    if (file.type === 'application/pdf') {
      return (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
            clipRule="evenodd"
          />
        </svg>
      );
    }

    return (
      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
          clipRule="evenodd"
        />
      </svg>
    );
  }, [file]);

  // Get scan status badge
  const ScanStatusBadge = useMemo(() => {
    if (!scanStatus) return null;

    switch (scanStatus) {
      case 'PENDING':
      case 'SCANNING':
        return (
          <span className="px-2 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded flex items-center gap-1">
            <svg
              className="w-3 h-3 animate-spin"
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
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Scanning...
          </span>
        );

      case 'CLEAN':
        return (
          <span className="px-2 py-0.5 bg-emerald-900/50 text-emerald-400 text-xs rounded flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Scan complete
          </span>
        );

      case 'QUARANTINED':
        return (
          <span className="px-2 py-0.5 bg-red-900/50 text-red-400 text-xs rounded flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            Threat detected
          </span>
        );

      case 'ERROR':
        return (
          <span className="px-2 py-0.5 bg-orange-900/50 text-orange-400 text-xs rounded">
            Scan failed
          </span>
        );

      default:
        return null;
    }
  }, [scanStatus]);

  if (!file) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg border border-zinc-700 mb-2">
      {/* Thumbnail or icon */}
      <div className="w-12 h-12 flex-shrink-0 rounded bg-zinc-700 overflow-hidden flex items-center justify-center">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Preview"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-zinc-400">{FileIcon}</div>
        )}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate" title={file.name}>
          {file.name}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-zinc-400">{formatFileSize(file.size)}</span>
          {ScanStatusBadge}
        </div>

        {/* Upload progress */}
        {uploadProgress !== undefined && uploadProgress < 100 && (
          <div className="mt-2 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="mt-1 text-xs text-red-400">{error}</p>
        )}
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
        title="Remove file"
        aria-label="Remove file"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

export default FilePreview;
