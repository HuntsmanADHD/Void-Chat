import React, { useCallback, useMemo, useState } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type { MessageData } from './Message';
import { useSession } from '@/hooks/useSession';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';

export type ChatMode = 'channel' | 'dm';

export interface ChatHeaderInfo {
  name: string;
  icon?: string;
  description?: string;
  memberCount?: number;
  isOnline?: boolean;
  recipientId?: string;
}

export interface ChatContainerProps {
  mode: ChatMode;
  channelId?: string;
  recipientId?: string;
  headerInfo?: ChatHeaderInfo;
  messages: MessageData[];
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Send a plaintext message. Returns whether the send was accepted. */
  onSend: (plaintext: string) => Promise<boolean> | boolean;
  /** Whether the underlying realtime channel is ready to send. */
  isSendReady?: boolean;
  onReport?: (messageId: string, senderId: string) => void;
  className?: string;
}

/**
 * Chat surface. The realtime layer hands us already-decrypted plaintext in
 * `messages[].content`, and we hand back plaintext via `onSend`. All
 * encryption coordination lives in `useRealtime` / the relay client.
 */
export function ChatContainer({
  mode,
  channelId: _channelId,
  recipientId: _recipientId,
  headerInfo,
  messages,
  isLoading = false,
  hasMore = false,
  onLoadMore,
  onSend,
  isSendReady = true,
  onReport,
  className = '',
}: ChatContainerProps) {
  const { session } = useSession();
  const ownId = session?.signingPublicKey ?? '';

  const [replyTo, setReplyTo] = useState<{ id: string; senderName: string; preview: string } | null>(
    null,
  );
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Content arrives as plaintext; no decryption layer needed.
  const decryptedMessages = useMemo(
    () => new Map(messages.map((m) => [m.id, m.content])),
    [messages],
  );

  const handleSend = useCallback(
    async (plaintext: string) => {
      setIsSending(true);
      setError(null);
      try {
        const ok = await onSend(plaintext);
        if (!ok) setError('Message could not be delivered');
        else setReplyTo(null);
      } catch (err) {
        console.error('Failed to send message:', err);
        setError(err instanceof Error ? err.message : 'Failed to send message');
      } finally {
        setIsSending(false);
      }
    },
    [onSend],
  );

  const handleReply = useCallback(
    (message: MessageData) => {
      setReplyTo({
        id: message.id,
        senderName: (message.sender.publicId || message.senderId).slice(0, 8),
        preview: (decryptedMessages.get(message.id) ?? message.content).slice(0, 50),
      });
    },
    [decryptedMessages],
  );

  const handleCancelReply = useCallback(() => setReplyTo(null), []);

  return (
    <div className={`flex flex-col h-full bg-black ${className}`}>
      <ConnectionStatusBanner />
      {error && (
        <div className="px-4 py-2 bg-zinc-900/80 border-b border-zinc-800 flex items-center gap-2 text-zinc-400 text-sm">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-zinc-500 hover:text-zinc-300"
          >
            ×
          </button>
        </div>
      )}

      <MessageList
        messages={messages}
        decryptedMessages={decryptedMessages}
        currentUserId={ownId}
        onReport={onReport}
        onReply={handleReply}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        className="flex-1"
      />

      <MessageInput
        onSend={handleSend}
        disabled={!isSendReady}
        disabledReason={!isSendReady ? 'Connecting…' : undefined}
        isEncryptionReady={isSendReady}
        isSending={isSending}
        placeholder={
          mode === 'dm'
            ? `Message ${headerInfo?.name || 'user'}`
            : `Message #${headerInfo?.name || 'channel'}`
        }
        replyTo={replyTo}
        onCancelReply={handleCancelReply}
      />
    </div>
  );
}

export default ChatContainer;
