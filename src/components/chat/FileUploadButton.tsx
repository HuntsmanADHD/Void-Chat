'use client';

import React, { useRef, useState, useCallback } from 'react';
import { validateFile, ALLOWED_TYPES, MAX_FILE_SIZE } from '@/lib/fileEncryption';

interface FileUploadButtonProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  isUploading?: boolean;
}

/**
 * File upload button component
 * Triggers file selection with validation
 */
export function FileUploadButton({
  onFileSelect,
  disabled = false,
  isUploading = false,
}: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

  const handleClick = useCallback(() => {
    if (disabled || isUploading) return;
    inputRef.current?.click();
  }, [disabled, isUploading]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);
      setShowError(false);

      // Validate file
      const validation = validateFile(file);
      if (!validation.valid) {
        setError(validation.error || 'Invalid file');
        setShowError(true);
        // Auto-hide error after 5 seconds
        setTimeout(() => setShowError(false), 5000);
        // Reset input
        e.target.value = '';
        return;
      }

      onFileSelect(file);

      // Reset input for re-selection of same file
      e.target.value = '';
    },
    [onFileSelect]
  );

  const handleDismissError = useCallback(() => {
    setShowError(false);
  }, []);

  const isDisabled = disabled || isUploading;

  return (
    <div className="relative">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        onChange={handleFileChange}
        className="hidden"
        disabled={isDisabled}
        aria-label="Upload file"
      />

      {/* Upload button */}
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
          isDisabled
            ? 'text-zinc-600 cursor-not-allowed'
            : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
        }`}
        title={`Attach file (max ${MAX_FILE_SIZE / (1024 * 1024)}MB)`}
        aria-label="Attach file"
      >
        {isUploading ? (
          /* Spinner when uploading */
          <svg
            className="w-5 h-5 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
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
        ) : (
          /* Paperclip icon */
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        )}
      </button>

      {/* Error tooltip */}
      {showError && error && (
        <div
          className="absolute bottom-full left-0 mb-2 px-3 py-2 bg-red-900/90 text-red-200 text-xs rounded-lg shadow-lg whitespace-nowrap z-50 flex items-center gap-2"
          role="alert"
        >
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
          <button
            type="button"
            onClick={handleDismissError}
            className="ml-1 text-red-300 hover:text-white"
            aria-label="Dismiss"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default FileUploadButton;
