/**
 * Key Distribution for Void Chat
 *
 * TRUST MODEL: This is NOT a true Distributed Key Generation (DKG) protocol.
 * A single trusted initiator generates the full channel encryption key, then
 * splits it via Shamir's Secret Sharing and distributes encrypted shares to
 * members. The initiator MUST be trusted — they have full knowledge of the
 * channel key at generation time.
 *
 * Feldman VSS commitments are included so that share recipients can verify
 * their shares were generated from a consistent polynomial, preventing a
 * malicious initiator from distributing inconsistent/garbage shares.
 *
 * Threshold: t-of-n scheme where t = ceil(n/2) + 1
 * (majority required to reconstruct the key)
 *
 * Future work: Replace with a proper DKG protocol (e.g., Pedersen DKG or
 * FROST) where no single party learns the full secret during generation.
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

// =============================================================================
// GALOIS FIELD GF(256) ARITHMETIC
// =============================================================================

// Irreducible polynomial for GF(256): x^8 + x^4 + x^3 + x + 1
const GF256_PRIMITIVE = 0x11b;

// Precomputed log and exp tables for GF(256)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

function initGF256Tables(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x = (x << 1) ^ (x & 0x80 ? GF256_PRIMITIVE & 0xff : 0);
    x &= 0xff;
  }
  // Extend exp table for easier modular access
  for (let i = 255; i < 512; i++) {
    EXP_TABLE[i] = EXP_TABLE[i - 255];
  }
}

initGF256Tables();

function gf256Mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

function gf256Div(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] - LOG_TABLE[b] + 255) % 255];
}

function gf256Add(a: number, b: number): number {
  return a ^ b; // XOR in GF(2^n)
}

// =============================================================================
// FELDMAN VSS COMMITMENTS
// =============================================================================

/**
 * Feldman VSS commitments for share verification.
 *
 * For a polynomial f(x) = a_0 + a_1*x + ... + a_{t-1}*x^{t-1} over GF(256):
 * - Commitments C_j = scalarMult.base(pad32(a_j)) for each coefficient
 * - Per byte of the secret, we have t commitments (one per coefficient)
 *
 * Verification approach:
 * Since tweetnacl lacks point addition, we build a reverse lookup table
 * mapping Curve25519 base-point multiples back to their GF(256) scalars
 * (only 256 entries). This lets us extract coefficients from commitments,
 * re-evaluate the polynomial at share.x, and compare against share.y.
 */

export interface FeldmanCommitments {
  /** commitments[byteIdx][coeffIdx] = base64-encoded Curve25519 point (32 bytes) */
  commitments: string[][];
  /** threshold t (number of coefficients per byte) */
  threshold: number;
  /** number of secret bytes */
  secretLength: number;
}

/**
 * Convert a single GF(256) byte to a 32-byte scalar for Curve25519 scalarMult.
 * The byte is placed in the least significant position (little-endian).
 */
function byteToScalar32(b: number): Uint8Array {
  const scalar = new Uint8Array(32);
  scalar[0] = b;
  return scalar;
}

/**
 * Precomputed reverse lookup table: base64(point) -> GF(256) scalar value.
 * Lazily initialized on first use.
 */
let _pointToScalarCache: Map<string, number> | null = null;

function getPointToScalarLookup(): Map<string, number> {
  if (_pointToScalarCache) return _pointToScalarCache;
  _pointToScalarCache = new Map<string, number>();
  for (let b = 0; b < 256; b++) {
    const scalar = byteToScalar32(b);
    const point = nacl.scalarMult.base(scalar);
    _pointToScalarCache.set(naclUtil.encodeBase64(point), b);
  }
  return _pointToScalarCache;
}

/**
 * Compute Feldman VSS commitments for the polynomials used in splitting.
 *
 * @param coefficientsPerByte - Array of coefficient arrays, one per secret byte.
 *   coefficientsPerByte[byteIdx][j] is the j-th coefficient for that byte's polynomial.
 * @param threshold - The polynomial degree + 1
 * @returns FeldmanCommitments structure
 */
export function computeFeldmanCommitments(
  coefficientsPerByte: Uint8Array[],
  threshold: number
): FeldmanCommitments {
  const commitments: string[][] = [];

  for (let byteIdx = 0; byteIdx < coefficientsPerByte.length; byteIdx++) {
    const byteCommitments: string[] = [];
    const coeffs = coefficientsPerByte[byteIdx];

    for (let j = 0; j < threshold; j++) {
      // C_j = a_j * G (base point multiplication)
      const scalar = byteToScalar32(coeffs[j]);
      const point = nacl.scalarMult.base(scalar);
      byteCommitments.push(naclUtil.encodeBase64(point));
    }

    commitments.push(byteCommitments);
  }

  return {
    commitments,
    threshold,
    secretLength: coefficientsPerByte.length,
  };
}

/**
 * Verify a share against Feldman VSS commitments.
 *
 * Uses a reverse lookup table to extract polynomial coefficients from the
 * commitment points, then re-evaluates the polynomial at the share's x
 * value and checks it matches the share's y value for every byte position.
 *
 * @param share - The share to verify
 * @param feldman - The Feldman commitments from the initiator
 * @returns true if the share is valid
 */
export function verifyShare(
  share: Share,
  feldman: FeldmanCommitments
): boolean {
  try {
    if (share.y.length !== feldman.secretLength) {
      console.error('[KeyDist] Share length mismatch with commitments');
      return false;
    }

    const pointToScalar = getPointToScalarLookup();

    for (let byteIdx = 0; byteIdx < feldman.secretLength; byteIdx++) {
      const byteCommitments = feldman.commitments[byteIdx];

      // Extract coefficient values from commitments using the lookup table
      const coefficients: number[] = [];
      for (let j = 0; j < feldman.threshold; j++) {
        const coeffValue = pointToScalar.get(byteCommitments[j]);
        if (coeffValue === undefined) {
          console.error(`[KeyDist] Unknown commitment point at byte ${byteIdx}, coeff ${j}`);
          return false;
        }
        coefficients.push(coeffValue);
      }

      // Evaluate the polynomial at share.x using GF(256) arithmetic
      let expected = 0;
      for (let j = feldman.threshold - 1; j >= 0; j--) {
        expected = gf256Add(gf256Mul(expected, share.x), coefficients[j]);
      }

      if (expected !== share.y[byteIdx]) {
        console.error(`[KeyDist] Share verification failed at byte ${byteIdx}: expected ${expected}, got ${share.y[byteIdx]}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('[KeyDist] verifyShare error:', error);
    return false;
  }
}

// =============================================================================
// SHAMIR'S SECRET SHARING
// =============================================================================

export interface Share {
  x: number; // Share index (1-255)
  y: Uint8Array; // Share data (same length as secret)
}

/**
 * Result of splitting a secret, includes shares and Feldman VSS commitments
 * for verification.
 */
export interface SplitResult {
  shares: Share[];
  feldmanCommitments: FeldmanCommitments;
}

/**
 * Split a secret into n shares with threshold t.
 * Returns shares AND Feldman VSS commitments for verification.
 * (any t shares can reconstruct the secret)
 *
 * @param secret - The secret bytes to split
 * @param n - Total number of shares
 * @param t - Threshold (minimum shares needed to reconstruct)
 * @returns SplitResult with shares and Feldman commitments
 */
export function splitSecret(secret: Uint8Array, n: number, t: number): SplitResult {
  if (t < 2) throw new Error('Threshold must be at least 2');
  if (n < t) throw new Error('Number of shares must be >= threshold');
  if (n > 255) throw new Error('Maximum 255 shares');

  const shares: Share[] = [];

  for (let i = 0; i < n; i++) {
    shares.push({ x: i + 1, y: new Uint8Array(secret.length) });
  }

  // Store all coefficients for Feldman commitment generation
  const allCoefficients: Uint8Array[] = [];

  // For each byte of the secret, create a random polynomial of degree t-1
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    // coefficients[0] = secret byte, coefficients[1..t-1] = random
    const coefficients = new Uint8Array(t);
    coefficients[0] = secret[byteIdx];
    const randomCoeffs = nacl.randomBytes(t - 1);
    for (let j = 1; j < t; j++) {
      coefficients[j] = randomCoeffs[j - 1];
    }

    // Store a copy of coefficients for Feldman commitments
    allCoefficients.push(new Uint8Array(coefficients));

    // Evaluate polynomial at each share's x value
    for (let i = 0; i < n; i++) {
      let value = 0;
      for (let j = t - 1; j >= 0; j--) {
        value = gf256Add(gf256Mul(value, shares[i].x), coefficients[j]);
      }
      shares[i].y[byteIdx] = value;
    }
  }

  // Generate Feldman VSS commitments
  const feldmanCommitments = computeFeldmanCommitments(allCoefficients, t);

  return { shares, feldmanCommitments };
}

/**
 * Reconstruct a secret from shares using Lagrange interpolation
 *
 * @param shares - Array of at least t shares
 * @returns The reconstructed secret bytes
 */
export function reconstructSecret(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error('Need at least 2 shares');

  const secretLength = shares[0].y.length;
  const secret = new Uint8Array(secretLength);

  for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
    let value = 0;

    for (let i = 0; i < shares.length; i++) {
      let lagrange = 1;

      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        // lagrange *= x_j / (x_j - x_i) in GF(256)
        const num = shares[j].x;
        const den = gf256Add(shares[j].x, shares[i].x); // XOR = subtraction in GF(2^n)
        lagrange = gf256Mul(lagrange, gf256Div(num, den));
      }

      value = gf256Add(value, gf256Mul(shares[i].y[byteIdx], lagrange));
    }

    secret[byteIdx] = value;
  }

  return secret;
}

// =============================================================================
// KEY DISTRIBUTION PROTOCOL
// (Centralized key generation with Shamir secret sharing distribution)
// NOTE: Previously named "DKG Protocol" — renamed for honesty about the
// trust model. The DKGSession type alias is kept for backward compatibility.
// =============================================================================

export interface KeyDistSession {
  channelId: string;
  threshold: number;
  totalMembers: number;
  /** Each member's share (encrypted with their public key) */
  encryptedShares: Map<string, string>; // publicId -> base64 encrypted share
  /** The group public key (shared openly) */
  groupPublicKey: string;
  /** Feldman VSS commitments for share verification */
  feldmanCommitments: FeldmanCommitments;
  createdAt: number;
}

/** @deprecated Use KeyDistSession instead. Alias kept for backward compatibility. */
export type DKGSession = KeyDistSession;

export interface DKGSharePackage {
  channelId: string;
  shareIndex: number;
  encryptedShare: string; // base64 — encrypted with recipient's public key
  nonce: string; // base64
  groupPublicKey: string;
}

/**
 * Generate a group channel key and distribute shares to members.
 *
 * IMPORTANT: This is centralized key generation — the initiator knows the
 * full channel key. The initiator must be trusted. Feldman VSS commitments
 * are generated so recipients can verify their shares are consistent with
 * the committed polynomial (preventing garbage share attacks).
 *
 * @param channelId - Channel this key is for
 * @param memberPublicKeys - Map of publicId -> base64 public key
 * @param initiatorSecretKey - Initiator's secret key for encrypting shares
 * @returns Key distribution session with encrypted shares and commitments
 */
export function generateGroupKey(
  channelId: string,
  memberPublicKeys: Map<string, string>,
  initiatorSecretKey: string
): KeyDistSession | null {
  try {
    const members = Array.from(memberPublicKeys.entries());
    const n = members.length;
    const t = Math.ceil(n / 2) + 1; // Majority + 1

    if (n < 2) return null;

    // Generate random channel key
    const channelKey = nacl.randomBytes(nacl.secretbox.keyLength);

    // Split into shares (returns Feldman commitments too)
    const { shares, feldmanCommitments } = splitSecret(channelKey, n, t);

    // Encrypt each share for the corresponding member
    const encryptedShares = new Map<string, string>();
    const senderKey = naclUtil.decodeBase64(initiatorSecretKey);

    for (let i = 0; i < members.length; i++) {
      const [publicId, publicKeyBase64] = members[i];
      const recipientKey = naclUtil.decodeBase64(publicKeyBase64);

      // Serialize share
      const shareData = JSON.stringify({ x: shares[i].x, y: naclUtil.encodeBase64(shares[i].y) });
      const shareBytes = naclUtil.decodeUTF8(shareData);

      // Encrypt with nacl.box
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const encrypted = nacl.box(shareBytes, nonce, recipientKey, senderKey);

      if (!encrypted) {
        console.error(`[KeyDist] Failed to encrypt share for ${publicId}`);
        return null;
      }

      const package64 = naclUtil.encodeBase64(nonce) + ':' + naclUtil.encodeBase64(encrypted);
      encryptedShares.set(publicId, package64);
    }

    // Derive group public key from channel key (deterministic)
    const groupKeyPair = nacl.box.keyPair.fromSecretKey(channelKey);
    const groupPublicKey = naclUtil.encodeBase64(groupKeyPair.publicKey);

    return {
      channelId,
      threshold: t,
      totalMembers: n,
      encryptedShares,
      groupPublicKey,
      feldmanCommitments,
      createdAt: Date.now(),
    };
  } catch (error) {
    console.error('[KeyDist] generateGroupKey error:', error);
    return null;
  }
}

/**
 * Decrypt a share package received from the key distribution initiator.
 *
 * NOTE: This does NOT verify the share. Use decryptAndVerifyShare() instead
 * for full Feldman VSS verification.
 *
 * @param encryptedPackage - The encrypted share string (nonce:encrypted)
 * @param senderPublicKey - Initiator's public key (base64)
 * @param recipientSecretKey - Our secret key (base64)
 * @returns The decrypted Share, or null on failure
 */
export function decryptShare(
  encryptedPackage: string,
  senderPublicKey: string,
  recipientSecretKey: string
): Share | null {
  try {
    const [nonce64, encrypted64] = encryptedPackage.split(':');
    if (!nonce64 || !encrypted64) return null;

    const nonce = naclUtil.decodeBase64(nonce64);
    const encrypted = naclUtil.decodeBase64(encrypted64);
    const senderKey = naclUtil.decodeBase64(senderPublicKey);
    const secretKey = naclUtil.decodeBase64(recipientSecretKey);

    const decrypted = nacl.box.open(encrypted, nonce, senderKey, secretKey);
    if (!decrypted) return null;

    const shareData = JSON.parse(naclUtil.encodeUTF8(decrypted));
    return {
      x: shareData.x,
      y: naclUtil.decodeBase64(shareData.y),
    };
  } catch (error) {
    console.error('[KeyDist] decryptShare error:', error);
    return null;
  }
}

/**
 * Decrypt a share and verify it against Feldman VSS commitments.
 * This is the recommended way to accept a share — it ensures the
 * initiator distributed a valid share consistent with the polynomial.
 *
 * @param encryptedPackage - The encrypted share string (nonce:encrypted)
 * @param senderPublicKey - Initiator's public key (base64)
 * @param recipientSecretKey - Our secret key (base64)
 * @param feldmanCommitments - Feldman VSS commitments from the initiator
 * @returns The verified decrypted Share, or null on failure/invalid
 */
export function decryptAndVerifyShare(
  encryptedPackage: string,
  senderPublicKey: string,
  recipientSecretKey: string,
  feldmanCommitments: FeldmanCommitments
): Share | null {
  const share = decryptShare(encryptedPackage, senderPublicKey, recipientSecretKey);
  if (!share) return null;

  if (!verifyShare(share, feldmanCommitments)) {
    console.error('[KeyDist] Share failed Feldman VSS verification — possible malicious initiator');
    return null;
  }

  return share;
}

/**
 * Reconstruct the channel key from collected shares
 *
 * @param shares - At least threshold number of shares
 * @returns The reconstructed channel key as base64, or null
 */
export function reconstructChannelKey(shares: Share[]): string | null {
  try {
    const secret = reconstructSecret(shares);
    return naclUtil.encodeBase64(secret);
  } catch (error) {
    console.error('[KeyDist] reconstructChannelKey error:', error);
    return null;
  }
}

/**
 * Calculate the threshold for a given member count
 * t = ceil(n/2) + 1 (strict majority)
 */
export function calculateThreshold(memberCount: number): number {
  return Math.ceil(memberCount / 2) + 1;
}

// =============================================================================
// CALLBACK-BASED VARIANTS (secret key never leaves the caller)
// =============================================================================

/**
 * Type for nacl.box encrypt callback — encrypts plaintext using the caller's
 * internally-held secret key and the provided recipient public key.
 */
export type BoxEncryptFn = (plaintext: Uint8Array, nonce: Uint8Array, recipientPublicKey: Uint8Array) => Uint8Array | null;

/**
 * Type for nacl.box.open callback — decrypts ciphertext using the caller's
 * internally-held secret key and the provided sender public key.
 */
export type BoxOpenFn = (ciphertext: Uint8Array, nonce: Uint8Array, senderPublicKey: Uint8Array) => Uint8Array | null;

/**
 * Generate a group key and encrypt shares using a boxEncrypt callback
 * instead of a raw secret key string. The secret key never leaves the caller.
 * Includes Feldman VSS commitments for share verification.
 */
export function generateGroupKeyWithCallback(
  channelId: string,
  memberPublicKeys: Map<string, string>,
  boxEncrypt: BoxEncryptFn
): KeyDistSession | null {
  try {
    const members = Array.from(memberPublicKeys.entries());
    const n = members.length;
    const t = Math.ceil(n / 2) + 1;

    if (n < 2) return null;

    const channelKey = nacl.randomBytes(nacl.secretbox.keyLength);
    const { shares, feldmanCommitments } = splitSecret(channelKey, n, t);

    const encryptedShares = new Map<string, string>();

    for (let i = 0; i < members.length; i++) {
      const [publicId, publicKeyBase64] = members[i];
      const recipientKey = naclUtil.decodeBase64(publicKeyBase64);

      const shareData = JSON.stringify({ x: shares[i].x, y: naclUtil.encodeBase64(shares[i].y) });
      const shareBytes = naclUtil.decodeUTF8(shareData);

      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const encrypted = boxEncrypt(shareBytes, nonce, recipientKey);

      if (!encrypted) {
        console.error(`[KeyDist] Failed to encrypt share for ${publicId}`);
        return null;
      }

      const package64 = naclUtil.encodeBase64(nonce) + ':' + naclUtil.encodeBase64(encrypted);
      encryptedShares.set(publicId, package64);
    }

    const groupKeyPair = nacl.box.keyPair.fromSecretKey(channelKey);
    const groupPublicKey = naclUtil.encodeBase64(groupKeyPair.publicKey);

    return {
      channelId,
      threshold: t,
      totalMembers: n,
      encryptedShares,
      groupPublicKey,
      feldmanCommitments,
      createdAt: Date.now(),
    };
  } catch (error) {
    console.error('[KeyDist] generateGroupKeyWithCallback error:', error);
    return null;
  }
}

/**
 * Decrypt a share package using a boxOpen callback instead of a raw secret key.
 * The secret key never leaves the caller.
 *
 * NOTE: This does NOT verify the share. Callers should verify using
 * verifyShare() with the Feldman commitments after decryption.
 */
export function decryptShareWithCallback(
  encryptedPackage: string,
  senderPublicKey: string,
  boxOpen: BoxOpenFn
): Share | null {
  try {
    const [nonce64, encrypted64] = encryptedPackage.split(':');
    if (!nonce64 || !encrypted64) return null;

    const nonce = naclUtil.decodeBase64(nonce64);
    const encrypted = naclUtil.decodeBase64(encrypted64);
    const senderKey = naclUtil.decodeBase64(senderPublicKey);

    const decrypted = boxOpen(encrypted, nonce, senderKey);
    if (!decrypted) return null;

    const shareData = JSON.parse(naclUtil.encodeUTF8(decrypted));
    return {
      x: shareData.x,
      y: naclUtil.decodeBase64(shareData.y),
    };
  } catch (error) {
    console.error('[KeyDist] decryptShareWithCallback error:', error);
    return null;
  }
}
