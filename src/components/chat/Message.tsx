'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { EmojiPicker } from './EmojiPicker';
import { truncatePublicId } from '@/lib/format';

/**
 * Reaction data structure
 */
export interface Reaction {
  emoji: string;
  count: number;
  hasReacted: boolean;
}

/**
 * Message sender information
 */
export interface MessageSender {
  publicId: string;
  avatarUrl?: string | null;
}

/**
 * Reply reference data
 */
export interface ReplyTo {
  id: string;
  senderName: string;
  preview: string;
}

/**
 * Message data structure
 */
export interface MessageData {
  id: string;
  content: string;
  nonce: string;
  senderId: string;
  sender: MessageSender;
  channelId?: string | null;
  dmRecipient?: string | null;
  createdAt: Date | string;
  isDecrypted?: boolean;
  decryptionError?: boolean;
  /** Reference to the message being replied to */
  replyTo?: ReplyTo | null;
}

export interface MessageProps {
  message: MessageData;
  /** Decrypted message content (decryption happens in parent) */
  decryptedContent?: string | null;
  /** Whether this message is from the current user */
  isOwn?: boolean;
  /** Whether to show the sender info (for grouped messages) */
  showSender?: boolean;
  /** Callback when user clicks report */
  onReport?: (messageId: string, senderId: string) => void;
  /** Callback when user clicks reply */
  onReply?: (message: MessageData) => void;
  /** Reactions for this message */
  reactions?: Reaction[];
  /** Callback when user reacts to a message */
  onReact?: (messageId: string, emoji: string) => void;
  /** Callback when user clicks on a reply reference to scroll to that message */
  onScrollToReply?: (messageId: string) => void;
  /** Additional class names */
  className?: string;
}

/**
 * Format a timestamp to relative time
 */
function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const messageDate = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - messageDate.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'just now';
  } else if (diffMin < 60) {
    return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  } else if (diffHour < 24) {
    return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  } else if (diffDay < 7) {
    return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  } else {
    return messageDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: messageDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }
}

function formatFullTimestamp(date: Date | string): string {
  const messageDate = typeof date === 'string' ? new Date(date) : date;
  return messageDate.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Reply indicator component
 */
function ReplyIndicator({
  replyTo,
  onScrollToReply,
}: {
  replyTo: ReplyTo;
  onScrollToReply?: (messageId: string) => void;
}) {
  return (
    <button
      onClick={() => onScrollToReply?.(replyTo.id)}
      className="flex items-center gap-2 mb-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors group"
    >
      <svg
        className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
        />
      </svg>
      <span>
        Replying to{' '}
        <span className="text-zinc-400 font-medium group-hover:text-zinc-300">
          {replyTo.senderName}
        </span>
      </span>
      <span className="text-zinc-600 truncate max-w-[150px] hidden sm:inline">
        {replyTo.preview}
      </span>
    </button>
  );
}

/**
 * Reactions display component
 */
function ReactionsDisplay({
  reactions,
  onReact,
  messageId
}: {
  reactions: Reaction[];
  onReact?: (messageId: string, emoji: string) => void;
  messageId: string;
}) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map(({ emoji, count, hasReacted }) => (
        <button
          key={emoji}
          onClick={() => onReact?.(messageId, emoji)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
            hasReacted
              ? 'bg-zinc-700/50 border border-zinc-600/50 text-zinc-300'
              : 'bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50 text-zinc-400'
          }`}
          title={`${count} ${count === 1 ? 'reaction' : 'reactions'}`}
        >
          <span>{emoji}</span>
          <span>{count}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Message hover menu
 */
function MessageHoverMenu({
  onReport,
  onReply,
  onCopy,
  onReact,
}: {
  onReport?: () => void;
  onReply?: () => void;
  onCopy: () => void;
  onReact?: (emoji: string) => void;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleEmojiSelect = (emoji: string) => {
    if (onReact) {
      onReact(emoji);
    }
  };

  return (
    <div className="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-zinc-900 rounded-md shadow-lg shadow-black/50 border border-zinc-800 flex items-center gap-0.5 p-0.5">
      {onReact && (
        <div className="relative">
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
            title="Add reaction"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {showEmojiPicker && (
            <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} position="top" />
          )}
        </div>
      )}
      {onReply && (
        <button onClick={onReply} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors" title="Reply">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
      )}
      <button onClick={onCopy} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors" title="Copy message">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </button>
      {onReport && (
        <button onClick={onReport} className="p-1.5 text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800 rounded transition-colors" title="Report message">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Single message component for Void Chat
 */
export const Message = React.memo(function Message({
  message,
  decryptedContent,
  isOwn = false,
  showSender = true,
  onReport,
  onReply,
  reactions,
  onReact,
  onScrollToReply,
  className = '',
}: MessageProps) {
  const [copied, setCopied] = useState(false);

  const { sender, createdAt } = message;

  const displayName = useMemo(() => {
    return truncatePublicId(sender.publicId);
  }, [sender.publicId]);

  const relativeTime = useMemo(() => formatRelativeTime(createdAt), [createdAt]);
  const fullTimestamp = useMemo(() => formatFullTimestamp(createdAt), [createdAt]);

  const handleCopy = useCallback(() => {
    const textToCopy = decryptedContent || message.content;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [decryptedContent, message.content]);

  const handleReport = useCallback(() => {
    if (onReport) {
      onReport(message.id, message.senderId);
    }
  }, [onReport, message.id, message.senderId]);

  const handleReply = useCallback(() => {
    if (onReply) {
      onReply(message);
    }
  }, [onReply, message]);

  const handleReact = useCallback((emoji: string) => {
    if (onReact) {
      onReact(message.id, emoji);
    }
  }, [onReact, message.id]);

  const isDecryptionError = message.decryptionError || (!decryptedContent && message.isDecrypted === false);

  return (
    <div className={`group relative flex items-start gap-3 px-4 py-1 hover:bg-zinc-900/50 transition-colors ${className}`}>
      {showSender ? (
        <Avatar
          publicId={sender.publicId}
          imageUrl={sender.avatarUrl}
          size="md"
          className="flex-shrink-0 mt-0.5"
        />
      ) : (
        <div className="w-10 flex-shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        {message.replyTo && (
          <ReplyIndicator replyTo={message.replyTo} onScrollToReply={onScrollToReply} />
        )}

        {showSender && (
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`font-medium ${isOwn ? 'text-zinc-300' : 'text-zinc-200'} hover:underline cursor-pointer`}
              title={sender.publicId}
            >
              {displayName}
            </span>

            <span className="text-xs text-zinc-600" title={fullTimestamp}>
              {relativeTime}
            </span>
          </div>
        )}

        <div className={`text-zinc-300 break-words ${!showSender ? 'ml-0' : ''}`}>
          {isDecryptionError ? (
            <span className="text-zinc-500 italic flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              Unable to decrypt message
            </span>
          ) : decryptedContent ? (
            <span>{decryptedContent}</span>
          ) : (
            <span className="text-zinc-600 italic flex items-center gap-1">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Decrypting...
            </span>
          )}
        </div>

        {reactions && reactions.length > 0 && (
          <ReactionsDisplay reactions={reactions} onReact={onReact} messageId={message.id} />
        )}

        {copied && (
          <span className="text-xs text-zinc-500 mt-1">Copied!</span>
        )}
      </div>

      <MessageHoverMenu
        onReport={!isOwn ? handleReport : undefined}
        onReply={onReply ? handleReply : undefined}
        onCopy={handleCopy}
        onReact={onReact ? handleReact : undefined}
      />
    </div>
  );
});

export default Message;
