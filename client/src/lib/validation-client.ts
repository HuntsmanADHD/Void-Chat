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

export const createCommunityFormSchema = z.object({
  name: communityNameSchema,
  description: communityDescriptionSchema,
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
  communityId: z.string().cuid('Invalid community ID'),
  messageId: z.string().cuid('Invalid message ID').optional(),
  category: reportCategorySchema,
  description: reportDescriptionSchema,
});

export const searchQuerySchema = z
  .string()
  .min(2, 'Search query must be at least 2 characters')
  .max(100, 'Search query must be 100 characters or less');

export const searchFormSchema = z.object({
  query: searchQuerySchema,
  type: z.enum(['all', 'communities', 'users', 'messages']).optional(),
});

export const publicIdSchema = z
  .string()
  .min(3, 'Public ID must be at least 3 characters')
  .max(32, 'Public ID must be 32 characters or less')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Public ID can only contain letters, numbers, underscores, and hyphens');

export type CreateCommunityFormData = z.infer<typeof createCommunityFormSchema>;
export type CreateChannelFormData = z.infer<typeof createChannelFormSchema>;
export type SendMessageFormData = z.infer<typeof sendMessageFormSchema>;
export type CreateReportFormData = z.infer<typeof createReportFormSchema>;
export type SearchFormData = z.infer<typeof searchFormSchema>;
