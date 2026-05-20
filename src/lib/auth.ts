/**
 * Authentication Utilities for Void Chat API Routes
 * Handles NaCl signature verification, session management, and authorization
 */

import { NextRequest } from 'next/server';
import nacl from 'tweetnacl';
import crypto from 'crypto';
import { prisma } from './prisma';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * JWT-like token structure (simplified for identity-based auth)
 * In production, consider using proper JWT with refresh tokens
 */
function getTokenSecret(): string {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    throw new Error('AUTH_TOKEN_SECRET environment variable is required');
  }
  if (secret.length < 32) {
    throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters');
  }
  return secret;
}
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Rate limiting configuration
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// =============================================================================
// TYPES
// =============================================================================

export interface AuthenticatedUser {
  id: string;
  publicId: string;
  publicKey: string;
  isBlacklisted: boolean;
}

export interface AuthResult {
  success: boolean;
  user?: AuthenticatedUser;
  error?: string;
  statusCode?: number;
}

export interface TokenPayload {
  publicId: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

// =============================================================================
// TOKEN GENERATION & VERIFICATION
// =============================================================================

/**
 * Generate a secure authentication token using HMAC-SHA256
 */
export function generateAuthToken(userId: string, publicId: string): string {
  const payload: TokenPayload = {
    userId,
    publicId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_EXPIRY_MS,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64url');

  // Create proper HMAC-SHA256 signature
  const hmac = crypto.createHmac('sha256', getTokenSecret());
  hmac.update(payloadBase64);
  const signature = hmac.digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * Constant-time string comparison to prevent timing attacks
 * Compares two strings in constant time regardless of where they differ
 * Does NOT leak length information through early returns
 */
function constantTimeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  // Start with length comparison result (0 if equal, 1 if different)
  let result = a.length === b.length ? 0 : 1;

  // Compare all characters up to max length
  for (let i = 0; i < maxLen; i++) {
    // Use 0 for out-of-bounds access to maintain constant time
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

/**
 * Verify and decode an authentication token
 * Uses HMAC-SHA256 and constant-time comparison to prevent timing attacks
 */
export function verifyAuthToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [payloadBase64, providedSignature] = parts;

    // Generate expected signature using HMAC-SHA256
    const hmac = crypto.createHmac('sha256', getTokenSecret());
    hmac.update(payloadBase64);
    const expectedSignature = hmac.digest('base64url');

    // Use constant-time comparison to prevent timing attacks
    if (!constantTimeCompare(providedSignature, expectedSignature)) {
      return null;
    }

    // Decode payload (base64url)
    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as TokenPayload;

    // Check expiration
    if (payload.expiresAt < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// =============================================================================
// SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify a NaCl detached signature
 */
export function verifySignature(
  message: string,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch (error) {
    console.error('[Auth] Signature verification failed:', error);
    return false;
  }
}

/**
 * Validate the authentication message format and timestamp
 * Message format: "Void Chat Login\ntimestamp: {number}"
 * Timestamp must be within 5 minutes
 */
export function validateAuthMessage(message: string): { timestamp: number } | null {
  const prefix = 'Void Chat Login\ntimestamp: ';

  if (!message.startsWith(prefix)) {
    return null;
  }

  const timestampStr = message.slice(prefix.length).trim();
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    return null;
  }

  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  // Message must be within 5 minutes
  if (Math.abs(now - timestamp) >= fiveMinutes) {
    return null;
  }

  return { timestamp };
}

// =============================================================================
// PUBLIC ID VALIDATION
// =============================================================================

/**
 * Validate the format of a public ID
 * Alphanumeric (plus _ and -), 3-32 chars
 */
export function isValidPublicId(publicId: string): boolean {
  if (!publicId || publicId.length < 3 || publicId.length > 32) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(publicId);
}

// =============================================================================
// CSRF PROTECTION
// =============================================================================

/**
 * Allowed origins for CORS
 * In production, this should be configured via environment variable
 */
function getAllowedOrigins(): string[] {
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  if (allowedOriginsEnv) {
    return allowedOriginsEnv.split(',').map(origin => origin.trim());
  }

  // Default to same-origin in production
  if (process.env.NODE_ENV === 'production') {
    return [];
  }

  // Allow localhost in development
  return ['http://localhost:3000', 'http://localhost:3001'];
}

/**
 * Validate request origin for CSRF protection
 */
export function validateOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // For same-origin requests, no origin header is sent
  if (!origin && !referer) {
    // Allow same-origin requests
    return true;
  }

  const allowedOrigins = getAllowedOrigins();

  // If no allowed origins configured, only allow same-origin
  if (allowedOrigins.length === 0) {
    const requestUrl = new URL(req.url);
    const requestOrigin = `${requestUrl.protocol}//${requestUrl.host}`;

    if (origin && origin !== requestOrigin) {
      return false;
    }

    if (referer) {
      try {
        const refererUrl = new URL(referer);
        const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
        if (refererOrigin !== requestOrigin) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  // Check against allowed origins
  if (origin && !allowedOrigins.includes(origin)) {
    return false;
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
      if (!allowedOrigins.includes(refererOrigin)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

// =============================================================================
// REQUEST AUTHENTICATION
// =============================================================================

/**
 * Extract authentication from request headers
 * Supports both token-based and signature-based auth
 * Includes CSRF protection for state-changing operations
 */
export async function authenticateRequest(
  req: NextRequest,
  options: { skipOriginCheck?: boolean } = {}
): Promise<AuthResult> {
  // CSRF Protection: Validate origin for state-changing requests (POST, PUT, DELETE, PATCH)
  if (!options.skipOriginCheck && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (!validateOrigin(req)) {
      return {
        success: false,
        error: 'Invalid request origin',
        statusCode: 403,
      };
    }
  }

  // Check for Bearer token first
  const authHeader = req.headers.get('authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return authenticateWithToken(token);
  }

  // Fall back to signature-based auth
  const publicId = req.headers.get('x-public-id');
  const signatureHeader = req.headers.get('x-signature');
  const message = req.headers.get('x-auth-message');

  if (publicId && signatureHeader && message) {
    return authenticateWithSignature(publicId, signatureHeader, message);
  }

  return {
    success: false,
    error: 'Missing authentication credentials',
    statusCode: 401,
  };
}

/**
 * Authenticate using a session token
 */
async function authenticateWithToken(token: string): Promise<AuthResult> {
  const payload = verifyAuthToken(token);

  if (!payload) {
    return {
      success: false,
      error: 'Invalid or expired token',
      statusCode: 401,
    };
  }

  // Fetch user from database
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user) {
    return {
      success: false,
      error: 'User not found',
      statusCode: 401,
    };
  }

  // Check blacklist status
  if (user.isBlacklisted) {
    return {
      success: false,
      error: 'Account has been permanently banned',
      statusCode: 403,
    };
  }

  return {
    success: true,
    user: {
      id: user.id,
      publicId: user.publicId,
      publicKey: user.publicKey,
      isBlacklisted: user.isBlacklisted,
    },
  };
}

/**
 * Authenticate using NaCl signature
 */
async function authenticateWithSignature(
  publicId: string,
  signatureBase64: string,
  message: string
): Promise<AuthResult> {
  // Validate message format and timestamp
  if (!validateAuthMessage(message)) {
    return {
      success: false,
      error: 'Invalid or expired authentication message',
      statusCode: 401,
    };
  }

  // Fetch user to get their public key
  const user = await prisma.user.findUnique({
    where: { publicId },
  });

  if (!user) {
    return {
      success: false,
      error: 'User not registered',
      statusCode: 401,
    };
  }

  // Verify signature using the user's stored public key
  const signatureBytes = new Uint8Array(Buffer.from(signatureBase64, 'base64'));
  const publicKeyBytes = new Uint8Array(Buffer.from(user.publicKey, 'base64'));

  if (!verifySignature(message, signatureBytes, publicKeyBytes)) {
    return {
      success: false,
      error: 'Invalid signature',
      statusCode: 401,
    };
  }

  // Check blacklist status
  if (user.isBlacklisted) {
    return {
      success: false,
      error: 'Account has been permanently banned',
      statusCode: 403,
    };
  }

  return {
    success: true,
    user: {
      id: user.id,
      publicId: user.publicId,
      publicKey: user.publicKey,
      isBlacklisted: user.isBlacklisted,
    },
  };
}

// =============================================================================
// AUTHORIZATION HELPERS
// =============================================================================

/**
 * Check if user is community member
 */
export async function isCommunityMember(
  userId: string,
  communityId: string
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_communityId: {
        userId,
        communityId,
      },
    },
  });

  return !!membership;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Check rate limit for a public ID
 */
export function checkRateLimit(publicId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = publicId.toLowerCase();

  const record = rateLimitStore.get(key);

  if (!record || record.resetTime < now) {
    // New window
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.ceil((record.resetTime - now) / 1000),
    };
  }

  record.count++;
  return { allowed: true };
}

// =============================================================================
// BLACKLIST HELPERS
// =============================================================================

/**
 * Check if a user is blacklisted by publicId
 */
export async function checkBlacklistStatus(publicId: string): Promise<{
  isBlacklisted: boolean;
  canPerformActions: boolean;
}> {
  const user = await prisma.user.findUnique({
    where: { publicId },
    select: {
      isBlacklisted: true,
    },
  });

  if (!user) {
    return {
      isBlacklisted: false,
      canPerformActions: true, // New users can perform actions
    };
  }

  return {
    isBlacklisted: user.isBlacklisted,
    canPerformActions: !user.isBlacklisted,
  };
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

/**
 * Validate base64 encoded string
 * Checks for valid base64 characters and proper padding
 */
export function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) return false;

  // Base64 length must be a multiple of 4
  if (str.length % 4 !== 0) return false;

  // Check for valid base64 characters and proper padding
  // Padding can only appear at the end, max 2 = signs
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) return false;

  // Check padding is at the correct position
  const paddingIndex = str.indexOf('=');
  if (paddingIndex !== -1 && paddingIndex < str.length - 2) {
    return false;
  }

  return true;
}

/**
 * Sanitize string input for safe storage.
 *
 * Only strips null bytes and trims whitespace. HTML entity encoding should
 * happen at render time on the frontend, NOT at storage time — encoding here
 * corrupts URLs, names with apostrophes, and other legitimate data.
 */
export function sanitizeInput(input: string, maxLength = 1000): string {
  return input
    .replace(/\0/g, '')  // Remove null bytes
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate pagination parameters
 */
export function validatePagination(
  page?: string | null,
  limit?: string | null
): { page: number; limit: number; skip: number } {
  const parsedPage = Math.max(1, parseInt(page || '1', 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));

  return {
    page: parsedPage,
    limit: parsedLimit,
    skip: (parsedPage - 1) * parsedLimit,
  };
}

// =============================================================================
// ERROR RESPONSES
// =============================================================================

/**
 * Sanitize error message to prevent information disclosure
 * Removes sensitive paths, stack traces, and internal details
 */
function sanitizeErrorMessage(error: string): string {
  // Remove file system paths
  let sanitized = error.replace(/\/[^\s]+\//g, '[path]');

  // Remove stack traces
  sanitized = sanitized.replace(/at\s+.*\s+\([^)]+\)/g, '');

  // Remove database error details
  sanitized = sanitized.replace(/prisma.*error/gi, 'database error');

  // Remove specific column/table names
  sanitized = sanitized.replace(/column\s+"[^"]+"/gi, 'column');
  sanitized = sanitized.replace(/table\s+"[^"]+"/gi, 'table');

  // Truncate to reasonable length
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 197) + '...';
  }

  return sanitized.trim();
}

/**
 * Create standardized error response
 * Automatically sanitizes error messages in production
 */
export function createErrorResponse(
  error: string,
  statusCode: number = 400,
  details?: Record<string, string>
): Response {
  // In production, sanitize error messages to avoid information disclosure
  const sanitizedError = process.env.NODE_ENV === 'production'
    ? sanitizeErrorMessage(error)
    : error;

  return Response.json(
    {
      error: sanitizedError,
      code: statusCode.toString(),
      details,
    },
    { status: statusCode }
  );
}

/**
 * Create standardized success response
 */
export function createSuccessResponse<T>(data: T, statusCode: number = 200): Response {
  return Response.json(data, { status: statusCode });
}

// =============================================================================
// CORS UTILITIES
// =============================================================================

/**
 * Allowed CORS origins from environment variable.
 * Falls back to common local dev origins if not set.
 */
const ALLOWED_ORIGINS: string[] = (
  process.env.ALLOWED_ORIGINS ||
  'http://localhost:1420,http://localhost:3000,http://localhost:5173,tauri://localhost,https://tauri.localhost'
).split(',').map(o => o.trim()).filter(Boolean);

/**
 * Check if a given origin is in the allowlist.
 */
function isAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

/**
 * Build CORS headers for a specific request origin.
 * Returns the origin (if allowed) instead of wildcard '*'.
 */
export function getCORSHeaders(requestOrigin: string | null): Record<string, string> {
  const allowedOrigin = isAllowedOrigin(requestOrigin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Public-Id, X-Signature, X-Auth-Message',
    'Access-Control-Max-Age': '86400', // 24 hours
    'Vary': 'Origin',
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

/**
 * Standard CORS headers for API routes (kept for backward compat, uses first allowed origin).
 * Prefer getCORSHeaders(origin) when you have access to the request origin.
 */
export const CORS_HEADERS = getCORSHeaders(ALLOWED_ORIGINS[0] || null);

/**
 * Create CORS preflight response for OPTIONS requests
 */
export function createCORSResponse(methods?: string[], requestOrigin?: string | null): Response {
  const headers = getCORSHeaders(requestOrigin ?? null);

  if (methods) {
    headers['Access-Control-Allow-Methods'] = [...methods, 'OPTIONS'].join(', ');
  }

  return new Response(null, {
    status: 204,
    headers,
  });
}

/**
 * Pre-configured CORS OPTIONS handler
 * Can be directly exported from API routes
 */
export async function OPTIONS(req?: Request): Promise<Response> {
  const origin = req?.headers?.get?.('origin') ?? null;
  return createCORSResponse(undefined, origin);
}
