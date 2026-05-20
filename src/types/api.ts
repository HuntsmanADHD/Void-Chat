/**
 * API Types for Void Chat
 * Defines request/response shapes for all API routes
 */

import type { ReportCategory } from '@prisma/client';

// Locally defined types (removed from Prisma schema during relay conversion)
export type MembershipRole = 'MEMBER';

export type ScanStatus = 'PENDING' | 'SCANNING' | 'CLEAN' | 'QUARANTINED' | 'ERROR';

export type NotificationType =
  | 'DM_RECEIVED'
  | 'MENTION'
  | 'REACTION'
  | 'COMMUNITY_INVITE'
  | 'COMMUNITY_KICKED'
  | 'PLATFORM_BANNED'
  | 'REPLY_RECEIVED';

// =============================================================================
// AUTH TYPES
// =============================================================================

export interface VerifyAuthRequest {
  publicId: string;
  signature: string;
  message: string;
  publicKey: string;
}

export interface VerifyAuthResponse {
  token: string;
  user: {
    id: string;
    publicId: string;
    publicKey: string;
    artHash: string;
  };
}

export interface BlacklistStatusResponse {
  isBlacklisted: boolean;
}

// =============================================================================
// USER TYPES
// =============================================================================

export interface UserProfileResponse {
  publicId: string;
  publicKey: string;
  createdAt: string;
}

export interface UpdateUserProfileRequest {
  publicKey?: string;
}

export interface PublicKeyResponse {
  publicId: string;
  publicKey: string;
}

// =============================================================================
// COMMUNITY TYPES
// =============================================================================

export interface CommunityResponse {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  isPublic: boolean;
  memberCount: number;
  createdAt: string;
}

export interface CreateCommunityRequest {
  name: string;
  description?: string;
  avatar?: string;
  isPublic?: boolean;
}

export interface UpdateCommunityRequest {
  name?: string;
  description?: string;
  avatar?: string;
  isPublic?: boolean;
}

export interface CommunityListResponse {
  communities: CommunityResponse[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// =============================================================================
// MEMBERSHIP TYPES
// =============================================================================

export interface MemberResponse {
  publicId: string;
  publicKey: string;
  role: MembershipRole;
  joinedAt: string;
}

export interface MemberListResponse {
  members: MemberResponse[];
  total: number;
}

export interface JoinCommunityRequest {
  // No body needed - auth header provides identity info
}

export interface JoinCommunityResponse {
  success: boolean;
  membership?: {
    id: string;
    role: MembershipRole;
    joinedAt: string;
  };
  error?: string;
}

// =============================================================================
// CHANNEL TYPES
// =============================================================================

export interface ChannelResponse {
  id: string;
  name: string;
  description: string | null;
  communityId: string;
  isDefault: boolean;
  createdAt: string;
}

export interface CreateChannelRequest {
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface ChannelListResponse {
  channels: ChannelResponse[];
  total: number;
}

// =============================================================================
// MESSAGE TYPES
// =============================================================================

export interface MessageResponse {
  id: string;
  encryptedContent: string;
  nonce: string;
  senderPublicId: string;
  senderPublicKey: string;
  channelId: string | null;
  recipientPublicId: string | null;
  isDirectMessage: boolean;
  createdAt: string;
}

export interface SendMessageRequest {
  encryptedContent: string;
  nonce: string;
}

export interface MessageListResponse {
  messages: MessageResponse[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// =============================================================================
// REPORT TYPES
// =============================================================================

export interface CreateReportRequest {
  reportedUserId: string;
  communityId: string;
  messageId?: string;
  category: ReportCategory;
  description: string;
}

export interface CreateReportResponse {
  success: boolean;
  reported?: boolean;
  userKicked?: boolean;
  userBanned?: boolean;
  reportCount?: number;
  threshold?: number;
  error?: string;
}

export interface ReportResponse {
  id: string;
  reporterPublicId: string;
  reportedUserPublicId: string;
  communityId: string;
  messageId: string | null;
  category: ReportCategory;
  description: string;
  createdAt: string;
}

export interface ReportListResponse {
  reports: ReportResponse[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, string>;
}

// =============================================================================
// PAGINATION TYPES
// =============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

// =============================================================================
// ATTACHMENT TYPES
// =============================================================================

export interface AttachmentResponse {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileExtension: string;
  encryptionNonce: string;
  scanStatus: ScanStatus;
  thumbnailUrl: string | null;
  downloadUrl: string;
  createdAt: string;
}

export interface UploadAttachmentRequest {
  // Multipart form data - handled separately
  // file: File
  // fileName: string
  // fileType: string
  // nonce: string
  // channelId?: string
  // recipientPublicId?: string
  // thumbnail?: File (optional)
  // thumbnailNonce?: string (optional)
}

export interface UploadAttachmentResponse {
  attachmentId: string;
  scanStatus: ScanStatus;
  estimatedScanTime: number; // seconds
}

export interface ScanStatusResponse {
  scanStatus: ScanStatus;
  canDownload: boolean;
  quarantineReason: string | null;
  scannedAt: string | null;
}

export interface MessageResponseWithAttachments extends MessageResponse {
  attachments?: AttachmentResponse[];
}

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  read: boolean;
  messageId: string | null;
  channelId: string | null;
  communityId: string | null;
  senderId: string | null;
  senderPublicId: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: NotificationResponse[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface MarkNotificationsReadRequest {
  notificationIds?: string[]; // If empty, marks all as read
}

export interface MarkNotificationsReadResponse {
  success: boolean;
  updatedCount: number;
}

// =============================================================================
// SEARCH TYPES
// =============================================================================

export type SearchResultType = 'user' | 'community' | 'channel' | 'message';

export interface SearchUserResult {
  type: 'user';
  id: string;
  publicId: string;
  publicKey: string;
}

export interface SearchCommunityResult {
  type: 'community';
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  memberCount: number;
  isPublic: boolean;
}

export interface SearchChannelResult {
  type: 'channel';
  id: string;
  name: string;
  description: string | null;
  communityId: string;
  communityName: string;
}

export interface SearchMessageResult {
  type: 'message';
  id: string;
  channelId: string | null;
  channelName: string | null;
  communityName: string | null;
  senderPublicId: string;
  createdAt: string;
  // Note: Content is encrypted, so we can't search message content server-side
}

export type SearchResult =
  | SearchUserResult
  | SearchCommunityResult
  | SearchChannelResult
  | SearchMessageResult;

export interface SearchRequest {
  query: string;
  types?: SearchResultType[]; // Filter by type
  communityId?: string; // Scope to specific community
  limit?: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
}
