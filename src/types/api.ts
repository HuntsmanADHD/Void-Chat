/**
 * API types — STUB for the ephemeral pivot.
 *
 * Permissive shapes that keep dead UI components (NotificationCenter,
 * SearchModal, AttachmentDisplay, FilePreview) compiling. Their runtime
 * behavior is stubbed out; types here are just enough to satisfy tsc.
 */

export type ScanStatus = 'PENDING' | 'SCANNING' | 'CLEAN' | 'QUARANTINED' | 'ERROR';

export type NotificationType =
  | 'DM_RECEIVED'
  | 'MENTION'
  | 'REPLY_RECEIVED'
  | 'REACTION'
  | 'COMMUNITY_INVITE'
  | 'STRIKE_RECEIVED'
  | 'APPEAL_UPDATE';

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
  title?: string;
  body?: string;
  message?: string;
  senderPublicId?: string;
  channelId?: string;
}

export interface AttachmentResponse {
  id: string;
  url: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  mimeType?: string;
  size?: number;
  scanStatus?: ScanStatus;
}

export type SearchResultType = 'user' | 'community' | 'channel';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  label?: string;
  description?: string | null;
  publicId?: string;
  name?: string;
  avatar?: string | null;
  memberCount?: number;
  isPublic?: boolean;
  communityName?: string;
}

export interface SearchUserResult {
  publicId: string;
  displayName?: string;
}

export interface SearchCommunityResult {
  id: string;
  name: string;
  description?: string | null;
}

export interface SearchChannelResult {
  id: string;
  name: string;
  communityId: string;
  communityName?: string;
}

export interface SearchResults {
  users: SearchUserResult[];
  communities: SearchCommunityResult[];
  channels: SearchChannelResult[];
}
