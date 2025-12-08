/**
 * Zod validation schemas for API requests
 */

import { z } from 'zod';

// =============================================================================
// COMMON SCHEMAS
// =============================================================================

export const walletAddressSchema = z.string().min(32).max(44);
export const xHandleSchema = z.string().min(1).max(15).regex(/^[a-zA-Z0-9_]+$/);
export const publicKeySchema = z.string().min(32);

// =============================================================================
// COMMUNITY SCHEMAS
// =============================================================================

export const createCommunitySchema = z.object({
  name: z.string().min(3).max(50).trim(),
  description: z.string().max(500).trim().optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  minTokenBalance: z.string().regex(/^\d+$/).optional(),
  isPublic: z.boolean().optional(),
});

// =============================================================================
// CHANNEL SCHEMAS
// =============================================================================

export const createChannelSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).trim(),
  description: z.string().max(200).trim().optional().nullable(),
  isDefault: z.boolean().optional(),
});

// =============================================================================
// MESSAGE SCHEMAS
// =============================================================================

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000).trim(),
  channelId: z.string().cuid(),
  attachmentIds: z.array(z.string().cuid()).max(10).optional(),
});

// =============================================================================
// REPORT SCHEMAS
// =============================================================================

export const reportCategories = [
  'SPAM',
  'HARASSMENT',
  'HATE_SPEECH',
  'VIOLENCE',
  'ILLEGAL_CONTENT',
  'IMPERSONATION',
  'OTHER',
] as const;

export const createReportSchema = z.object({
  reportedUserId: z.string().cuid(),
  messageId: z.string().cuid().optional(),
  category: z.enum(['SPAM', 'HARASSMENT', 'SCAM', 'ILLEGAL', 'OTHER']),
  description: z.string().min(10).max(1000).trim(),
});

export const reviewReportSchema = z.object({
  status: z.enum(['REVIEWED', 'DISMISSED', 'ACTION_TAKEN']),
  issueStrike: z.boolean().optional(),
  strikeReason: z.string().min(10).max(500).trim().optional(),
}).refine(
  (data) => !data.issueStrike || (data.issueStrike && data.strikeReason),
  {
    message: 'strikeReason is required when issueStrike is true',
    path: ['strikeReason'],
  }
);

// =============================================================================
// APPEAL SCHEMAS
// =============================================================================

export const createAppealSchema = z.object({
  strikeId: z.string().cuid(),
  reason: z.string().min(20).max(2000).trim(),
});

export const reviewAppealSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reviewNote: z.string().max(500).trim().optional(),
});

// =============================================================================
// SEARCH SCHEMAS
// =============================================================================

export const searchSchema = z.object({
  q: z.string().min(2).max(100).trim(),
  types: z.string().regex(/^(user|community|channel)(,(user|community|channel))*$/).optional(),
  communityId: z.string().cuid().optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

// =============================================================================
// PAGINATION SCHEMAS
// =============================================================================

export const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});
