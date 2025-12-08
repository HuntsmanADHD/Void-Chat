/**
 * Authentication Utilities for Void Chat API Routes
 * Handles wallet signature verification, session management, and authorization
 */

import { NextRequest } from 'next/server';
import { sign } from 'tweetnacl';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import crypto from 'crypto';
import { prisma } from './prisma';
import { getClawedTokenBalance } from './solana';
import type { User, MembershipRole } from '@prisma/client';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * JWT-like token structure (simplified for wallet-based auth)
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
 * Minimum token balance required to create communities (1000 $CLAWED with 6 decimals)
 */
export const MIN_TOKEN_FOR_COMMUNITY_CREATE = BigInt(1000 * 1_000_000);

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
  walletAddress: string;
  xHandle: string | null;
  publicKey: string;
  tokenBalance: bigint;
  strikes: number;
  isBlacklisted: boolean;
  timeoutUntil: Date | null;
}

export interface AuthResult {
  success: boolean;
  user?: AuthenticatedUser;
  error?: string;
  statusCode?: number;
}

export interface TokenPayload {
  walletAddress: string;
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
export function generateAuthToken(userId: string, walletAddress: string): string {
  const payload: TokenPayload = {
    userId,
    walletAddress,
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
// WALLET SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify a wallet signature for authentication
 */
export function verifyWalletSignature(
  message: string,
  signature: string,
  walletAddress: string
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = bs58.decode(walletAddress);

    return sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error('[Auth] Signature verification failed:', error);
    return false;
  }
}

/**
 * Validate the authentication message format and timestamp
 * Message format: "Sign this message to authenticate with Void Chat.\n\nThis will not trigger a blockchain transaction or cost any gas fees.\n\nTimestamp: {timestamp}"
 */
export function validateAuthMessage(message: string): boolean {
  const prefix = 'Sign this message to authenticate with Void Chat.';

  if (!message.startsWith(prefix)) {
    return false;
  }

  // Extract timestamp
  const timestampMatch = message.match(/Timestamp:\s*(\d+)/);
  if (!timestampMatch) {
    return false;
  }

  const timestamp = parseInt(timestampMatch[1], 10);
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  // Message must be within 5 minutes
  return Math.abs(now - timestamp) < fiveMinutes;
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
  const walletAddress = req.headers.get('x-wallet-address');
  const signature = req.headers.get('x-wallet-signature');
  const message = req.headers.get('x-auth-message');

  if (walletAddress && signature && message) {
    return authenticateWithSignature(walletAddress, signature, message);
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

  // Check timeout status
  if (user.timeoutUntil && user.timeoutUntil > new Date()) {
    return {
      success: false,
      error: `Account is in timeout until ${user.timeoutUntil.toISOString()}`,
      statusCode: 403,
    };
  }

  return {
    success: true,
    user: {
      id: user.id,
      walletAddress: user.walletAddress,
      xHandle: user.xHandle,
      publicKey: user.publicKey,
      tokenBalance: user.tokenBalance,
      strikes: user.strikes,
      isBlacklisted: user.isBlacklisted,
      timeoutUntil: user.timeoutUntil,
    },
  };
}

/**
 * Authenticate using wallet signature
 */
async function authenticateWithSignature(
  walletAddress: string,
  signature: string,
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

  // Verify signature
  if (!verifyWalletSignature(message, signature, walletAddress)) {
    return {
      success: false,
      error: 'Invalid signature',
      statusCode: 401,
    };
  }

  // Fetch user from database
  const user = await prisma.user.findUnique({
    where: { walletAddress },
  });

  if (!user) {
    return {
      success: false,
      error: 'User not registered',
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

  // Check timeout status
  if (user.timeoutUntil && user.timeoutUntil > new Date()) {
    return {
      success: false,
      error: `Account is in timeout until ${user.timeoutUntil.toISOString()}`,
      statusCode: 403,
    };
  }

  return {
    success: true,
    user: {
      id: user.id,
      walletAddress: user.walletAddress,
      xHandle: user.xHandle,
      publicKey: user.publicKey,
      tokenBalance: user.tokenBalance,
      strikes: user.strikes,
      isBlacklisted: user.isBlacklisted,
      timeoutUntil: user.timeoutUntil,
    },
  };
}

// =============================================================================
// AUTHORIZATION HELPERS
// =============================================================================

/**
 * Check if user has required role in a community
 */
export async function checkCommunityRole(
  userId: string,
  communityId: string,
  requiredRoles: MembershipRole[]
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_communityId: {
        userId,
        communityId,
      },
    },
  });

  if (!membership) {
    return false;
  }

  return requiredRoles.includes(membership.role);
}

/**
 * Check if user is community owner
 */
export async function isCommunityOwner(
  userId: string,
  communityId: string
): Promise<boolean> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { ownerId: true },
  });

  return community?.ownerId === userId;
}

/**
 * Check if user is community admin or owner
 */
export async function isCommunityAdmin(
  userId: string,
  communityId: string
): Promise<boolean> {
  return checkCommunityRole(userId, communityId, ['OWNER', 'ADMIN']);
}

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

/**
 * Check if user meets minimum token requirement
 */
export async function checkMinTokenBalance(
  walletAddress: string,
  minRequired: bigint
): Promise<boolean> {
  const balance = await getClawedTokenBalance(walletAddress);
  return balance >= minRequired;
}

/**
 * Update user's cached token balance
 */
export async function updateUserTokenBalance(user: User): Promise<bigint> {
  const balance = await getClawedTokenBalance(user.walletAddress);

  await prisma.user.update({
    where: { id: user.id },
    data: { tokenBalance: balance },
  });

  return balance;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Check rate limit for a wallet address
 */
export function checkRateLimit(walletAddress: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = walletAddress.toLowerCase();

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
 * Check if a wallet is blacklisted or timed out
 */
export async function checkBlacklistStatus(walletAddress: string): Promise<{
  isBlacklisted: boolean;
  strikes: number;
  timeoutUntil: Date | null;
  canPerformActions: boolean;
}> {
  const user = await prisma.user.findUnique({
    where: { walletAddress },
    select: {
      isBlacklisted: true,
      strikes: true,
      timeoutUntil: true,
    },
  });

  if (!user) {
    return {
      isBlacklisted: false,
      strikes: 0,
      timeoutUntil: null,
      canPerformActions: true, // New users can perform actions
    };
  }

  const isTimedOut = user.timeoutUntil && user.timeoutUntil > new Date();

  return {
    isBlacklisted: user.isBlacklisted,
    strikes: user.strikes,
    timeoutUntil: user.timeoutUntil,
    canPerformActions: !user.isBlacklisted && !isTimedOut,
  };
}

/**
 * Issue a strike to a user
 * Strike 1: 24hr timeout
 * Strike 2: 7-day timeout
 * Strike 3: Permanent blacklist
 */
export async function issueStrike(
  userId: string,
  reportId: string,
  reason: string
): Promise<{
  newStrikeCount: number;
  isBlacklisted: boolean;
  timeoutUntil: Date | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error('User not found');
  }

  const newStrikeCount = user.strikes + 1;
  let isBlacklisted = false;
  let timeoutUntil: Date | null = null;
  let strikeExpiresAt: Date | null = null;

  const now = new Date();

  switch (newStrikeCount) {
    case 1:
      // 24-hour timeout
      timeoutUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      strikeExpiresAt = timeoutUntil;
      break;
    case 2:
      // 7-day timeout
      timeoutUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      strikeExpiresAt = timeoutUntil;
      break;
    case 3:
    default:
      // Permanent blacklist
      isBlacklisted = true;
      break;
  }

  // Update user and create strike record in a transaction
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        strikes: newStrikeCount,
        isBlacklisted,
        blacklistedAt: isBlacklisted ? now : null,
        timeoutUntil,
      },
    }),
    prisma.strike.create({
      data: {
        userId,
        reportId,
        strikeNumber: newStrikeCount,
        reason,
        expiresAt: strikeExpiresAt,
      },
    }),
  ]);

  return {
    newStrikeCount,
    isBlacklisted,
    timeoutUntil,
  };
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

/**
 * Validate Solana wallet address format
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    // Base58 check and length validation
    const decoded = bs58.decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

/**
 * Validate X/Twitter handle format
 */
export function isValidXHandle(handle: string): boolean {
  // X handles: 4-15 characters, alphanumeric and underscores
  const xHandleRegex = /^[A-Za-z0-9_]{4,15}$/;
  return xHandleRegex.test(handle);
}

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
 * Sanitize string input to prevent XSS
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
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
 * Standard CORS headers for API routes
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Wallet-Address, X-Wallet-Signature, X-Auth-Message',
  'Access-Control-Max-Age': '86400', // 24 hours
} as const;

/**
 * Create CORS preflight response for OPTIONS requests
 *
 * @param methods - Allowed HTTP methods (default: all common methods)
 * @returns Response with CORS headers
 *
 * @example
 * ```ts
 * // In API route file:
 * export { createCORSResponse as OPTIONS } from '@/lib/auth';
 *
 * // Or with specific methods:
 * export async function OPTIONS() {
 *   return createCORSResponse(['GET', 'POST']);
 * }
 * ```
 */
export function createCORSResponse(methods?: string[]): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
  };

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
export async function OPTIONS(): Promise<Response> {
  return createCORSResponse();
}
