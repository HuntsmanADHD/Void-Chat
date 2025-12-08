/**
 * Message Reactions API
 *
 * POST /api/messages/[id]/reactions - Add a reaction
 * DELETE /api/messages/[id]/reactions - Remove a reaction
 * GET /api/messages/[id]/reactions - Get reactions for a message
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

// Allowed emojis for reactions
const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '👀', '🎉', '💯'];

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/messages/[id]/reactions
 * Add a reaction to a message
 *
 * Request body:
 * {
 *   emoji: string
 * }
 */
export async function POST(
  req: NextRequest,
  context: RouteContext
): Promise<Response> {
  try {
    const params = await context.params;
    const messageId = params.id;

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Parse request body
    const body = await req.json();
    const { emoji } = body;

    // Validate emoji
    if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
      return createErrorResponse('Invalid emoji', 400);
    }

    // Check if message exists
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, channelId: true, recipientId: true, senderId: true },
    });

    if (!message) {
      return createErrorResponse('Message not found', 404);
    }

    // Check if user has access to this message (is in the channel or is sender/recipient of DM)
    if (message.channelId) {
      const channel = await prisma.channel.findUnique({
        where: { id: message.channelId },
        select: { communityId: true },
      });

      if (!channel) {
        return createErrorResponse('Channel not found', 404);
      }

      // Check if user is a member of the community
      const membership = await prisma.membership.findUnique({
        where: {
          userId_communityId: {
            userId: user.id,
            communityId: channel.communityId,
          },
        },
      });

      if (!membership) {
        return createErrorResponse('Access denied', 403);
      }
    } else if (message.recipientId) {
      // DM - user must be sender or recipient
      if (message.senderId !== user.id && message.recipientId !== user.id) {
        return createErrorResponse('Access denied', 403);
      }
    }

    // Add or toggle reaction (if already exists, remove it)
    const existingReaction = await prisma.reaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: user.id,
          emoji,
        },
      },
    });

    if (existingReaction) {
      // Remove the reaction (toggle off)
      await prisma.reaction.delete({
        where: { id: existingReaction.id },
      });

      return createSuccessResponse({
        action: 'removed',
        emoji,
        messageId,
      });
    }

    // Add new reaction
    const reaction = await prisma.reaction.create({
      data: {
        messageId,
        userId: user.id,
        emoji,
      },
    });

    return createSuccessResponse({
      action: 'added',
      reactionId: reaction.id,
      emoji,
      messageId,
    }, 201);
  } catch (error) {
    console.error('[API] POST /messages/[id]/reactions error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * DELETE /api/messages/[id]/reactions
 * Remove a reaction from a message
 *
 * Query params:
 *   emoji: string
 */
export async function DELETE(
  req: NextRequest,
  context: RouteContext
): Promise<Response> {
  try {
    const params = await context.params;
    const messageId = params.id;

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Get emoji from query params
    const { searchParams } = new URL(req.url);
    const emoji = searchParams.get('emoji');

    if (!emoji) {
      return createErrorResponse('emoji query parameter is required', 400);
    }

    // Find and delete the reaction
    const reaction = await prisma.reaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: user.id,
          emoji,
        },
      },
    });

    if (!reaction) {
      return createErrorResponse('Reaction not found', 404);
    }

    await prisma.reaction.delete({
      where: { id: reaction.id },
    });

    return createSuccessResponse({
      action: 'removed',
      emoji,
      messageId,
    });
  } catch (error) {
    console.error('[API] DELETE /messages/[id]/reactions error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * GET /api/messages/[id]/reactions
 * Get all reactions for a message
 */
export async function GET(
  req: NextRequest,
  context: RouteContext
): Promise<Response> {
  try {
    const params = await context.params;
    const messageId = params.id;

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Get reactions grouped by emoji
    const reactions = await prisma.reaction.findMany({
      where: { messageId },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            xHandle: true,
          },
        },
      },
    });

    // Group reactions by emoji and count
    const reactionsByEmoji: Record<string, {
      emoji: string;
      count: number;
      hasReacted: boolean;
      users: Array<{ id: string; walletAddress: string; xHandle: string | null }>;
    }> = {};

    for (const reaction of reactions) {
      if (!reactionsByEmoji[reaction.emoji]) {
        reactionsByEmoji[reaction.emoji] = {
          emoji: reaction.emoji,
          count: 0,
          hasReacted: false,
          users: [],
        };
      }

      reactionsByEmoji[reaction.emoji].count++;
      reactionsByEmoji[reaction.emoji].users.push({
        id: reaction.user.id,
        walletAddress: reaction.user.walletAddress,
        xHandle: reaction.user.xHandle,
      });

      if (reaction.userId === user.id) {
        reactionsByEmoji[reaction.emoji].hasReacted = true;
      }
    }

    return createSuccessResponse({
      messageId,
      reactions: Object.values(reactionsByEmoji),
    });
  } catch (error) {
    console.error('[API] GET /messages/[id]/reactions error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
