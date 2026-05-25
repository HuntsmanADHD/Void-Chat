/**
 * Password hashing for private communities.
 *
 * Uses Node's built-in scrypt — no extra dependency, intentionally slow
 * (rate-limits brute force). Hash format is `salt:derivedKey` with both
 * fields hex-encoded so the whole credential lives in one schema column.
 *
 * The relay never sees the plaintext password. Clients send it as the
 * `x-community-password` header; the API hashes-and-compares server-side.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify<string | Buffer, Buffer, number, Buffer>(scrypt);

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export const COMMUNITY_PASSWORD_MIN_LEN = 4;
export const COMMUNITY_PASSWORD_MAX_LEN = 128;

/**
 * Hash a password. Generates a fresh random salt, derives a key with
 * scrypt, returns `salt:derivedKey` (both hex) for storage.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_BYTES);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verify a candidate password against a stored hash. Constant-time
 * comparison via `timingSafeEqual`.
 */
export async function verifyPassword(candidate: string, stored: string): Promise<boolean> {
  const sepIndex = stored.indexOf(':');
  if (sepIndex <= 0) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(stored.slice(0, sepIndex), 'hex');
    expected = Buffer.from(stored.slice(sepIndex + 1), 'hex');
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  let derived: Buffer;
  try {
    derived = await scryptAsync(candidate, salt, KEY_BYTES);
  } catch {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
