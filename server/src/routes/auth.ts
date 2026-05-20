/**
 * Auth routes: register, verify, blacklist
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import bs58 from 'bs58';
import {
  isValidPublicId,
  generateAuthToken,
  checkRateLimit,
  verifySignature,
  validateAuthMessage,
  checkBlacklistStatus,
  sendError,
  sendSuccess,
} from '../lib/auth.js';

const router = Router();

/**
 * POST /api/auth/register
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { publicId, publicKey, artHash, signature, message } = req.body;

    if (!publicId || !publicKey || !artHash || !signature || !message) {
      return sendError(res, 'Missing required fields: publicId, publicKey, artHash, signature, message', 400);
    }

    if (!isValidPublicId(publicId)) {
      return sendError(res, 'Public ID must be 3-32 characters, alphanumeric with _ and - only', 400);
    }

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateLimit = checkRateLimit(`register:${clientIp}`);
    if (!rateLimit.allowed) {
      return sendError(res, `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`, 429);
    }

    if (!/^[a-f0-9]{64}$/i.test(artHash)) {
      return sendError(res, 'Invalid art hash format. Expected SHA-256 hex string.', 400);
    }

    if (publicKey.length < 20 || publicKey.length > 200) {
      return sendError(res, 'Invalid public key format', 400);
    }

    // --- H-1 FIX: Verify proof of key ownership ---
    // The client must sign "register:<publicId>:<timestamp>" with their private key.
    const registerMsgRegex = /^register:([a-zA-Z0-9_-]+):(\d+)$/;
    const msgMatch = message.match(registerMsgRegex);
    if (!msgMatch) {
      return sendError(res, 'Invalid registration message format. Expected "register:<publicId>:<timestamp>"', 400);
    }

    const [, msgPublicId, msgTimestamp] = msgMatch;
    if (msgPublicId !== publicId) {
      return sendError(res, 'Registration message publicId does not match', 400);
    }

    const timestamp = parseInt(msgTimestamp, 10);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (isNaN(timestamp) || Math.abs(now - timestamp) >= fiveMinutes) {
      return sendError(res, 'Registration message has expired. Please try again.', 400);
    }

    let publicKeyBytes: Uint8Array;
    try {
      publicKeyBytes = bs58.decode(publicKey);
      if (publicKeyBytes.length !== 32) {
        return sendError(res, 'Invalid public key length', 400);
      }
    } catch {
      return sendError(res, 'Invalid public key format', 400);
    }

    let signatureBytes: Uint8Array;
    try {
      signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
      if (signatureBytes.length !== 64) {
        return sendError(res, 'Invalid signature length', 400);
      }
    } catch {
      return sendError(res, 'Invalid signature format', 400);
    }

    if (!verifySignature(message, signatureBytes, publicKeyBytes)) {
      return sendError(res, 'Signature verification failed. You must prove ownership of the private key.', 401);
    }
    // --- END H-1 FIX ---

    const existingById = await prisma.user.findUnique({ where: { publicId } });
    if (existingById) {
      return sendError(res, 'This public ID is already taken. Choose another.', 409);
    }

    const existingByKey = await prisma.user.findUnique({ where: { publicKey } });
    if (existingByKey) {
      return sendError(res, 'This key has already been used to create an account. One identity per lifetime.', 409);
    }

    const user = await prisma.user.create({
      data: { publicId, publicKey, artHash },
    });

    const token = generateAuthToken(user.id, publicId);

    return sendSuccess(res, {
      success: true,
      token,
      user: {
        publicId: user.publicId,
        publicKey: user.publicKey,
        artHash: user.artHash,
      },
    }, 201);
  } catch (error) {
    console.error('[API] /auth/register error:', error);
    if (error instanceof SyntaxError) {
      return sendError(res, 'Invalid JSON in request body', 400);
    }
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/auth/verify
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { publicKey, signature, message } = req.body;

    if (!publicKey || !signature || !message) {
      return sendError(res, 'Missing required fields: publicKey, signature, message', 400);
    }

    const rateLimit = checkRateLimit(`verify:${publicKey}`);
    if (!rateLimit.allowed) {
      return sendError(res, `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`, 429);
    }

    if (!validateAuthMessage(message)) {
      return sendError(res, 'Invalid or expired authentication message. Please try again.', 401);
    }

    let publicKeyBytes: Uint8Array;
    try {
      publicKeyBytes = bs58.decode(publicKey);
      if (publicKeyBytes.length !== 32) {
        return sendError(res, 'Invalid public key length', 400);
      }
    } catch {
      return sendError(res, 'Invalid public key format', 400);
    }

    let signatureBytes: Uint8Array;
    try {
      signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
      if (signatureBytes.length !== 64) {
        return sendError(res, 'Invalid signature length', 400);
      }
    } catch {
      return sendError(res, 'Invalid signature format', 400);
    }

    if (!verifySignature(message, signatureBytes, publicKeyBytes)) {
      return sendError(res, 'Invalid signature', 401);
    }

    const user = await prisma.user.findUnique({ where: { publicKey } });
    if (!user) {
      return sendError(res, 'Account not found. Please create an account first.', 404);
    }

    if (user.isBlacklisted) {
      return sendError(res, 'This account has been permanently banned from Void Chat', 403);
    }

    const token = generateAuthToken(user.id, user.publicId);

    return sendSuccess(res, {
      success: true,
      token,
      user: {
        publicId: user.publicId,
        publicKey: user.publicKey,
        artHash: user.artHash,
      },
    });
  } catch (error) {
    console.error('[API] /auth/verify error:', error);
    if (error instanceof SyntaxError) {
      return sendError(res, 'Invalid JSON in request body', 400);
    }
    return sendError(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/auth/blacklist?id=PUBLIC_ID
 */
router.get('/blacklist', async (req: Request, res: Response) => {
  try {
    const publicId = req.query.id as string;

    if (!publicId) {
      return sendError(res, 'Missing required query parameter: id', 400);
    }

    if (!isValidPublicId(publicId)) {
      return sendError(res, 'Invalid public ID format', 400);
    }

    const rateLimit = checkRateLimit(publicId);
    if (!rateLimit.allowed) {
      return sendError(res, `Rate limit exceeded. Retry after ${rateLimit.retryAfter} seconds`, 429);
    }

    const status = await checkBlacklistStatus(publicId);

    return sendSuccess(res, { isBlacklisted: status.isBlacklisted });
  } catch (error) {
    console.error('[API] /auth/blacklist error:', error);
    return sendError(res, 'Internal server error', 500);
  }
});

export default router;
