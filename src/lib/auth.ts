/**
 * API utilities for Void Chat
 *
 * Ephemeral identity model: there is no user authentication. These helpers
 * cover the things HTTP routes still need — CORS, IP-keyed rate limiting,
 * response shaping, input sanitization. File name kept as `auth.ts` only
 * to avoid churning imports.
 */

import { NextRequest } from 'next/server';

// =============================================================================
// RATE LIMITING (IP-keyed, in-memory)
// =============================================================================

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(key: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || record.resetTime < now) {
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) };
  }

  record.count++;
  return { allowed: true };
}

export function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

export function sanitizeInput(input: string, maxLength = 1000): string {
  return input.replace(/\0/g, '').trim().slice(0, maxLength);
}

export function validatePagination(
  page?: string | null,
  limit?: string | null
): { page: number; limit: number; skip: number } {
  const parsedPage = Math.max(1, parseInt(page || '1', 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
  return { page: parsedPage, limit: parsedLimit, skip: (parsedPage - 1) * parsedLimit };
}

// =============================================================================
// CORS (origin allowlist)
// =============================================================================

const ALLOWED_ORIGINS: string[] = (
  process.env.ALLOWED_ORIGINS ||
  'http://localhost:1420,http://localhost:3000,http://localhost:5173,tauri://localhost,https://tauri.localhost'
).split(',').map(o => o.trim()).filter(Boolean);

function isAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

export function getCORSHeaders(requestOrigin: string | null): Record<string, string> {
  const allowedOrigin = isAllowedOrigin(requestOrigin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

export const CORS_HEADERS = getCORSHeaders(ALLOWED_ORIGINS[0] || null);

export function createCORSResponse(methods?: string[], requestOrigin?: string | null): Response {
  const headers = getCORSHeaders(requestOrigin ?? null);
  if (methods) {
    headers['Access-Control-Allow-Methods'] = [...methods, 'OPTIONS'].join(', ');
  }
  return new Response(null, { status: 204, headers });
}

export async function OPTIONS(req?: Request): Promise<Response> {
  const origin = req?.headers?.get?.('origin') ?? null;
  return createCORSResponse(undefined, origin);
}

// =============================================================================
// RESPONSE HELPERS
// =============================================================================

function sanitizeErrorMessage(error: string): string {
  let sanitized = error.replace(/\/[^\s]+\//g, '[path]');
  sanitized = sanitized.replace(/at\s+.*\s+\([^)]+\)/g, '');
  sanitized = sanitized.replace(/prisma.*error/gi, 'database error');
  if (sanitized.length > 200) sanitized = sanitized.substring(0, 197) + '...';
  return sanitized.trim();
}

export function createErrorResponse(
  error: string,
  statusCode: number = 400,
  details?: Record<string, string>
): Response {
  const sanitizedError = process.env.NODE_ENV === 'production'
    ? sanitizeErrorMessage(error)
    : error;
  return Response.json({ error: sanitizedError, code: statusCode.toString(), details }, { status: statusCode });
}

export function createSuccessResponse<T>(data: T, statusCode: number = 200): Response {
  return Response.json(data, { status: statusCode });
}
