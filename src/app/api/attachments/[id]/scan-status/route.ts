/**
 * /api/attachments/[id]/scan-status
 * Check the malware scan status of an attachment
 *
 * GET: Get scan status
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import type { ScanStatusResponse } from '@/types/api';

export { OPTIONS };

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/attachments/[id]/scan-status
 * Check the scan status of an attachment
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

    // Fetch attachment
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        uploaderId: true,
        scanStatus: true,
        scannedAt: true,
        quarantineReason: true,
        messageId: true,
      },
    });

    if (!attachment) {
      return createErrorResponse('Attachment not found', 404);
    }

    const user = authResult.user;

    if (attachment.uploaderId !== user.id) {
      if (!attachment.messageId) {
        return createErrorResponse('Access denied', 403);
      }

      const message = await prisma.message.findFirst({
        where: {
          id: attachment.messageId,
          OR: [
            { senderId: user.id },
            { recipientId: user.id },
            {
              channel: {
                community: {
                  memberships: {
                    some: {
                      userId: user.id,
                    },
                  },
                },
              },
            },
          ],
        },
      });

      if (!message) {
        return createErrorResponse('Access denied', 403);
      }
    }

    // Build response
    const response: ScanStatusResponse = {
      scanStatus: attachment.scanStatus,
      canDownload: attachment.scanStatus === 'CLEAN',
      quarantineReason: attachment.quarantineReason,
      scannedAt: attachment.scannedAt?.toISOString() || null,
    };

    return createSuccessResponse(response);
  } catch (error) {
    console.error('[API] GET /attachments/[id]/scan-status error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}
