'use client';

import React, { useState, useCallback } from 'react';
import { formatFileSize, isImageType } from '@/lib/fileEncryption';
import type { AttachmentResponse } from '@/types/api';

interface AttachmentDisplayProps {
  attachment: AttachmentResponse;
  onDownload?: (attachment: AttachmentResponse) => void;
  decryptedUrl?: string | null;
  isDecrypting?: boolean;
}

/**
 * Attachment display component for messages
 * Shows image preview or file download button
 */
export function AttachmentDisplay({
  attachment,
  onDownload,
  decryptedUrl,
  isDecrypting = false,
}: AttachmentDisplayProps) {
  const [showLightbox, setShowLightbox] = useState(false);
  const [imageError, setImageError] = useState(false);

  const isImage = isImageType(attachment.fileType);
  const isQuarantined = attachment.scanStatus === 'QUARANTINED';
  const isScanning = attachment.scanStatus === 'PENDING' || attachment.scanStatus === 'SCANNING';

  const handleDownload = useCallback(() => {
    if (isQuarantined || isScanning) return;
    onDownload?.(attachment);
  }, [attachment, onDownload, isQuarantined, isScanning]);

  const handleImageClick = useCallback(() => {
    if (decryptedUrl && !imageError) {
      setShowLightbox(true);
    }
  }, [decryptedUrl, imageError]);

  const handleCloseLightbox = useCallback(() => {
    setShowLightbox(false);
  }, []);

  // Quarantined file display
  if (isQuarantined) {
    return (
      <div className="flex items-center gap-3 p-3 bg-red-900/20 border border-red-900/50 rounded-lg mt-2">
        <div className="w-10 h-10 flex items-center justify-center bg-red-900/30 rounded">
          <svg
            className="w-5 h-5 text-red-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-red-400 font-medium">File blocked</p>
          <p className="text-xs text-red-400/70 truncate">
            This file was quarantined due to detected threats
          </p>
        </div>
      </div>
    );
  }

  // Scanning state display
  if (isScanning) {
    return (
      <div className="flex items-center gap-3 p-3 bg-yellow-900/20 border border-yellow-900/50 rounded-lg mt-2">
        <div className="w-10 h-10 flex items-center justify-center bg-yellow-900/30 rounded">
          <svg
            className="w-5 h-5 text-yellow-400 animate-spin"
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
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-yellow-400 font-medium">Scanning file...</p>
          <p className="text-xs text-yellow-400/70 truncate">{attachment.fileName}</p>
        </div>
      </div>
    );
  }

  // Image attachment
  if (isImage) {
    return (
      <>
        <div className="mt-2 max-w-sm">
          {isDecrypting ? (
            <div className="w-full h-48 bg-zinc-800 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-zinc-500 animate-spin"
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
            </div>
          ) : decryptedUrl && !imageError ? (
            <button
              type="button"
              onClick={handleImageClick}
              className="block w-full rounded-lg overflow-hidden hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={decryptedUrl}
                alt={attachment.fileName}
                className="w-full h-auto max-h-64 object-contain bg-zinc-800"
                onError={() => setImageError(true)}
              />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-3 p-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors w-full text-left"
            >
              <div className="w-10 h-10 flex items-center justify-center bg-zinc-700 rounded">
                <svg
                  className="w-5 h-5 text-zinc-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{attachment.fileName}</p>
                <p className="text-xs text-zinc-400">{formatFileSize(attachment.fileSize)}</p>
              </div>
              <svg
                className="w-5 h-5 text-zinc-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Lightbox */}
        {showLightbox && decryptedUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            onClick={handleCloseLightbox}
          >
            <button
              type="button"
              onClick={handleCloseLightbox}
              className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={decryptedUrl}
              alt={attachment.fileName}
              className="max-w-[90vw] max-h-[90vh] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </>
    );
  }

  // Document attachment
  return (
    <button
      type="button"
      onClick={handleDownload}
      className="flex items-center gap-3 p-3 mt-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors max-w-sm w-full text-left"
    >
      <div className="w-10 h-10 flex items-center justify-center bg-zinc-700 rounded">
        {attachment.fileType === 'application/pdf' ? (
          <svg
            className="w-5 h-5 text-red-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            className="w-5 h-5 text-zinc-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{attachment.fileName}</p>
        <p className="text-xs text-zinc-400">{formatFileSize(attachment.fileSize)}</p>
      </div>
      <svg
        className="w-5 h-5 text-zinc-400 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
    </button>
  );
}

export default AttachmentDisplay;
