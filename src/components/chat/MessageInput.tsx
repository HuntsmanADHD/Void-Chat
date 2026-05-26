import React, { useCallback, useEffect, useRef, useState, KeyboardEvent } from 'react';
import { Droplets } from 'lucide-react';
import { EmojiPicker } from './EmojiPicker';
import { WashModal } from '@/components/wash/WashModal';
import { useHarmonicTyping } from '@/hooks/useHarmonicTyping';

const MAX_MESSAGE_LENGTH = 2000;
const WARNING_THRESHOLD = 1800;

export interface MessageInputProps {
  /** Send the typed message. Container handles encryption + delivery. */
  onSend: (message: string) => Promise<void> | void;
  /** Disable the whole input (timeout, blacklisted, etc). */
  disabled?: boolean;
  /** Why it's disabled, surfaced in the overlay. */
  disabledReason?: string;
  /** Realtime is connected and channel is joined — input is sendable. */
  isEncryptionReady?: boolean;
  /** A send is in flight. */
  isSending?: boolean;
  placeholder?: string;
  /** When set, shows a reply-context banner above the input. */
  replyTo?: { id: string; senderName: string; preview: string } | null;
  onCancelReply?: () => void;
  className?: string;
  /** Enable the 432Hz keystroke audio. Defaults on. */
  harmonicSoundsEnabled?: boolean;
}

function EncryptionIndicator({ isReady }: { isReady: boolean }) {
  return (
    <div
      className={`flex items-center gap-1 text-xs ${isReady ? 'text-zinc-500' : 'text-zinc-600'}`}
      title={isReady ? 'End-to-end encrypted' : 'Encryption initializing...'}
    >
      {isReady ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
        </svg>
      )}
    </div>
  );
}

function CharacterCount({ current, max }: { current: number; max: number }) {
  if (current < WARNING_THRESHOLD) return null;
  const isOverLimit = current > max;
  return (
    <span className={`text-xs font-mono ${isOverLimit ? 'text-zinc-400' : 'text-zinc-500'}`}>
      {max - current}
    </span>
  );
}

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
        <span className="text-xs text-zinc-500 font-medium">Replying to {senderName}</span>
        <p className="text-sm text-zinc-500 truncate">{preview}</p>
      </div>
      <button onClick={onCancel} className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors" title="Cancel reply">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function DisabledOverlay({ reason }: { reason?: string }) {
  return (
    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-10 rounded-lg">
      <p className="text-sm text-zinc-500 font-medium px-4 text-center">
        {reason || 'You cannot send messages'}
      </p>
    </div>
  );
}

/**
 * Message input bar with auto-resizing textarea, emoji picker, 432Hz typing
 * sounds, off-Void wash modal trigger, and Enter-to-send.
 *
 * Memoized: typed text lives in local state, so as long as callers pass
 * stable callbacks (via useCallback) every incoming message at the
 * container level skips re-rendering this whole tree — including the
 * harmonic typing hook's audio nodes.
 */
function MessageInputBase({
  onSend,
  disabled = false,
  disabledReason,
  isEncryptionReady = true,
  isSending = false,
  placeholder = 'Send an encrypted message...',
  replyTo = null,
  onCancelReply,
  className = '',
  harmonicSoundsEnabled = true,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showWashModal, setShowWashModal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const { playNote, isEnabled: soundEnabled, toggleSound } = useHarmonicTyping({
    enabled: harmonicSoundsEnabled,
    volume: 0.12,
    noteDuration: 120,
  });

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [message, adjustTextareaHeight]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setMessage((prev) => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || disabled || isSending || !isEncryptionReady) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;
    try {
      await onSend(trimmed);
      setMessage('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }, [message, disabled, isSending, isEncryptionReady, onSend]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) playNote(event.key);
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit, playNote],
  );

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(event.target.value);
  }, []);

  const isOverLimit = message.length > MAX_MESSAGE_LENGTH;
  const canSend =
    message.trim().length > 0 && !isOverLimit && !disabled && !isSending && isEncryptionReady;

  return (
    <div className={`relative ${className}`}>
      {replyTo && onCancelReply && (
        <ReplyPreview senderName={replyTo.senderName} preview={replyTo.preview} onCancel={onCancelReply} />
      )}

      <div className="relative px-4 py-3 bg-gradient-to-t from-black to-zinc-900/50">
        {disabled && <DisabledOverlay reason={disabledReason} />}

        <div className="flex items-center gap-3 bg-zinc-900/80 rounded-lg px-4 py-2 border border-zinc-800/50">
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>

          {/* Wash button — opens the off-Void encryption modal */}
          <button
            type="button"
            onClick={() => setShowWashModal(true)}
            className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors flex-shrink-0"
            title="Wash a phrase or invite code (off-Void encryption layer)"
          >
            <Droplets className="w-5 h-5" />
          </button>

          {/* Emoji */}
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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

          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isSending}
            rows={1}
            className="flex-1 bg-transparent text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none leading-6 py-1 min-h-[24px] max-h-[200px] scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent self-center"
            style={{ height: 'auto' }}
          />

          <div className="flex items-center gap-2 flex-shrink-0">
            <CharacterCount current={message.length} max={MAX_MESSAGE_LENGTH} />
            <EncryptionIndicator isReady={isEncryptionReady} />

            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className={`p-2 rounded-lg transition-all duration-150 ${
                canSend
                  ? 'bg-gradient-to-r from-zinc-600 to-zinc-500 hover:from-zinc-500 hover:to-zinc-400 text-zinc-100 shadow-lg shadow-black/30'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              }`}
              title={!isEncryptionReady ? 'Waiting for encryption...' : isOverLimit ? 'Message too long' : 'Send message'}
            >
              {isSending ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1 px-1">
          <span className="text-xs text-zinc-700">Press Enter to send, Shift+Enter for new line</span>
          {isOverLimit && (
            <span className="text-xs text-zinc-500">Message exceeds {MAX_MESSAGE_LENGTH} character limit</span>
          )}
        </div>
      </div>

      <WashModal isOpen={showWashModal} onClose={() => setShowWashModal(false)} />
    </div>
  );
}

export const MessageInput = React.memo(MessageInputBase);

export default MessageInput;
