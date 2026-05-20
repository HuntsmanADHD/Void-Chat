/**
 * Report route: file community moderation reports
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  authenticateRequest,
  sanitizeInput,
  sendError,
  sendSuccess,
} from '../lib/auth.js';
import { createReportSchema } from '../lib/validation.js';
import { fileReport } from '../lib/moderation.js';

const router = Router();

/**
 * POST /api/reports
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const authResult = await authenticateRequest(req);
    if (!authResult.success || !authResult.user) {
      return sendError(res, authResult.error || 'Authentication failed', authResult.statusCode || 401);
    }

    const user = authResult.user;

    const validationResult = createReportSchema.safeParse(req.body);
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return sendError(res, `Validation failed: ${errors}`, 400);
    }

    const { reportedUserId, communityId, messageId: messageRef, category, description } = validationResult.data;
    const sanitizedDescription = sanitizeInput(description);

    if (reportedUserId === user.id) {
      return sendError(res, 'Cannot report yourself', 400);
    }

    const reportedUser = await prisma.user.findUnique({ where: { id: reportedUserId } });
    if (!reportedUser) {
      return sendError(res, 'Reported user not found', 404);
    }

    if (reportedUser.isBlacklisted) {
      return sendError(res, 'This user is already banned', 400);
    }

    const result = await fileReport(
      user.id,
      reportedUserId,
      communityId,
      category,
      sanitizedDescription,
      messageRef
    );

    if (!result.success) {
      return sendError(res, result.error || 'Failed to file report', 400);
    }

    return sendSuccess(res, {
      success: true,
      reported: result.data!.reported,
      userKicked: result.data!.userKicked,
      userBanned: result.data!.userBanned,
    }, 201);
  } catch (error) {
    console.error('[API] POST /reports error:', error);
    if (error instanceof SyntaxError) {
      return sendError(res, 'Invalid JSON in request body', 400);
    }
    return sendError(res, 'Internal server error', 500);
  }
});

export default router;
