'use client';

import React, { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import { FileUploadButton } from './FileUploadButton';
import { FilePreview } from './FilePreview';
import { EmojiPicker } from './EmojiPicker';
import { useHarmonicTyping } from '@/hooks/useHarmonicTyping';
import type { ScanStatus } from '@/types/api';

/**
 * Maximum character limit for messages
 */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Warning threshold for character count
 */
const WARNING_THRESHOLD = 1800;

export interface MessageInputProps {
  /** Callback when message is submitted */
  onSend: (message: string, attachmentId?: string) => Promise<void> | void;
  /** Whether the input is disabled (e.g., user is timed out) */
  disabled?: boolean;
  /** Reason for being disabled */
  disabledReason?: string;
  /** Whether encryption is ready */
  isEncryptionReady?: boolean;
  /** Whether message is currently being sent */
  isSending?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Reply context (when replying to a message) */
  replyTo?: {
    id: string;
    senderName: string;
    preview: string;
  } | null;
  /** Callback to cancel reply */
  onCancelReply?: () => void;
  /** Additional class names */
  className?: string;
  /** File upload callbacks */
  onFileSelect?: (file: File) => void;
  /** Selected file for preview */
  selectedFile?: File | null;
  /** Remove selected file */
  onRemoveFile?: () => void;
  /** File upload progress (0-100) */
  uploadProgress?: number;
  /** Scan status of uploaded file */
  scanStatus?: ScanStatus | null;
  /** Upload error */
  uploadError?: string | null;
  /** Whether file is currently uploading */
  isUploading?: boolean;
  /** Attachment ID after successful upload */
  attachmentId?: string | null;
  /** Whether harmonic typing sounds are enabled */
  harmonicSoundsEnabled?: boolean;
}

/**
 * Encryption lock icon component
 */
function EncryptionIndicator({ isReady }: { isReady: boolean }) {
  return (
    <div
      className={`flex items-center gap-1 text-xs ${
        isReady ? 'text-zinc-500' : 'text-zinc-600'
      }`}
      title={isReady ? 'End-to-end encrypted' : 'Encryption initializing...'}
    >
      {isReady ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
        </svg>
      )}
    </div>
  );
}

/**
 * Character count display
 */
function CharacterCount({ current, max }: { current: number; max: number }) {
  const remaining = max - current;
  const isWarning = current >= WARNING_THRESHOLD;
  const isOverLimit = current > max;

  if (current < WARNING_THRESHOLD) {
    return null;
  }

  return (
    <span
      className={`text-xs font-mono ${
        isOverLimit
          ? 'text-zinc-400'
          : isWarning
          ? 'text-zinc-500'
          : 'text-zinc-600'
      }`}
    >
      {remaining}
    </span>
  );
}

/**
 * Reply preview component
 */
function ReplyPreview({
  senderName,
  preview,
  onCancel,
}: {
  senderName: string;
  preview: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-l-2 border-zinc-600">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-zinc-500 font-medium">
          Replying to {senderName}
        </span>
        <p className="text-sm text-zinc-500 truncate">{preview}</p>
      </div>
      <button
        onClick={onCancel}
        className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors"
        title="Cancel reply"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

/**
 * Disabled overlay component
 */
function DisabledOverlay({ reason }: { reason?: string }) {
  return (
    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-10 rounded-lg">
      <div className="text-center px-4">
        <svg
          className="w-8 h-8 mx-auto mb-2 text-zinc-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
        <p className="text-sm text-zinc-500 font-medium">
          {reason || 'You cannot send messages'}
        </p>
      </div>
    </div>
  );
}

/**
 * Message input component for Void Chat
 *
 * Features:
 * - Auto-resizing textarea
 * - Send button with loading state
 * - Encryption indicator (lock icon)
 * - Character limit display
 * - Disabled state for timed out/blacklisted users
 * - Reply context display
 * - Keyboard shortcuts (Enter to send, Shift+Enter for newline)
 */
export function MessageInput({
  onSend,
  disabled = false,
  disabledReason,
  isEncryptionReady = true,
  isSending = false,
  placeholder = 'Send an encrypted message...',
  replyTo = null,
  onCancelReply,
  className = '',
  onFileSelect,
  selectedFile,
  onRemoveFile,
  uploadProgress,
  scanStatus,
  uploadError,
  isUploading = false,
  attachmentId,
  harmonicSoundsEnabled = true,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  // Internal file state for when external handlers are not provided
  const [internalSelectedFile, setInternalSelectedFile] = useState<File | null>(null);

  // Use external or internal file state
  const currentFile = selectedFile !== undefined ? selectedFile : internalSelectedFile;

  // Handle file selection (use external handler or internal state)
  const handleFileSelect = useCallback((file: File) => {
    if (onFileSelect) {
      onFileSelect(file);
    } else {
      setInternalSelectedFile(file);
    }
  }, [onFileSelect]);

  // Handle file removal
  const handleRemoveFile = useCallback(() => {
    if (onRemoveFile) {
      onRemoveFile();
    } else {
      setInternalSelectedFile(null);
    }
  }, [onRemoveFile]);

  // Handle emoji selection
  const handleEmojiSelect = useCallback((emoji: string) => {
    setMessage((prev) => prev + emoji);
    setShowEmojiPicker(false);
    // Focus back on textarea
    textareaRef.current?.focus();
  }, []);

  // 432Hz harmonic typing sounds
  const { playNote, isEnabled: soundEnabled, toggleSound } = useHarmonicTyping({
    enabled: harmonicSoundsEnabled,
    volume: 0.12,
    noteDuration: 120,
  });

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set height to scrollHeight, but cap at max height
    const maxHeight = 200; // px
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // Adjust height when message changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [message, adjustTextareaHeight]);

  // Handle message submission
  const handleSubmit = useCallback(async () => {
    const trimmedMessage = message.trim();

    // Allow sending with just an attachment (no text required)
    // Check both external attachmentId and internal file state
    const hasExternalAttachment = attachmentId && scanStatus === 'CLEAN';
    const hasInternalFile = !onFileSelect && internalSelectedFile;
    const hasAttachment = hasExternalAttachment || hasInternalFile;

    if (!trimmedMessage && !hasAttachment) {
      return;
    }

    if (disabled || isSending || !isEncryptionReady || isUploading) {
      return;
    }

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return;
    }

    try {
      await onSend(trimmedMessage || '[Attachment]', hasExternalAttachment ? attachmentId : undefined);
      setMessage('');
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      // Clear file if attached
      if (hasExternalAttachment && onRemoveFile) {
        onRemoveFile();
      }
      // Clear internal file state
      if (hasInternalFile) {
        setInternalSelectedFile(null);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }, [message, disabled, isSending, isEncryptionReady, isUploading, attachmentId, scanStatus, onSend, onRemoveFile, onFileSelect, internalSelectedFile]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Play harmonic tone for printable characters
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        playNote(event.key);
      }

      // Enter to send, Shift+Enter for newline
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, playNote]
  );

  // Handle input change
  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(event.target.value);
  }, []);

  const isOverLimit = message.length > MAX_MESSAGE_LENGTH;
  const hasReadyAttachment = attachmentId && scanStatus === 'CLEAN';
  const hasInternalFile = !onFileSelect && internalSelectedFile;
  const canSend =
    (message.trim().length > 0 || hasReadyAttachment || hasInternalFile) &&
    !isOverLimit &&
    !disabled &&
    !isSending &&
    !isUploading &&
    isEncryptionReady;

  return (
    <div className={`relative ${className}`}>
      {/* Reply preview */}
      {replyTo && onCancelReply && (
        <ReplyPreview
          senderName={replyTo.senderName}
          preview={replyTo.preview}
          onCancel={onCancelReply}
        />
      )}

      {/* Input container */}
      <div className="relative px-4 py-3 bg-gradient-to-t from-black to-zinc-900/50">
        {/* Disabled overlay */}
        {disabled && <DisabledOverlay reason={disabledReason} />}

        {/* File preview */}
        {currentFile && (
          <FilePreview
            file={currentFile}
            onRemove={handleRemoveFile}
            uploadProgress={uploadProgress}
            scanStatus={scanStatus ?? (onFileSelect ? undefined : 'CLEAN')}
            error={uploadError}
          />
        )}

        <div className="flex items-end gap-3 bg-zinc-900/80 rounded-lg px-4 py-2 border border-zinc-800/50">
          {/* File upload button - always visible */}
          <FileUploadButton
            onFileSelect={handleFileSelect}
            disabled={disabled || !!currentFile}
            isUploading={isUploading}
          />

          {/* Sound toggle button */}
          <button
            type="button"
            onClick={toggleSound}
            className={`p-1 transition-colors flex-shrink-0 ${
              soundEnabled ? 'text-zinc-500 hover:text-zinc-400' : 'text-zinc-700 hover:text-zinc-600'
            }`}
            title={soundEnabled ? '432Hz typing sounds on (click to mute)' : '432Hz typing sounds off (click to enable)'}
          >
            {soundEnabled ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                />
              </svg>
            )}
          </button>

          {/* Emoji button */}
          <div className="relative">
            <button
              ref={emojiButtonRef}
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className={`p-1 transition-colors flex-shrink-0 ${
                showEmojiPicker ? 'text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'
              }`}
              title="Add emoji"
              disabled={disabled}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                onSelect={handleEmojiSelect}
                onClose={() => setShowEmojiPicker(false)}
                position="top"
              />
            )}
          </div>

          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isSending}
            rows={1}
            className="flex-1 bg-transparent text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none min-h-[24px] max-h-[200px] scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
            style={{ height: 'auto' }}
          />

          {/* Right side controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Character count */}
            <CharacterCount current={message.length} max={MAX_MESSAGE_LENGTH} />

            {/* Encryption indicator */}
            <EncryptionIndicator isReady={isEncryptionReady} />

            {/* Send button - grey gradient for void aesthetic */}
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className={`p-2 rounded-lg transition-all duration-150 ${
                canSend
                  ? 'bg-gradient-to-r from-zinc-600 to-zinc-500 hover:from-zinc-500 hover:to-zinc-400 text-zinc-100 shadow-lg shadow-black/30'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              }`}
              title={
                !isEncryptionReady
                  ? 'Waiting for encryption...'
                  : isOverLimit
                  ? 'Message too long'
                  : 'Send message'
              }
            >
              {isSending ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Help text */}
        <div className="flex items-center justify-between mt-1 px-1">
          <span className="text-xs text-zinc-700">
            Press Enter to send, Shift+Enter for new line
          </span>
          {isOverLimit && (
            <span className="text-xs text-zinc-500">
              Message exceeds {MAX_MESSAGE_LENGTH} character limit
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default MessageInput;
