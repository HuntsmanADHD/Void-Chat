/**
 * /api/attachments/[id]
 * Individual attachment operations
 *
 * GET: Download an attachment
 * DELETE: Remove an attachment (uploader only)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  createErrorResponse,
  OPTIONS,
} from '@/lib/auth';
import fs from 'fs/promises';
import path from 'path';

export { OPTIONS };

// Upload directory
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/var/clawed/uploads';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/attachments/[id]
 * Download an attachment (streaming)
 */
export async function GET(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: attachmentId } = await params;

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    // Fetch attachment with message relations
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: {
          include: {
            channel: true,
          },
        },
      },
    });

    if (!attachment) {
      return createErrorResponse('Attachment not found', 404);
    }

    // Check scan status - only allow download if clean
    if (attachment.scanStatus === 'QUARANTINED') {
      return createErrorResponse('This file has been quarantined due to detected threats', 403);
    }

    if (attachment.scanStatus === 'PENDING' || attachment.scanStatus === 'SCANNING') {
      return createErrorResponse('File scan in progress. Please try again shortly.', 202);
    }

    // Verify access - user must be:
    // 1. The uploader, OR
    // 2. A member of the channel (if channel message), OR
    // 3. The message recipient (if DM)
    const user = authResult.user;
    let hasAccess = false;

    if (attachment.uploaderId === user.id) {
      hasAccess = true;
    } else if (attachment.message) {
      if (attachment.message.isDirectMessage) {
        // DM - check if user is sender or recipient
        hasAccess =
          attachment.message.senderId === user.id ||
          attachment.message.recipientId === user.id;
      } else if (attachment.message.channelId) {
        // Channel message - check membership
        const membership = await prisma.membership.findUnique({
          where: {
            userId_communityId: {
              userId: user.id,
              communityId: attachment.message.channel?.communityId || '',
            },
          },
        });
        hasAccess = !!membership;
      }
    }

    if (!hasAccess) {
      return createErrorResponse('Access denied', 403);
    }

    // Read file from storage - with path traversal protection
    // Normalize the path and ensure it's within UPLOAD_DIR
    const normalizedStoragePath = path.normalize(attachment.storagePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(UPLOAD_DIR, normalizedStoragePath);

    // Security check: Ensure resolved path is still within UPLOAD_DIR
    const resolvedPath = path.resolve(fullPath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);

    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      console.error('[API] Path traversal attempt detected:', attachment.storagePath);
      return createErrorResponse('Invalid file path', 403);
    }

    try {
      const fileBuffer = await fs.readFile(fullPath);

      // Return file with appropriate headers
      return new Response(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileBuffer.length.toString(),
          'Content-Disposition': `attachment; filename="${attachment.fileName}"`,
          'X-Encryption-Nonce': attachment.encryptionNonce,
          'X-File-Type': attachment.fileType,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      console.error('[API] File not found on disk:', fullPath);
      return createErrorResponse('File not found on storage', 404);
    }
  } catch (error) {
    console.error('[API] GET /attachments/[id] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * DELETE /api/attachments/[id]
 * Remove an attachment (uploader only)
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id: attachmentId } = await params;

    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    // Fetch attachment
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      return createErrorResponse('Attachment not found', 404);
    }

    // Only uploader can delete
    if (attachment.uploaderId !== authResult.user.id) {
      return createErrorResponse('Only the uploader can delete this attachment', 403);
    }

    // Delete file from storage - with path traversal protection
    const normalizedStoragePath = path.normalize(attachment.storagePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(UPLOAD_DIR, normalizedStoragePath);

    // Security check: Ensure resolved path is still within UPLOAD_DIR
    const resolvedPath = path.resolve(fullPath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);

    if (resolvedPath.startsWith(resolvedUploadDir)) {
      try {
        await fs.unlink(fullPath);
      } catch {
        console.warn('[API] Could not delete file from disk:', fullPath);
        // Continue with database deletion even if file is missing
      }
    } else {
      console.error('[API] Path traversal attempt detected during delete:', attachment.storagePath);
    }

    // Delete thumbnail if exists
    if (attachment.thumbnailPath) {
      const normalizedThumbPath = path.normalize(attachment.thumbnailPath).replace(/^(\.\.(\/|\\|$))+/, '');
      const thumbPath = path.join(UPLOAD_DIR, normalizedThumbPath);
      const resolvedThumbPath = path.resolve(thumbPath);

      if (resolvedThumbPath.startsWith(resolvedUploadDir)) {
        try {
          await fs.unlink(thumbPath);
        } catch {
          // Ignore thumbnail deletion errors
        }
      }
    }

    // Delete from database
    await prisma.attachment.delete({
      where: { id: attachmentId },
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[API] DELETE /attachments/[id] error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
