import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { Message, type MessageData } from './Message';

/**
 * Time threshold (in ms) to group messages from same sender
 * Messages within 5 minutes from same sender are grouped
 */
const MESSAGE_GROUP_THRESHOLD = 5 * 60 * 1000;

/**
 * Grouped message for display
 */
interface MessageGroup {
  senderId: string;
  messages: MessageData[];
  firstMessageTime: Date;
}

export interface MessageListProps {
  /** Array of messages to display */
  messages: MessageData[];
  /** Map of message ID to decrypted content */
  decryptedMessages: Map<string, string>;
  /** Current user's public ID */
  currentUserId: string;
  /** Callback when user reports a message */
  onReport?: (messageId: string, senderId: string) => void;
  /** Callback when user replies to a message */
  onReply?: (message: MessageData) => void;
  /** Whether there are new messages below viewport */
  hasNewMessages?: boolean;
  /** Callback to scroll to bottom */
  onScrollToBottom?: () => void;
  /** Whether messages are loading */
  isLoading?: boolean;
  /** Whether more messages can be loaded */
  hasMore?: boolean;
  /** Callback to load more messages */
  onLoadMore?: () => void;
  /** Additional class names */
  className?: string;
}

/**
 * Check if two dates are on the same day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Format date for day separator
 */
function formatDaySeparator(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, today)) {
    return 'Today';
  } else if (isSameDay(date, yesterday)) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  }
}

/**
 * Group messages by sender and time proximity
 */
function groupMessages(messages: MessageData[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;

  for (const message of messages) {
    const messageTime = new Date(message.createdAt);

    if (
      currentGroup &&
      currentGroup.senderId === message.senderId &&
      messageTime.getTime() - currentGroup.firstMessageTime.getTime() < MESSAGE_GROUP_THRESHOLD
    ) {
      // Add to current group
      currentGroup.messages.push(message);
    } else {
      // Start new group
      currentGroup = {
        senderId: message.senderId,
        messages: [message],
        firstMessageTime: messageTime,
      };
      groups.push(currentGroup);
    }
  }

  return groups;
}

/**
 * Day separator component
 */
const DaySeparator = React.memo(function DaySeparator({ date }: { date: Date }) {
  return (
    <div className="flex items-center justify-center my-4">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
      <span className="px-4 text-xs text-zinc-600 font-medium">
        {formatDaySeparator(date)}
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
    </div>
  );
});

/**
 * New messages indicator
 */
const NewMessagesIndicator = React.memo(function NewMessagesIndicator({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-gradient-to-r from-zinc-700 to-zinc-600 hover:from-zinc-600 hover:to-zinc-500 text-zinc-200 text-sm font-medium rounded-full shadow-lg shadow-black/50 transition-all duration-200 flex items-center gap-2 animate-bounce border border-zinc-600/50"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
      New messages
    </button>
  );
});

/**
 * Loading skeleton for messages
 */
const MessageSkeleton = React.memo(function MessageSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-2 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-zinc-800" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-4 w-24 bg-zinc-800 rounded" />
          <div className="h-3 w-16 bg-zinc-900 rounded" />
        </div>
        <div className="h-4 w-3/4 bg-zinc-800 rounded" />
        <div className="h-4 w-1/2 bg-zinc-800 rounded" />
      </div>
    </div>
  );
});

/**
 * Empty state component
 */
const EmptyState = React.memo(function EmptyState({ type = 'channel' }: { type?: 'channel' | 'dm' }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="w-16 h-16 mb-4 rounded-full bg-gradient-to-br from-zinc-800 to-black flex items-center justify-center border border-zinc-800/50">
        {type === 'dm' ? (
          <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        ) : (
          <img
            src="/images/messenger-logo-16.png"
            alt=""
            aria-hidden="true"
            className="w-10 h-10"
            // Pixel art needs nearest-neighbor scaling — without this
            // the browser bilinears the upscale and the crisp pixels
            // blur into mush.
            style={{ imageRendering: 'pixelated' }}
          />
        )}
      </div>
      <h3 className="text-lg font-medium text-zinc-300 mb-1">
        {type === 'dm' ? 'Start a conversation' : 'No messages yet'}
      </h3>
      <p className="text-sm text-zinc-600 max-w-sm">
        {type === 'dm'
          ? 'Send an encrypted message to start chatting. All messages are end-to-end encrypted.'
          : 'Be the first to send a message in this channel. Your message will be encrypted.'}
      </p>
    </div>
  );
});

/**
 * Message list component for Void Chat
 *
 * Features:
 * - Native scroll (no virtualization for simplicity, but optimized)
 * - Message grouping by sender and time
 * - Day separators
 * - Auto-scroll to bottom on new messages
 * - "New messages" indicator when scrolled up
 * - Loading states
 * - Empty state
 * - Infinite scroll up for history
 */
export function MessageList({
  messages,
  decryptedMessages,
  currentUserId,
  onReport,
  onReply,
  hasNewMessages = false,
  onScrollToBottom,
  isLoading = false,
  hasMore = false,
  onLoadMore,
  className = '',
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const prevMessagesLengthRef = useRef(messages.length);

  // Group messages by sender - memoized for performance
  const messageGroups = useMemo(() => {
    return groupMessages(messages);
  }, [messages]);

  // Check if scrolled to bottom
  const checkIfAtBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;

    const threshold = 100; // px from bottom
    const isBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setIsAtBottom(isBottom);
    return isBottom;
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior });
    setShowNewMessages(false);
    setIsAtBottom(true);
  }, []);

  // Coalesce scroll events to one work cycle per animation frame.
  // Webkit fires scroll at every input update, which is well above what
  // the bottom-detection + load-more logic actually needs.
  const scrollRafRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;
      const atBottom = checkIfAtBottom();
      if (atBottom) setShowNewMessages(false);
      if (hasMore && onLoadMore && container.scrollTop < 100) onLoadMore();
    });
  }, [checkIfAtBottom, hasMore, onLoadMore]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // Auto-scroll when new messages arrive (if at bottom)
  useEffect(() => {
    const newMessagesArrived = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;

    if (newMessagesArrived) {
      if (isAtBottom) {
        scrollToBottom('smooth');
      } else {
        setShowNewMessages(true);
      }
    }
  }, [messages.length, isAtBottom, scrollToBottom]);

  // Update new messages indicator from prop
  useEffect(() => {
    if (hasNewMessages && !isAtBottom) {
      setShowNewMessages(true);
    }
  }, [hasNewMessages, isAtBottom]);

  // Initial scroll to bottom
  useEffect(() => {
    if (messages.length > 0 && !isLoading) {
      scrollToBottom('auto');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Handle new messages button click
  const handleNewMessagesClick = useCallback(() => {
    scrollToBottom('smooth');
    onScrollToBottom?.();
  }, [scrollToBottom, onScrollToBottom]);

  // Render messages with day separators
  const renderMessages = () => {
    const elements: React.ReactNode[] = [];
    let lastDate: Date | null = null;

    for (const group of messageGroups) {
      const groupDate = new Date(group.firstMessageTime);

      // Add day separator if needed
      if (!lastDate || !isSameDay(lastDate, groupDate)) {
        elements.push(
          <DaySeparator key={`day-${groupDate.toISOString()}`} date={groupDate} />
        );
        lastDate = groupDate;
      }

      // Render messages in group with background
      const groupMessages = group.messages.map((message, index) => {
        const isFirstInGroup = index === 0;
        const isOwn = message.sender.publicId === currentUserId;
        const decryptedContent = decryptedMessages.get(message.id);

        return (
          <Message
            key={message.id}
            message={message}
            decryptedContent={decryptedContent}
            isOwn={isOwn}
            showSender={isFirstInGroup}
            onReport={onReport}
            onReply={onReply}
          />
        );
      });

      // Wrap group messages with background
      elements.push(
        <div key={`group-${group.senderId}-${groupDate.toISOString()}`} className="message-group-bg">
          {groupMessages}
        </div>
      );
    }

    return elements;
  };

  return (
    <div className={`relative flex-1 min-h-0 overflow-hidden ${className}`}>
      {/* Chat background image + vignette overlay. Both promoted to their
          own GPU compositor layer so scrolling the message list doesn't
          repaint the background every frame. */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-10 pointer-events-none gpu-backdrop"
        style={{ backgroundImage: 'url(/images/chat-background.jpg)' }}
      />
      <div
        className="absolute inset-0 pointer-events-none gpu-backdrop"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0, 0, 0, 0.8) 100%)',
        }}
      />
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative h-full overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent"
      >
        {/* Loading more indicator */}
        {hasMore && (
          <div className="py-4 text-center">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 text-zinc-600">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                <span className="text-sm">Loading messages...</span>
              </div>
            ) : (
              <button
                onClick={onLoadMore}
                className="text-sm text-zinc-500 hover:text-zinc-400 transition-colors"
              >
                Load older messages
              </button>
            )}
          </div>
        )}

        {/* Loading state */}
        {isLoading && messages.length === 0 ? (
          <div className="space-y-2 py-4">
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="py-4">{renderMessages()}</div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* New messages indicator */}
      {showNewMessages && (
        <NewMessagesIndicator onClick={handleNewMessagesClick} />
      )}
    </div>
  );
}

export default MessageList;
