/**
 * Zod validation schemas for API requests
 */

import { z } from 'zod';

// =============================================================================
// COMMON SCHEMAS
// =============================================================================

export const publicIdSchema = z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/);
export const publicKeySchema = z.string().min(32);

// =============================================================================
// COMMUNITY SCHEMAS
// =============================================================================

export const createCommunitySchema = z.object({
  name: z.string().min(3).max(50).trim(),
  description: z.string().max(500).trim().optional().nullable(),
  avatar: z.string().url().optional().nullable(),
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
// REPORT SCHEMAS
// =============================================================================

export const createReportSchema = z.object({
  reportedUserId: z.string().cuid(),
  communityId: z.string().cuid(),
  messageId: z.string().cuid().optional(),
  category: z.enum(['SPAM', 'HARASSMENT', 'SCAM', 'ILLEGAL', 'OTHER']),
  description: z.string().min(10).max(1000).trim(),
});
