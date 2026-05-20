/**
 * Authentication Utilities for Void Chat Server
 * Handles NaCl signature verification, session management, and authorization
 */

import { Request, Response } from 'express';
import nacl from 'tweetnacl';
import crypto from 'crypto';
import { prisma } from './prisma.js';

// =============================================================================
// CONSTANTS
// =============================================================================

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

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60;

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

export function generateAuthToken(userId: string, publicId: string): string {
  const payload: TokenPayload = {
    userId,
    publicId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_EXPIRY_MS,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64url');

  const hmac = crypto.createHmac('sha256', getTokenSecret());
  hmac.update(payloadBase64);
  const signature = hmac.digest('base64url');

  return `${payloadBase64}.${signature}`;
}

function constantTimeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

export function verifyAuthToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadBase64, providedSignature] = parts;

    const hmac = crypto.createHmac('sha256', getTokenSecret());
    hmac.update(payloadBase64);
    const expectedSignature = hmac.digest('base64url');

    if (!constantTimeCompare(providedSignature, expectedSignature)) return null;

    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as TokenPayload;

    if (payload.expiresAt < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

// =============================================================================
// SIGNATURE VERIFICATION
// =============================================================================

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

export function validateAuthMessage(message: string): { timestamp: number } | null {
  const prefix = 'Void Chat Login\ntimestamp: ';
  if (!message.startsWith(prefix)) return null;

  const timestampStr = message.slice(prefix.length).trim();
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return null;

  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  if (Math.abs(now - timestamp) >= fiveMinutes) return null;

  return { timestamp };
}

// =============================================================================
// PUBLIC ID VALIDATION
// =============================================================================

export function isValidPublicId(publicId: string): boolean {
  if (!publicId || publicId.length < 3 || publicId.length > 32) return false;
  return /^[a-zA-Z0-9_-]+$/.test(publicId);
}

// =============================================================================
// REQUEST AUTHENTICATION
// =============================================================================

export async function authenticateRequest(req: Request): Promise<AuthResult> {
  // Check for Bearer token first
  const authHeader = req.headers['authorization'];

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return authenticateWithToken(token);
  }

  // Fall back to signature-based auth
  const publicId = req.headers['x-public-id'] as string | undefined;
  const signatureHeader = req.headers['x-signature'] as string | undefined;
  const message = req.headers['x-auth-message'] as string | undefined;

  if (publicId && signatureHeader && message) {
    return authenticateWithSignature(publicId, signatureHeader, message);
  }

  return {
    success: false,
    error: 'Missing authentication credentials',
    statusCode: 401,
  };
}

async function authenticateWithToken(token: string): Promise<AuthResult> {
  const payload = verifyAuthToken(token);

  if (!payload) {
    return { success: false, error: 'Invalid or expired token', statusCode: 401 };
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user) {
    return { success: false, error: 'User not found', statusCode: 401 };
  }

  if (user.isBlacklisted) {
    return { success: false, error: 'Account has been permanently banned', statusCode: 403 };
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

async function authenticateWithSignature(
  publicId: string,
  signatureBase64: string,
  message: string
): Promise<AuthResult> {
  if (!validateAuthMessage(message)) {
    return { success: false, error: 'Invalid or expired authentication message', statusCode: 401 };
  }

  const user = await prisma.user.findUnique({
    where: { publicId },
  });

  if (!user) {
    return { success: false, error: 'User not registered', statusCode: 401 };
  }

  const signatureBytes = new Uint8Array(Buffer.from(signatureBase64, 'base64'));
  const publicKeyBytes = new Uint8Array(Buffer.from(user.publicKey, 'base64'));

  if (!verifySignature(message, signatureBytes, publicKeyBytes)) {
    return { success: false, error: 'Invalid signature', statusCode: 401 };
  }

  if (user.isBlacklisted) {
    return { success: false, error: 'Account has been permanently banned', statusCode: 403 };
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

export async function isCommunityMember(
  userId: string,
  communityId: string
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_communityId: { userId, communityId },
    },
  });
  return !!membership;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

export function checkRateLimit(publicId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = publicId.toLowerCase();
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

// =============================================================================
// BLACKLIST HELPERS
// =============================================================================

export async function checkBlacklistStatus(publicId: string): Promise<{
  isBlacklisted: boolean;
  canPerformActions: boolean;
}> {
  const user = await prisma.user.findUnique({
    where: { publicId },
    select: { isBlacklisted: true },
  });

  if (!user) {
    return { isBlacklisted: false, canPerformActions: true };
  }

  return {
    isBlacklisted: user.isBlacklisted,
    canPerformActions: !user.isBlacklisted,
  };
}

// =============================================================================
// INPUT VALIDATION & SANITIZATION
// =============================================================================

export function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) return false;
  if (str.length % 4 !== 0) return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) return false;
  const paddingIndex = str.indexOf('=');
  if (paddingIndex !== -1 && paddingIndex < str.length - 2) return false;
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

function sanitizeErrorMessage(error: string): string {
  let sanitized = error.replace(/\/[^\s]+\//g, '[path]');
  sanitized = sanitized.replace(/at\s+.*\s+\([^)]+\)/g, '');
  sanitized = sanitized.replace(/prisma.*error/gi, 'database error');
  sanitized = sanitized.replace(/column\s+"[^"]+"/gi, 'column');
  sanitized = sanitized.replace(/table\s+"[^"]+"/gi, 'table');
  if (sanitized.length > 200) sanitized = sanitized.substring(0, 197) + '...';
  return sanitized.trim();
}

// =============================================================================
// EXPRESS RESPONSE HELPERS
// =============================================================================

export function sendError(res: Response, error: string, statusCode: number = 400, details?: Record<string, string>): void {
  const sanitizedError = process.env.NODE_ENV === 'production'
    ? sanitizeErrorMessage(error)
    : error;

  res.status(statusCode).json({
    error: sanitizedError,
    code: statusCode.toString(),
    details,
  });
}

export function sendSuccess<T>(res: Response, data: T, statusCode: number = 200): void {
  res.status(statusCode).json(data);
}

// =============================================================================
// PUBLIC KEY VALIDATION (for encryption keys)
// =============================================================================

export function isValidPublicKey(publicKey: string): boolean {
  try {
    if (!publicKey) return false;
    const keyBytes = Buffer.from(publicKey, 'base64');
    return keyBytes.length === 32; // nacl.box.publicKeyLength
  } catch {
    return false;
  }
}
