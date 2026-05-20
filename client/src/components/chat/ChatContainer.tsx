import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type { MessageData } from './Message';
import { useEncryption } from '@/hooks/useEncryption';
import { useAuth } from '@/hooks/useAuth';

/**
 * Chat mode - either a channel or direct message
 */
export type ChatMode = 'channel' | 'dm';

/**
 * Chat header information
 */
export interface ChatHeaderInfo {
  /** Display name (channel name or user handle) */
  name: string;
  /** Icon URL for channels, avatar for DMs */
  icon?: string;
  /** Description for channels */
  description?: string;
  /** Member count for channels */
  memberCount?: number;
  /** Online status for DMs */
  isOnline?: boolean;
  /** Recipient ID for DMs */
  recipientId?: string;
}

export interface ChatContainerProps {
  /** Chat mode */
  mode: ChatMode;
  /** Channel ID (for channel mode) */
  channelId?: string;
  /** Recipient ID (for DM mode) */
  recipientId?: string;
  /** Header information */
  headerInfo?: ChatHeaderInfo;
  /** Messages to display */
  messages: MessageData[];
  /** Whether messages are loading */
  isLoading?: boolean;
  /** Whether there are more messages to load */
  hasMore?: boolean;
  /** Callback to load more messages */
  onLoadMore?: () => void;
  /** Callback when message is sent successfully */
  onMessageSent?: (message: { content: string; nonce: string }) => void;
  /** Callback when user reports a message */
  onReport?: (messageId: string, senderId: string) => void;
  /** Whether the user is timed out */
  isTimedOut?: boolean;
  /** Timeout end time (for display) */
  timeoutEndTime?: Date;
  /** Callback when user selects a file to send */
  onFileSend?: (file: File) => void;
  /** Additional class names */
  className?: string;
  /** TESTING: Skip encryption for development */
  testMode?: boolean;
}

// ChatHeader removed - using AppLayout's Header component instead

/**
 * Chat container component for Void Chat
 *
 * Features:
 * - Combines MessageList and MessageInput
 * - Handles encryption/decryption via useEncryption hook
 * - Displays header with channel/DM info
 * - Loading and error states
 * - Timeout indicator
 * - Reply handling
 */
export function ChatContainer({
  mode,
  channelId,
  recipientId,
  headerInfo,
  messages,
  isLoading = false,
  hasMore = false,
  onLoadMore,
  onMessageSent,
  onReport,
  isTimedOut = false,
  timeoutEndTime,
  onFileSend,
  className = '',
  testMode: testModeProp = false,
}: ChatContainerProps) {
  // SECURITY: Only allow testMode in development builds. In production,
  // testMode is always false regardless of the prop value.
  const testMode = import.meta.env.DEV ? testModeProp : false;
  const { publicId: wallet, isBlacklisted } = useAuth();
  const {
    isInitialized,
    hasKeypair,
    encryptForUser,
    encryptForChannel,
    decryptFromUser,
    decryptFromChannel,
  } = useEncryption();

  const [decryptedMessages, setDecryptedMessages] = useState<Map<string, string>>(new Map());
  const [replyTo, setReplyTo] = useState<{
    id: string;
    senderName: string;
    preview: string;
  } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decrypt messages when they arrive (or decode in test mode) - optimized
  // Using functional update pattern to avoid stale closure issues
  useEffect(() => {
    // In test mode, decode base64 synchronously using functional update
    if (testMode) {
      setDecryptedMessages((prevDecrypted) => {
        // Only process messages that haven't been decrypted yet
        const messagesToProcess = messages.filter(msg => !prevDecrypted.has(msg.id));

        if (messagesToProcess.length === 0) {
          // Return same reference to avoid unnecessary re-render
          return prevDecrypted;
        }

        // Create new map with all previous entries
        const newDecrypted = new Map(prevDecrypted);
        let hasChanges = false;

        for (const message of messagesToProcess) {
          try {
            // Decode base64 content
            const decoded = decodeURIComponent(escape(atob(message.content)));
            newDecrypted.set(message.id, decoded);
            hasChanges = true;
          } catch (err) {
            console.error(`Failed to decode message ${message.id}:`, err);
            // Set a fallback message - try to show the raw content
            newDecrypted.set(message.id, message.content);
            hasChanges = true;
          }
        }

        // Return new map if changes were made, otherwise return previous reference
        return hasChanges ? newDecrypted : prevDecrypted;
      });
      return;
    }

    // Handle async decryption for non-test mode
    if (!isInitialized || !hasKeypair) return;

    const decryptNewMessages = async () => {
      // Get IDs that need processing - check current state using functional update
      let messagesToProcess: MessageData[] = [];

      setDecryptedMessages((prevDecrypted) => {
        messagesToProcess = messages.filter(msg => !prevDecrypted.has(msg.id));
        return prevDecrypted; // Don't change state here, just read
      });

      if (messagesToProcess.length === 0) return;

      const decryptionResults: Array<{ id: string; content: string }> = [];

      await Promise.all(messagesToProcess.map(async (message) => {
        try {
          let decrypted: string | null = null;

          if (mode === 'dm' && message.sender.publicId) {
            decrypted = await decryptFromUser(
              message.content,
              message.nonce,
              message.sender.publicId
            );
          } else if (mode === 'channel' && channelId) {
            decrypted = await decryptFromChannel(
              message.content,
              message.nonce,
              channelId
            );
          }

          if (decrypted) {
            decryptionResults.push({ id: message.id, content: decrypted });
          }
        } catch (err) {
          console.error(`Failed to decrypt message ${message.id}:`, err);
        }
      }));

      // Update state with decryption results using functional update
      if (decryptionResults.length > 0) {
        setDecryptedMessages((prev) => {
          const updated = new Map(prev);
          for (const result of decryptionResults) {
            updated.set(result.id, result.content);
          }
          return updated;
        });
      }
    };

    decryptNewMessages();
  }, [
    messages,
    testMode,
    isInitialized,
    hasKeypair,
    mode,
    channelId,
    decryptFromUser,
    decryptFromChannel,
  ]);

  // Handle sending a message
  const handleSend = useCallback(
    async (plaintext: string) => {
      // In test mode, skip encryption and send plaintext as base64
      if (testMode) {
        setIsSending(true);
        setError(null);
        try {
          // Encode plaintext as base64 for API compatibility
          const content = btoa(unescape(encodeURIComponent(plaintext)));
          const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));

          if (onMessageSent) {
            onMessageSent({ content, nonce });
          }
          setReplyTo(null);
        } catch (err) {
          console.error('Failed to send message:', err);
          setError(err instanceof Error ? err.message : 'Failed to send message');
        } finally {
          setIsSending(false);
        }
        return;
      }

      if (!isInitialized || !hasKeypair) {
        setError('Encryption not ready - sign the message prompt to enable');
        return;
      }

      setIsSending(true);
      setError(null);

      try {
        let encrypted: { encrypted: string; nonce: string } | null = null;

        if (mode === 'dm' && recipientId) {
          encrypted = await encryptForUser(plaintext, recipientId);
        } else if (mode === 'channel' && channelId) {
          encrypted = await encryptForChannel(plaintext, channelId);
        }

        if (!encrypted) {
          throw new Error('Failed to encrypt message');
        }

        // Call the onMessageSent callback with encrypted data
        if (onMessageSent) {
          onMessageSent({
            content: encrypted.encrypted,
            nonce: encrypted.nonce,
          });
        }

        // Clear reply
        setReplyTo(null);
      } catch (err) {
        console.error('Failed to send message:', err);
        setError(err instanceof Error ? err.message : 'Failed to send message');
      } finally {
        setIsSending(false);
      }
    },
    [
      testMode,
      isInitialized,
      hasKeypair,
      mode,
      recipientId,
      channelId,
      encryptForUser,
      encryptForChannel,
      onMessageSent,
    ]
  );

  // Handle reply
  const handleReply = useCallback((message: MessageData) => {
    const decrypted = decryptedMessages.get(message.id);
    setReplyTo({
      id: message.id,
      senderName: (message.sender.publicId || message.senderId).slice(0, 8),
      preview: decrypted?.slice(0, 50) || '[Encrypted message]',
    });
  }, [decryptedMessages]);

  // Cancel reply
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // Calculate disabled reason
  const disabledReason = useMemo(() => {
    if (isBlacklisted) {
      return 'Your account has been blacklisted';
    }
    if (isTimedOut && timeoutEndTime) {
      const remaining = Math.max(0, timeoutEndTime.getTime() - Date.now());
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      return `You are timed out for ${hours}h ${minutes}m`;
    }
    if (isTimedOut) {
      return 'You are currently timed out';
    }
    return undefined;
  }, [isBlacklisted, isTimedOut, timeoutEndTime]);

  const isDisabled = isBlacklisted || isTimedOut;
  const isEncryptionReady = testMode || (isInitialized && hasKeypair);

  return (
    <div className={`flex flex-col h-full bg-black ${className}`}>
      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-zinc-900/80 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-zinc-500 hover:text-zinc-300"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Message list */}
      <MessageList
        messages={messages}
        decryptedMessages={decryptedMessages}
        currentUserId={wallet || ''}
        onReport={onReport}
        onReply={handleReply}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        className="flex-1"
      />

      {/* Message input */}
      <MessageInput
        onSend={handleSend}
        onFileSelect={onFileSend}
        disabled={isDisabled}
        disabledReason={disabledReason}
        isEncryptionReady={isEncryptionReady}
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
