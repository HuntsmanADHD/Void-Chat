/**
 * /api/channels/[id]/messages
 * Channel message operations
 *
 * GET: Get messages (paginated)
 * POST: Send message (encrypted content)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isCommunityMember,
  validatePagination,
  createErrorResponse,
  createSuccessResponse,
  isValidBase64,
  OPTIONS,
} from '@/lib/auth';

// Re-export OPTIONS for CORS preflight
export { OPTIONS };
import type { MessageResponse, MessageListResponse, SendMessageRequest } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/channels/[id]/messages
 * Get channel messages with pagination
 */
export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: channelId } = await params;
    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit')
    );

    // Optional: cursor-based pagination for real-time scenarios
    const cursor = searchParams.get('cursor');
    const before = searchParams.get('before'); // Get messages before this timestamp

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Verify channel exists and get community
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        community: {
          select: { id: true, isPublic: true },
        },
      },
    });

    if (!channel) {
      return createErrorResponse('Channel not found', 404);
    }

    // Verify user is a member of the community
    const isMember = await isCommunityMember(user.id, channel.community.id);
    if (!isMember) {
      return createErrorResponse('Must be a community member to view messages', 403);
    }

    // Build query
    const whereClause: {
      channelId: string;
      isDirectMessage: boolean;
      createdAt?: { lt: Date };
      id?: { lt: string };
    } = {
      channelId,
      isDirectMessage: false,
    };

    // Handle cursor-based pagination
    if (cursor) {
      whereClause.id = { lt: cursor };
    }

    // Handle before timestamp
    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        whereClause.createdAt = { lt: beforeDate };
      }
    }

    // Fetch messages with sender info
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: whereClause,
        include: {
          sender: {
            select: {
              walletAddress: true,
              xHandle: true,
              publicKey: true,
              isBlacklisted: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: cursor ? 0 : skip,
        take: limit,
      }),
      prisma.message.count({
        where: {
          channelId,
          isDirectMessage: false,
        },
      }),
    ]);

    // Build response - newest first, client can reverse if needed
    // Note: No internal IDs exposed
    const response: MessageListResponse = {
      messages: messages.map((m) => ({
        id: m.id,
        encryptedContent: m.encryptedContent,
        nonce: m.nonce,
        senderWallet: m.sender.walletAddress,
        senderXHandle: m.sender.xHandle,
        senderPublicKey: m.sender.publicKey,
        channelId: m.channelId,
        recipientWallet: null, // Channel messages don't have recipients
        isDirectMessage: m.isDirectMessage,
        createdAt: m.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      hasMore: cursor ? messages.length === limit : skip + messages.length < total,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /channels/[id]/messages error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * POST /api/channels/[id]/messages
 * Send a message to a channel
 */
export async function POST(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: channelId } = await params;

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Verify channel exists and get community
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        community: {
          select: { id: true, minTokenBalance: true },
        },
      },
    });

    if (!channel) {
      return createErrorResponse('Channel not found', 404);
    }

    // Verify user is a member of the community
    const membership = await prisma.membership.findUnique({
      where: {
        userId_communityId: {
          userId: user.id,
          communityId: channel.community.id,
        },
      },
    });

    if (!membership) {
      return createErrorResponse('Must be a community member to send messages', 403);
    }

    // Parse request body
    const body = await req.json() as SendMessageRequest;
    const { encryptedContent, nonce } = body;

    // Validate required fields
    if (!encryptedContent || !nonce) {
      return createErrorResponse('Missing required fields: encryptedContent, nonce', 400);
    }

    // Validate content is base64 encoded
    if (!isValidBase64(encryptedContent) || !isValidBase64(nonce)) {
      return createErrorResponse('encryptedContent and nonce must be valid base64 encoded strings', 400);
    }

    // Limit message size (encrypted content should not exceed ~64KB)
    if (encryptedContent.length > 65536) {
      return createErrorResponse('Message content exceeds maximum size', 400);
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        encryptedContent,
        nonce,
        senderId: user.id,
        channelId,
        isDirectMessage: false,
      },
      include: {
        sender: {
          select: {
            walletAddress: true,
            xHandle: true,
            publicKey: true,
          },
        },
      },
    });

    // Build response - no internal IDs exposed
    const response: MessageResponse = {
      id: message.id,
      encryptedContent: message.encryptedContent,
      nonce: message.nonce,
      senderWallet: message.sender.walletAddress,
      senderXHandle: message.sender.xHandle,
      senderPublicKey: message.sender.publicKey,
      channelId: message.channelId,
      recipientWallet: null,
      isDirectMessage: message.isDirectMessage,
      createdAt: message.createdAt.toISOString(),
    };

    console.log('[API] POST /channels/[id]/messages - Sending response:', response);
    return createSuccessResponse(response, 201);
  } catch (error) {
    console.error('[API] POST /channels/[id]/messages error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}

