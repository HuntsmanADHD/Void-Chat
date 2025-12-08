/**
 * /api/dm/[wallet]
 * Direct message operations
 *
 * GET: Get DMs with a user (paginated)
 * POST: Send DM (encrypted)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  isValidSolanaAddress,
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
  params: Promise<{ wallet: string }>;
}

/**
 * GET /api/dm/[wallet]
 * Get direct messages with a specific user
 */
export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { wallet: recipientWallet } = await params;
    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit')
    );

    // Optional cursor for real-time loading
    const cursor = searchParams.get('cursor');
    const before = searchParams.get('before');

    // Validate recipient wallet
    if (!isValidSolanaAddress(recipientWallet)) {
      return createErrorResponse('Invalid wallet address format', 400);
    }

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Find the recipient user
    const recipient = await prisma.user.findUnique({
      where: { walletAddress: recipientWallet },
      select: {
        id: true,
        isBlacklisted: true,
      },
    });

    if (!recipient) {
      return createErrorResponse('Recipient user not found', 404);
    }

    // Check if recipient is blacklisted
    if (recipient.isBlacklisted) {
      return createErrorResponse('Cannot message a banned user', 403);
    }

    // Build query - get messages between the two users in both directions
    interface MessageWhereClause {
      isDirectMessage: boolean;
      OR: Array<{
        senderId: string;
        recipientId: string;
      }>;
      createdAt?: { lt: Date };
      id?: { lt: string };
    }

    const whereClause: MessageWhereClause = {
      isDirectMessage: true,
      OR: [
        { senderId: user.id, recipientId: recipient.id },
        { senderId: recipient.id, recipientId: user.id },
      ],
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

    // Fetch messages with sender and recipient info
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: whereClause,
        include: {
          sender: {
            select: {
              walletAddress: true,
              xHandle: true,
              publicKey: true,
            },
          },
          recipient: {
            select: {
              walletAddress: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: cursor ? 0 : skip,
        take: limit,
      }),
      prisma.message.count({
        where: {
          isDirectMessage: true,
          OR: [
            { senderId: user.id, recipientId: recipient.id },
            { senderId: recipient.id, recipientId: user.id },
          ],
        },
      }),
    ]);

    // Build response - no internal IDs exposed
    const response: MessageListResponse = {
      messages: messages.map((m) => ({
        id: m.id,
        encryptedContent: m.encryptedContent,
        nonce: m.nonce,
        senderWallet: m.sender.walletAddress,
        senderXHandle: m.sender.xHandle,
        senderPublicKey: m.sender.publicKey,
        channelId: m.channelId,
        recipientWallet: m.recipient?.walletAddress ?? null,
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
    console.error('[API] GET /dm/[wallet] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * POST /api/dm/[wallet]
 * Send a direct message to a user
 */
export async function POST(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { wallet: recipientWallet } = await params;

    // Validate recipient wallet
    if (!isValidSolanaAddress(recipientWallet)) {
      return createErrorResponse('Invalid wallet address format', 400);
    }

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Cannot send DM to yourself
    if (user.walletAddress === recipientWallet) {
      return createErrorResponse('Cannot send DM to yourself', 400);
    }

    // Find the recipient user
    const recipient = await prisma.user.findUnique({
      where: { walletAddress: recipientWallet },
      select: {
        id: true,
        isBlacklisted: true,
        timeoutUntil: true,
      },
    });

    if (!recipient) {
      return createErrorResponse('Recipient user not found', 404);
    }

    // Check if recipient is blacklisted
    if (recipient.isBlacklisted) {
      return createErrorResponse('Cannot message a banned user', 403);
    }

    // Check if recipient is in timeout (they can still receive messages but not send)
    // This check is for sender - we already checked their status in auth

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

    // Limit message size
    if (encryptedContent.length > 65536) {
      return createErrorResponse('Message content exceeds maximum size', 400);
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        encryptedContent,
        nonce,
        senderId: user.id,
        recipientId: recipient.id,
        isDirectMessage: true,
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
      recipientWallet: recipientWallet,
      isDirectMessage: message.isDirectMessage,
      createdAt: message.createdAt.toISOString(),
    };

    return createSuccessResponse(response, 201);
  } catch (error) {
    console.error('[API] POST /dm/[wallet] error:', error);

    if (error instanceof SyntaxError) {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}

