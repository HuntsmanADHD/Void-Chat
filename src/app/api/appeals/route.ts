/**
 * Appeals API Routes - DEPRECATED
 *
 * The appeals system has been removed as part of the transition to
 * community-driven moderation. There are no strikes to appeal.
 * Moderation is now handled by community consensus reports.
 */

import { NextRequest } from 'next/server';
import {
  createErrorResponse,
  OPTIONS,
} from '@/lib/auth';

export { OPTIONS };

export async function POST(_req: NextRequest): Promise<Response> {
  return createErrorResponse(
    'The appeals system has been removed. Moderation is now community-driven.',
    410
  );
}

export async function GET(_req: NextRequest): Promise<Response> {
  return createErrorResponse(
    'The appeals system has been removed. Moderation is now community-driven.',
    410
  );
}
