/**
 * User routes: profile, public key
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  authenticateRequest,
  isValidPublicId,
  isValidPublicKey,
  checkRateLimit,
  sendError,
  sendSuccess,
} from '../lib/auth.js';

const router = Router();

/**
 * POST /api/users/public-keys
 * Batch fetch public keys for multiple users (no auth required)
 */
router.post('/public-keys', async (req: Request, res: Response) => {
  try {
    // Rate limit by IP to prevent user enumeration
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateLimit = checkRateLimit(`public-keys:${clientIp}`);
    if (!rateLimit.allowed) {
      return sendError(res, `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`, 429);
    }

    const { publicIds } = req.body;

    if (!Array.isArray(publicIds) || publicIds.length === 0) {
      return sendError(res, 'publicIds must be a non-empty array', 400);
    }

    if (publicIds.length > 100) {
      return sendError(res, 'Maximum 100 public IDs per request', 400);
    }

    for (const id of publicIds) {
      if (!isValidPublicId(id)) {
        return sendError(res, `Invalid public ID format: ${id}`, 400);
      }
    }

    const users = await prisma.user.findMany({
      where: {
        publicId: { in: publicIds },
        isBlacklisted: false,
      },
      select: { publicId: true, publicKey: true },
    });

    return sendSuccess(res, users);
  } catch (error) {
    console.error('[API] POST /users/public-keys error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/users/:publicId
 */
router.get('/:publicId', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;

    if (!isValidPublicId(publicId)) {
      return sendError(res, 'Invalid public ID format', 400);
    }

    const rateLimit = checkRateLimit(publicId);
    if (!rateLimit.allowed) {
      return sendError(res, `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`, 429);
    }

    const user = await prisma.user.findUnique({ where: { publicId } });
    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    return sendSuccess(res, {
      publicId: user.publicId,
      publicKey: user.publicKey,
      artHash: user.artHash,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] GET /users/:publicId error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * PUT /api/users/:publicId
 */
router.put('/:publicId', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;

    if (!isValidPublicId(publicId)) {
      return sendError(res, 'Invalid public ID format', 400);
    }

    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication failed', authResult.statusCode || 401);
    }

    if (authResult.user.publicId !== publicId) {
      return sendError(res, "Cannot update another user's profile", 403);
    }

    const { publicKey } = req.body;
    const updates: { publicKey?: string } = {};

    if (publicKey !== undefined) {
      if (!isValidPublicKey(publicKey)) {
        return sendError(res, 'Invalid encryption public key format', 400);
      }
      updates.publicKey = publicKey;
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, 'No valid fields to update', 400);
    }

    const updatedUser = await prisma.user.update({
      where: { publicId },
      data: { ...updates, updatedAt: new Date() },
    });

    return sendSuccess(res, {
      publicId: updatedUser.publicId,
      publicKey: updatedUser.publicKey,
      artHash: updatedUser.artHash,
      createdAt: updatedUser.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[API] PUT /users/:publicId error:', error);
    if (error instanceof SyntaxError) {
      return sendError(res, 'Invalid JSON in request body', 400);
    }
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/users/:publicId/public-key
 */
router.get('/:publicId/public-key', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;

    if (!isValidPublicId(publicId)) {
      return sendError(res, 'Invalid public ID format', 400);
    }

    const rateLimit = checkRateLimit(publicId);
    if (!rateLimit.allowed) {
      return sendError(res, `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`, 429);
    }

    const user = await prisma.user.findUnique({
      where: { publicId },
      select: { publicId: true, publicKey: true, isBlacklisted: true },
    });

    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    if (user.isBlacklisted) {
      return sendError(res, 'This user has been banned', 403);
    }

    return sendSuccess(res, {
      publicId: user.publicId,
      publicKey: user.publicKey,
    });
  } catch (error) {
    console.error('[API] GET /users/:publicId/public-key error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

export default router;
