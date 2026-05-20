/**
 * Chat component exports for Void Chat
 */

// Message components
export { Message, type MessageProps, type MessageData, type MessageSender } from './Message';
export { MessageList, type MessageListProps } from './MessageList';
export { MessageInput, type MessageInputProps } from './MessageInput';

// Chat container
export { ChatContainer, type ChatContainerProps, type ChatMode, type ChatHeaderInfo } from './ChatContainer';

// List components
export { DMList, type DMListProps, type DMConversation } from './DMList';
export { ChannelList, type ChannelListProps, type Channel, type ChannelCategory } from './ChannelList';

// Typing and status indicators
export {
  TypingIndicator,
  CompactTypingIndicator,
  useTypingDisplay,
} from './TypingIndicator';

export {
  OnlineStatus,
  StatusDot,
  OnlineStatusBadge,
  ConnectionQuality,
  OnlineUserCount,
} from './OnlineStatus';

export type { UserStatus, StatusSize } from './OnlineStatus';
