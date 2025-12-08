/**
 * /api/attachments
 * File attachment upload endpoint
 *
 * POST: Upload an encrypted file attachment
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateRequest,
  createErrorResponse,
  createSuccessResponse,
  OPTIONS,
} from '@/lib/auth';
import { validateFileBuffer, getFileExtension, MAX_FILE_SIZE } from '@/lib/fileEncryption';
import { scanFileAsync, ScanResult } from '@/lib/malwareScanner';
import type { UploadAttachmentResponse } from '@/types/api';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export { OPTIONS };

// Upload directory (should be outside web root)
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/var/clawed/uploads';

// Rate limit: max uploads per user per hour
const MAX_UPLOADS_PER_HOUR = 50;
const uploadCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * Check upload rate limit
 */
function checkUploadRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = uploadCounts.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    uploadCounts.set(userId, { count: 1, resetAt: now + 3600000 });
    return true;
  }

  if (userLimit.count >= MAX_UPLOADS_PER_HOUR) {
    return false;
  }

  userLimit.count++;
  return true;
}

/**
 * Sanitize file extension to prevent path traversal
 */
function sanitizeExtension(extension: string): string {
  // Remove any path separators and parent directory references
  return extension
    .replace(/[\/\\]/g, '')
    .replace(/\.\./g, '')
    .replace(/^\.+/, '')
    .toLowerCase()
    .slice(0, 10); // Limit length
}

/**
 * Generate a secure storage path
 * Uses date-based directories and random filenames
 */
function generateStoragePath(extension: string): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  // Sanitize extension to prevent path traversal
  const safeExtension = sanitizeExtension(extension);

  // Validate extension contains only alphanumeric and common safe chars
  if (!/^[a-z0-9]+$/.test(safeExtension)) {
    throw new Error('Invalid file extension');
  }

  const randomName = crypto.randomBytes(16).toString('hex');
  const filename = `${randomName}.${safeExtension}.enc`;

  return path.join(String(year), month, day, filename);
}

/**
 * Update attachment scan status in database
 */
async function updateScanStatus(
  attachmentId: string,
  status: 'CLEAN' | 'QUARANTINED' | 'ERROR',
  result: ScanResult,
  quarantineReason?: string
): Promise<void> {
  await prisma.attachment.update({
    where: { id: attachmentId },
    data: {
      scanStatus: status,
      scanResult: result as object,
      scannedAt: new Date(),
      quarantineReason,
    },
  });
}

/**
 * POST /api/attachments
 * Upload an encrypted file
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return createErrorResponse(
        authResult.error || 'Authentication failed',
        authResult.statusCode || 401
      );
    }

    const user = authResult.user;

    // Check rate limit
    if (!checkUploadRateLimit(user.id)) {
      return createErrorResponse('Upload rate limit exceeded. Please try again later.', 429);
    }

    // Parse multipart form data
    const formData = await req.formData();

    const file = formData.get('file') as File | null;
    const fileName = formData.get('fileName') as string | null;
    const fileType = formData.get('fileType') as string | null;
    const nonce = formData.get('nonce') as string | null;
    const messageId = formData.get('messageId') as string | null;

    // Validate required fields
    if (!file) {
      return createErrorResponse('File is required', 400);
    }
    if (!fileName) {
      return createErrorResponse('fileName is required', 400);
    }
    if (!fileType) {
      return createErrorResponse('fileType is required', 400);
    }
    if (!nonce) {
      return createErrorResponse('nonce is required', 400);
    }

    // Get file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate file
    const validation = validateFileBuffer(buffer, fileType, buffer.length);
    if (!validation.valid) {
      return createErrorResponse(validation.error || 'Invalid file', 400);
    }

    // Additional size check
    if (buffer.length > MAX_FILE_SIZE * 1.5) {
      // Allow some overhead for encryption
      return createErrorResponse(`File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`, 400);
    }

    // Get file extension
    const extension = getFileExtension(fileName);
    if (!extension) {
      return createErrorResponse('Invalid file name', 400);
    }

    // Validate file name doesn't contain path traversal attempts
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return createErrorResponse('Invalid file name format', 400);
    }

    // Generate storage path
    let storagePath: string;
    try {
      storagePath = generateStoragePath(extension);
    } catch {
      return createErrorResponse('Invalid file extension', 400);
    }

    const fullPath = path.join(UPLOAD_DIR, storagePath);

    // Security check: Ensure resolved path is still within UPLOAD_DIR
    const resolvedPath = path.resolve(fullPath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);

    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      console.error('[API] Path traversal attempt detected in upload');
      return createErrorResponse('Invalid file path', 403);
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write encrypted file to storage
    await fs.writeFile(fullPath, buffer);

    // Create attachment record
    const attachment = await prisma.attachment.create({
      data: {
        uploaderId: user.id,
        messageId: messageId || null,
        fileName,
        fileType,
        fileSize: buffer.length,
        fileExtension: extension,
        storagePath,
        encryptionNonce: nonce,
        scanStatus: 'SCANNING',
      },
    });

    // Start async malware scan
    // In production, this should be handled by a job queue
    scanFileAsync(attachment.id, buffer, updateScanStatus).catch((error) => {
      console.error('[Attachments] Scan failed:', error);
    });

    // Build response
    const response: UploadAttachmentResponse = {
      attachmentId: attachment.id,
      scanStatus: 'SCANNING',
      estimatedScanTime: 10, // seconds
    };

    return createSuccessResponse(response, 201);
  } catch (error) {
    console.error('[API] POST /attachments error:', error);

    if (error instanceof Error && error.message.includes('FormData')) {
      return createErrorResponse('Invalid form data', 400);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
