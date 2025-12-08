import { z } from 'zod';

export const communityNameSchema = z
  .string()
  .min(3, 'Community name must be at least 3 characters')
  .max(50, 'Community name must be 50 characters or less')
  .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Community name can only contain letters, numbers, spaces, hyphens, and underscores');

export const communityDescriptionSchema = z
  .string()
  .max(500, 'Description must be 500 characters or less')
  .optional();

export const minTokenBalanceSchema = z
  .string()
  .regex(/^\d+$/, 'Must be a valid number')
  .refine((val) => BigInt(val) >= 0, 'Minimum token balance must be 0 or greater')
  .optional();

export const createCommunityFormSchema = z.object({
  name: communityNameSchema,
  description: communityDescriptionSchema,
  minHold: minTokenBalanceSchema,
  isPrivate: z.boolean(),
});

export const channelNameSchema = z
  .string()
  .min(2, 'Channel name must be at least 2 characters')
  .max(50, 'Channel name must be 50 characters or less')
  .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Channel name can only contain letters, numbers, spaces, hyphens, and underscores');

export const channelDescriptionSchema = z
  .string()
  .max(200, 'Description must be 200 characters or less')
  .optional();

export const createChannelFormSchema = z.object({
  name: channelNameSchema,
  description: channelDescriptionSchema,
  isDefault: z.boolean().optional(),
});

export const messageContentSchema = z
  .string()
  .min(1, 'Message cannot be empty')
  .max(4000, 'Message must be 4000 characters or less');

export const sendMessageFormSchema = z.object({
  content: messageContentSchema,
  attachments: z.array(z.instanceof(File)).max(5, 'Maximum 5 attachments allowed').optional(),
});

export const reportCategorySchema = z.enum(['SPAM', 'HARASSMENT', 'SCAM', 'ILLEGAL', 'OTHER'], {
  errorMap: () => ({ message: 'Please select a valid report category' }),
});

export const reportDescriptionSchema = z
  .string()
  .min(10, 'Description must be at least 10 characters')
  .max(1000, 'Description must be 1000 characters or less');

export const createReportFormSchema = z.object({
  reportedUserId: z.string().cuid('Invalid user ID'),
  messageId: z.string().cuid('Invalid message ID').optional(),
  category: reportCategorySchema,
  description: reportDescriptionSchema,
});

export const appealReasonSchema = z
  .string()
  .min(20, 'Appeal reason must be at least 20 characters')
  .max(2000, 'Appeal reason must be 2000 characters or less');

export const createAppealFormSchema = z.object({
  strikeId: z.string().cuid('Invalid strike ID'),
  reason: appealReasonSchema,
});

export const searchQuerySchema = z
  .string()
  .min(2, 'Search query must be at least 2 characters')
  .max(100, 'Search query must be 100 characters or less');

export const searchFormSchema = z.object({
  query: searchQuerySchema,
  type: z.enum(['all', 'communities', 'users', 'messages']).optional(),
});

export const walletAddressSchema = z
  .string()
  .min(32, 'Invalid wallet address')
  .max(44, 'Invalid wallet address')
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid wallet address format');

export const xHandleSchema = z
  .string()
  .min(1, 'X handle is required')
  .max(15, 'X handle must be 15 characters or less')
  .regex(/^[a-zA-Z0-9_]+$/, 'X handle can only contain letters, numbers, and underscores');

export type CreateCommunityFormData = z.infer<typeof createCommunityFormSchema>;
export type CreateChannelFormData = z.infer<typeof createChannelFormSchema>;
export type SendMessageFormData = z.infer<typeof sendMessageFormSchema>;
export type CreateReportFormData = z.infer<typeof createReportFormSchema>;
export type CreateAppealFormData = z.infer<typeof createAppealFormSchema>;
export type SearchFormData = z.infer<typeof searchFormSchema>;
