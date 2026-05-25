'use client';

/**
 * "Wash" — a second, independent encryption layer for off-Void communication
 * or for hardening invite codes / community passwords. Deliberately uses a
 * different primitive from the chat protocol:
 *
 *   - Chat protocol:  NaCl `nacl.box`     (Curve25519 + XSalsa20 + Poly1305)
 *   - Wash, both modes: Web Crypto         (P-256 ECDH or PBKDF2 + AES-256-GCM)
 *
 * Cracking one layer doesn't give you the other.
 *
 * Two modes:
 *
 *   1. Passphrase mode (prefix `void$wash$v1$`):
 *        AES-256-GCM key derived from a shared passphrase via PBKDF2-SHA256.
 *        Both sender and recipient need the passphrase. Use this for
 *        invites/passwords sent over a channel where you don't know the
 *        recipient's SubPub.
 *
 *   2. SubPub mode (prefix `void$wash$pub1$`):
 *        ECIES — sender generates an ephemeral P-256 keypair, derives an
 *        AES-GCM key by ECDH with the recipient's SubPub, encrypts, and
 *        embeds the ephemeral public key in the blob. Recipient unwraps
 *        with their own wash secret key. No passphrase needed; only the
 *        recipient can read the blob.
 *
 * Wire formats (single base64 blob after a versioned prefix):
 *
 *   void$wash$v1$    <base64( salt(16)        || iv(12) || ciphertext )>
 *   void$wash$pub1$  <base64( ephemPubRaw(65) || iv(12) || ciphertext )>
 */

import bs58 from 'bs58';

const PREFIX_PASSPHRASE = 'void$wash$v1$';
const PREFIX_SUBPUB = 'void$wash$pub1$';

const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 200_000;
const ECDH_CURVE = 'P-256';
// P-256 uncompressed point: 1 byte tag (0x04) + 32 byte X + 32 byte Y.
const P256_RAW_PUB_BYTES = 65;

const SESSION_KEYS_STORAGE = 'voidchat_wash_keys';

function getSubtle(): SubtleCrypto {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto unavailable — wash requires a secure browser context');
  }
  return window.crypto.subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Direction-agnostic check: does this look like any wash blob? */
export function isWashed(s: string): boolean {
  return typeof s === 'string' && (s.startsWith(PREFIX_PASSPHRASE) || s.startsWith(PREFIX_SUBPUB));
}

export function washMode(s: string): 'passphrase' | 'subpub' | null {
  if (typeof s !== 'string') return null;
  if (s.startsWith(PREFIX_SUBPUB)) return 'subpub';
  if (s.startsWith(PREFIX_PASSPHRASE)) return 'passphrase';
  return null;
}

// ── Session SubPub keypair management ────────────────────────────────────

interface WashIdentity {
  publicKeyB58: string;
  keyPair: CryptoKeyPair;
}

interface StoredWashKeys {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  publicKeyB58: string;
}

let cachedIdentity: WashIdentity | null = null;

async function loadStoredIdentity(): Promise<WashIdentity | null> {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(SESSION_KEYS_STORAGE);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredWashKeys;
    const subtle = getSubtle();
    const publicKey = await subtle.importKey(
      'jwk',
      stored.publicJwk,
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      true,
      [],
    );
    const privateKey = await subtle.importKey(
      'jwk',
      stored.privateJwk,
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      true,
      ['deriveKey', 'deriveBits'],
    );
    return { publicKeyB58: stored.publicKeyB58, keyPair: { publicKey, privateKey } };
  } catch {
    try {
      sessionStorage.removeItem(SESSION_KEYS_STORAGE);
    } catch {
      // ignore
    }
    return null;
  }
}

async function generateIdentity(): Promise<WashIdentity> {
  const subtle = getSubtle();
  const keyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const rawPub = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
  const publicKeyB58 = bs58.encode(rawPub);
  const publicJwk = await subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await subtle.exportKey('jwk', keyPair.privateKey);
  if (typeof window !== 'undefined') {
    try {
      const stored: StoredWashKeys = { publicJwk, privateJwk, publicKeyB58 };
      sessionStorage.setItem(SESSION_KEYS_STORAGE, JSON.stringify(stored));
    } catch {
      // sessionStorage full / disabled — fall through; identity still works
      // in memory, just not persisted across reloads in this tab.
    }
  }
  return { publicKeyB58, keyPair };
}

/**
 * Get this session's wash identity, loading from sessionStorage or
 * generating fresh on first call. Cached in module scope after the first
 * resolution. Closing the tab wipes the storage and the cache.
 */
export async function getOrCreateWashIdentity(): Promise<WashIdentity> {
  if (cachedIdentity) return cachedIdentity;
  const loaded = await loadStoredIdentity();
  cachedIdentity = loaded ?? (await generateIdentity());
  return cachedIdentity;
}

/** Drop the in-memory cache + persisted keys. Used by settings end-session. */
export function clearWashIdentity(): void {
  cachedIdentity = null;
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_KEYS_STORAGE);
  } catch {
    // ignore
  }
}

// ── Passphrase mode (v1) ─────────────────────────────────────────────────

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wash(plaintext: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('Passphrase is required');
  if (typeof plaintext !== 'string') throw new Error('Plaintext must be a string');
  const subtle = getSubtle();
  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext) as BufferSource,
    ),
  );
  const blob = new Uint8Array(salt.length + iv.length + ct.length);
  blob.set(salt, 0);
  blob.set(iv, salt.length);
  blob.set(ct, salt.length + iv.length);
  return PREFIX_PASSPHRASE + bytesToBase64(blob);
}

async function unwashPassphrase(washed: string, passphrase: string): Promise<string | null> {
  if (!passphrase) return null;
  let blob: Uint8Array;
  try {
    blob = base64ToBytes(washed.slice(PREFIX_PASSPHRASE.length));
  } catch {
    return null;
  }
  if (blob.length < SALT_BYTES + IV_BYTES + 1) return null;
  const salt = blob.slice(0, SALT_BYTES);
  const iv = blob.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ct = blob.slice(SALT_BYTES + IV_BYTES);
  try {
    const key = await deriveKeyFromPassphrase(passphrase, salt);
    const pt = await getSubtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// ── SubPub mode (ECIES with P-256 + AES-GCM) ────────────────────────────

async function importRecipientPub(recipientB58: string): Promise<CryptoKey> {
  const raw = bs58.decode(recipientB58);
  if (raw.length !== P256_RAW_PUB_BYTES) {
    throw new Error('SubPub is not a valid P-256 public key');
  }
  return getSubtle().importKey(
    'raw',
    raw as BufferSource,
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    false,
    [],
  );
}

/**
 * Encrypt `plaintext` so that only the holder of the secret key
 * corresponding to `recipientSubPub` can read it. Sender generates a
 * fresh ephemeral keypair for each call — same input + same recipient
 * yields a different blob every time.
 */
export async function washForRecipient(
  plaintext: string,
  recipientSubPubB58: string,
): Promise<string> {
  if (typeof plaintext !== 'string') throw new Error('Plaintext must be a string');
  const subtle = getSubtle();
  const recipientPub = await importRecipientPub(recipientSubPubB58);

  const ephemPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    true,
    ['deriveKey'],
  );
  const aesKey = await subtle.deriveKey(
    { name: 'ECDH', public: recipientPub },
    ephemPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      new TextEncoder().encode(plaintext) as BufferSource,
    ),
  );
  const ephemPubRaw = new Uint8Array(await subtle.exportKey('raw', ephemPair.publicKey));

  const blob = new Uint8Array(ephemPubRaw.length + iv.length + ct.length);
  blob.set(ephemPubRaw, 0);
  blob.set(iv, ephemPubRaw.length);
  blob.set(ct, ephemPubRaw.length + iv.length);
  return PREFIX_SUBPUB + bytesToBase64(blob);
}

async function unwashSubPub(washed: string, identity: WashIdentity): Promise<string | null> {
  let blob: Uint8Array;
  try {
    blob = base64ToBytes(washed.slice(PREFIX_SUBPUB.length));
  } catch {
    return null;
  }
  if (blob.length < P256_RAW_PUB_BYTES + IV_BYTES + 1) return null;
  const ephemPubRaw = blob.slice(0, P256_RAW_PUB_BYTES);
  const iv = blob.slice(P256_RAW_PUB_BYTES, P256_RAW_PUB_BYTES + IV_BYTES);
  const ct = blob.slice(P256_RAW_PUB_BYTES + IV_BYTES);
  try {
    const subtle = getSubtle();
    const ephemPub = await subtle.importKey(
      'raw',
      ephemPubRaw as BufferSource,
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      false,
      [],
    );
    const aesKey = await subtle.deriveKey(
      { name: 'ECDH', public: ephemPub },
      identity.keyPair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const pt = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      ct as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/**
 * Decrypt either flavor of wash blob. Pass a passphrase for v1 blobs;
 * SubPub blobs are decrypted with this session's wash identity (loaded
 * lazily). Returns plaintext or null on any failure.
 */
export async function unwash(washed: string, passphrase: string): Promise<string | null> {
  if (typeof washed !== 'string') return null;
  if (washed.startsWith(PREFIX_PASSPHRASE)) {
    return unwashPassphrase(washed, passphrase);
  }
  if (washed.startsWith(PREFIX_SUBPUB)) {
    const identity = await getOrCreateWashIdentity().catch(() => null);
    if (!identity) return null;
    return unwashSubPub(washed, identity);
  }
  return null;
}
