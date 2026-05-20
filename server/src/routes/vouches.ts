import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { authenticateRequest, sendError, sendSuccess } from '../lib/auth.js';

const router = Router({ mergeParams: true });

// POST /api/communities/:communityId/vouches — vouch for a user
router.post('/', async (req: Request, res: Response) => {
  const communityId = req.params.communityId;

  // Authenticate request using standard auth (token or signature)
  const authResult = await authenticateRequest(req);
  if (!authResult.success || !authResult.user) {
    return sendError(res, authResult.error || 'Authentication required', authResult.statusCode || 401);
  }

  const publicId = authResult.user.publicId;
  const { vouchedPublicId, signature } = req.body;

  if (!vouchedPublicId || !signature) {
    return sendError(res, 'Missing required fields', 400);
  }

  // Prevent self-vouching
  if (publicId === vouchedPublicId) {
    return sendError(res, 'Cannot vouch for yourself', 400);
  }

  try {
    // Verify voucher is a member
    const voucher = await prisma.user.findUnique({
      where: { publicId },
      include: { memberships: { where: { communityId } } },
    });

    if (!voucher || voucher.memberships.length === 0) {
      return sendError(res, 'You must be a community member to vouch', 403);
    }

    // Verify vouched user exists
    const vouched = await prisma.user.findUnique({
      where: { publicId: vouchedPublicId },
    });

    if (!vouched) {
      return sendError(res, 'User not found', 404);
    }

    // Verify cryptographic signature
    // Message format: "VOUCH:{voucherPublicId}:{vouchedPublicId}:{communityId}"
    const message = `VOUCH:${publicId}:${vouchedPublicId}:${communityId}`;
    let valid = false;
    try {
      const messageBytes = new TextEncoder().encode(message);
      const sigBytes = Buffer.from(signature, 'base64');
      const pubKeyBytes = bs58.decode(voucher.publicKey);
      valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
    } catch (error) {
      return sendError(res, 'Invalid signature format', 400);
    }
    if (!valid) {
      return sendError(res, 'Invalid signature', 400);
    }

    // Create vouch
    const vouch = await prisma.vouch.create({
      data: {
        voucherId: voucher.id,
        vouchedId: vouched.id,
        communityId,
        signature,
      },
    });

    return res.json({ success: true, vouch: { id: vouch.id, createdAt: vouch.createdAt } });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return sendError(res, 'You have already vouched for this user', 409);
    }
    console.error('[Vouches] Error:', error);
    return sendError(res, 'Failed to create vouch', 500);
  }
});

// GET /api/communities/:communityId/vouches/:publicId — get vouches for a user
router.get('/:publicId', async (req: Request, res: Response) => {
  const { communityId, publicId } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { publicId } });
    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    const page = Math.max(1, parseInt(req.query.page as string || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '50', 10) || 50));
    const skip = (page - 1) * limit;

    const where = { vouchedId: user.id, communityId };

    const [vouches, total] = await Promise.all([
      prisma.vouch.findMany({
        where,
        include: {
          voucher: { select: { publicId: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.vouch.count({ where }),
    ]);

    return res.json({
      publicId,
      communityId,
      total,
      page,
      limit,
      hasMore: skip + vouches.length < total,
      vouches: vouches.map(v => ({
        voucherId: v.voucher.publicId,
        signature: v.signature,
        createdAt: v.createdAt,
      })),
    });
  } catch (error) {
    console.error('[Vouches] Error:', error);
    return sendError(res, 'Failed to get vouches', 500);
  }
});

export default router;
