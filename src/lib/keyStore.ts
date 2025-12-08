/**
 * Key Store - Manages encryption keys for Clawed Messenger
 *
 * Handles:
 * - Caching public keys for other users
 * - Storing channel keys (encrypted with user's public key)
 * - Fetching public keys from API when not cached
 *
 * Security Notes:
 * - Public keys are cached in memory and localStorage
 * - Channel keys are stored encrypted with the user's keypair
 * - Cache has TTL to ensure keys are refreshed periodically
 */

import type {
  PublicKeyCache,
  ChannelKeyEntry,
  UserKeyInfo,
  KeyOperationResult,
} from '@/types/encryption';
import {
  encryptForKeyExchange,
  decryptFromKeyExchange,
  isValidPublicKey,
} from './encryption';

// Cache TTL: 5 minutes (matches token balance cache)
const CACHE_TTL_MS = 5 * 60 * 1000;

// localStorage keys
const PUBLIC_KEY_CACHE_KEY = 'clawed_public_key_cache';
const CHANNEL_KEYS_KEY = 'clawed_channel_keys';

/**
 * In-memory cache for faster access
 * Falls back to localStorage for persistence
 */
const memoryCache: Map<string, PublicKeyCache> = new Map();

/**
 * Check if we're in a browser environment
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/**
 * Load public key cache from localStorage into memory
 */
function loadCacheFromStorage(): void {
  if (!isBrowser()) return;

  try {
    const stored = localStorage.getItem(PUBLIC_KEY_CACHE_KEY);
    if (stored) {
      const entries: PublicKeyCache[] = JSON.parse(stored);

      // Validate the parsed data is an array
      if (!Array.isArray(entries)) {
        console.error('[KeyStore] Invalid cache data format - expected array');
        localStorage.removeItem(PUBLIC_KEY_CACHE_KEY);
        return;
      }

      const now = Date.now();

      entries.forEach((entry) => {
        // Validate entry structure before using it
        if (!entry || typeof entry !== 'object' ||
            !entry.walletAddress || !entry.publicKey ||
            typeof entry.fetchedAt !== 'number') {
          console.warn('[KeyStore] Skipping invalid cache entry');
          return;
        }

        // Only load entries that haven't expired
        if (now - entry.fetchedAt < CACHE_TTL_MS) {
          memoryCache.set(entry.walletAddress, entry);
        }
      });
    }
  } catch (error) {
    console.error('[KeyStore] Failed to load cache from storage:', error);
    // Clear corrupted cache
    try {
      localStorage.removeItem(PUBLIC_KEY_CACHE_KEY);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Save memory cache to localStorage
 */
function saveCacheToStorage(): void {
  if (!isBrowser()) return;

  try {
    const entries = Array.from(memoryCache.values());
    localStorage.setItem(PUBLIC_KEY_CACHE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.error('[KeyStore] Failed to save cache to storage:', error);
  }
}

/**
 * Initialize the cache from localStorage
 * Call this on app startup
 */
export function initializeKeyStore(): void {
  loadCacheFromStorage();
}

/**
 * Get a cached public key for a wallet address
 *
 * @param walletAddress - Solana wallet address
 * @returns Cached public key or null if not found/expired
 */
export function getCachedPublicKey(walletAddress: string): string | null {
  // Check memory cache first
  const cached = memoryCache.get(walletAddress);

  if (cached) {
    // Check if cache entry is still valid
    if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.publicKey;
    }
    // Remove expired entry
    memoryCache.delete(walletAddress);
  }

  return null;
}

/**
 * Cache a public key for a wallet address
 *
 * @param walletAddress - Solana wallet address
 * @param publicKey - Base64-encoded public key
 */
export function cachePublicKey(walletAddress: string, publicKey: string): void {
  if (!isValidPublicKey(publicKey)) {
    console.error('[KeyStore] Attempted to cache invalid public key');
    return;
  }

  const entry: PublicKeyCache = {
    walletAddress,
    publicKey,
    fetchedAt: Date.now(),
  };

  memoryCache.set(walletAddress, entry);
  saveCacheToStorage();
}

/**
 * Remove a public key from cache
 *
 * @param walletAddress - Solana wallet address
 */
export function removeCachedPublicKey(walletAddress: string): void {
  memoryCache.delete(walletAddress);
  saveCacheToStorage();
}

/**
 * Clear all cached public keys
 */
export function clearPublicKeyCache(): void {
  memoryCache.clear();
  if (isBrowser()) {
    localStorage.removeItem(PUBLIC_KEY_CACHE_KEY);
  }
}

/**
 * Fetch a user's public key from the API
 *
 * @param walletAddress - Solana wallet address
 * @returns Public key or null if not found
 */
export async function fetchPublicKey(
  walletAddress: string
): Promise<string | null> {
  try {
    const response = await fetch(`/api/users/${walletAddress}/public-key`);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`[KeyStore] No public key found for wallet: ${walletAddress}`);
        return null;
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data: UserKeyInfo = await response.json();

    if (!data.publicKey || !isValidPublicKey(data.publicKey)) {
      console.error('[KeyStore] API returned invalid public key');
      return null;
    }

    // Cache the fetched key
    cachePublicKey(walletAddress, data.publicKey);

    return data.publicKey;
  } catch (error) {
    console.error('[KeyStore] Failed to fetch public key:', error);
    return null;
  }
}

/**
 * Get a public key, using cache first, then fetching from API
 *
 * @param walletAddress - Solana wallet address
 * @returns Public key or null if not found
 */
export async function getPublicKey(
  walletAddress: string
): Promise<string | null> {
  // Try cache first
  const cached = getCachedPublicKey(walletAddress);
  if (cached) {
    return cached;
  }

  // Fetch from API
  return fetchPublicKey(walletAddress);
}

/**
 * Batch fetch public keys for multiple wallet addresses
 *
 * @param walletAddresses - Array of Solana wallet addresses
 * @returns Map of wallet address to public key
 */
export async function getPublicKeys(
  walletAddresses: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toFetch: string[] = [];

  // Check cache first
  for (const address of walletAddresses) {
    const cached = getCachedPublicKey(address);
    if (cached) {
      result.set(address, cached);
    } else {
      toFetch.push(address);
    }
  }

  // Batch fetch missing keys
  if (toFetch.length > 0) {
    try {
      const response = await fetch('/api/users/public-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddresses: toFetch }),
      });

      if (response.ok) {
        const data: UserKeyInfo[] = await response.json();

        for (const user of data) {
          if (user.publicKey && isValidPublicKey(user.publicKey)) {
            cachePublicKey(user.walletAddress, user.publicKey);
            result.set(user.walletAddress, user.publicKey);
          }
        }
      }
    } catch (error) {
      console.error('[KeyStore] Failed to batch fetch public keys:', error);
    }
  }

  return result;
}

// ============================================================================
// Channel Key Storage
// ============================================================================

/**
 * Get all stored channel keys from localStorage
 */
function getStoredChannelKeys(): ChannelKeyEntry[] {
  if (!isBrowser()) return [];

  try {
    const stored = localStorage.getItem(CHANNEL_KEYS_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);

    // Validate the parsed data is an array
    if (!Array.isArray(parsed)) {
      console.error('[KeyStore] Invalid channel keys format - expected array');
      localStorage.removeItem(CHANNEL_KEYS_KEY);
      return [];
    }

    // Validate each entry structure
    const validKeys = parsed.filter((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return false;
      const e = entry as Partial<ChannelKeyEntry>;
      return !!(e.channelId && e.encryptedKey && e.nonce && typeof e.createdAt === 'number');
    });

    // If some entries were invalid, update storage with valid ones only
    if (validKeys.length !== parsed.length) {
      console.warn(`[KeyStore] Removed ${parsed.length - validKeys.length} invalid channel key entries`);
      try {
        localStorage.setItem(CHANNEL_KEYS_KEY, JSON.stringify(validKeys));
      } catch {
        // Ignore storage errors
      }
    }

    return validKeys as ChannelKeyEntry[];
  } catch (error) {
    console.error('[KeyStore] Failed to load channel keys:', error);
    // Clear corrupted data
    try {
      localStorage.removeItem(CHANNEL_KEYS_KEY);
    } catch {
      // Ignore cleanup errors
    }
    return [];
  }
}

/**
 * Save channel keys to localStorage
 */
function saveChannelKeys(keys: ChannelKeyEntry[]): void {
  if (!isBrowser()) return;

  try {
    localStorage.setItem(CHANNEL_KEYS_KEY, JSON.stringify(keys));
  } catch (error) {
    console.error('[KeyStore] Failed to save channel keys:', error);
  }
}

/**
 * Store a channel key (encrypted with the user's keypair)
 *
 * @param channelId - Channel ID
 * @param channelKey - Base64-encoded channel symmetric key
 * @param userPublicKey - User's public key for encryption
 * @param userSecretKey - User's secret key for encryption
 * @returns Success status
 */
export function storeChannelKey(
  channelId: string,
  channelKey: string,
  userPublicKey: string,
  userSecretKey: string
): KeyOperationResult<void> {
  try {
    // Encrypt the channel key with the user's own keypair
    // This ensures only the user can decrypt their stored channel keys
    const encrypted = encryptForKeyExchange(
      channelKey,
      userPublicKey,
      userSecretKey
    );

    if (!encrypted) {
      return { success: false, error: 'Failed to encrypt channel key' };
    }

    const entry: ChannelKeyEntry = {
      channelId,
      encryptedKey: encrypted.encrypted,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    };

    // Update storage
    const keys = getStoredChannelKeys();
    const existingIndex = keys.findIndex((k) => k.channelId === channelId);

    if (existingIndex >= 0) {
      keys[existingIndex] = entry;
    } else {
      keys.push(entry);
    }

    saveChannelKeys(keys);
    return { success: true };
  } catch (error) {
    console.error('[KeyStore] Failed to store channel key:', error);
    return { success: false, error: 'Failed to store channel key' };
  }
}

/**
 * Retrieve a channel key
 *
 * @param channelId - Channel ID
 * @param userPublicKey - User's public key
 * @param userSecretKey - User's secret key for decryption
 * @returns Decrypted channel key or null
 */
export function getChannelKey(
  channelId: string,
  userPublicKey: string,
  userSecretKey: string
): string | null {
  try {
    const keys = getStoredChannelKeys();
    const entry = keys.find((k) => k.channelId === channelId);

    if (!entry) {
      return null;
    }

    // Decrypt the channel key
    const channelKey = decryptFromKeyExchange(
      entry.encryptedKey,
      entry.nonce,
      userPublicKey,
      userSecretKey
    );

    return channelKey;
  } catch (error) {
    console.error('[KeyStore] Failed to retrieve channel key:', error);
    return null;
  }
}

/**
 * Remove a channel key from storage
 *
 * @param channelId - Channel ID
 */
export function removeChannelKey(channelId: string): void {
  const keys = getStoredChannelKeys();
  const filtered = keys.filter((k) => k.channelId !== channelId);
  saveChannelKeys(filtered);
}

/**
 * Clear all stored channel keys
 */
export function clearChannelKeys(): void {
  if (isBrowser()) {
    localStorage.removeItem(CHANNEL_KEYS_KEY);
  }
}

/**
 * Get all channel IDs that the user has keys for
 */
export function getStoredChannelIds(): string[] {
  const keys = getStoredChannelKeys();
  return keys.map((k) => k.channelId);
}

// ============================================================================
// Key Exchange Helpers
// ============================================================================

/**
 * Prepare a channel key for sharing with a new member
 *
 * @param channelKey - Base64-encoded channel symmetric key
 * @param recipientPublicKey - New member's public key
 * @param senderSecretKey - Current member's secret key
 * @returns Encrypted key package for the recipient
 */
export function prepareChannelKeyForMember(
  channelKey: string,
  recipientPublicKey: string,
  senderSecretKey: string
): KeyOperationResult<{ encrypted: string; nonce: string }> {
  try {
    const encrypted = encryptForKeyExchange(
      channelKey,
      recipientPublicKey,
      senderSecretKey
    );

    if (!encrypted) {
      return { success: false, error: 'Failed to encrypt channel key for member' };
    }

    return {
      success: true,
      data: {
        encrypted: encrypted.encrypted,
        nonce: encrypted.nonce,
      },
    };
  } catch (error) {
    console.error('[KeyStore] Failed to prepare channel key for member:', error);
    return { success: false, error: 'Failed to prepare channel key' };
  }
}

/**
 * Accept a channel key shared by another member
 *
 * @param encryptedKey - Encrypted channel key
 * @param nonce - Nonce used for encryption
 * @param senderPublicKey - Public key of the member who shared the key
 * @param recipientSecretKey - Your secret key
 * @returns Decrypted channel key
 */
export function acceptChannelKey(
  encryptedKey: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string
): string | null {
  return decryptFromKeyExchange(
    encryptedKey,
    nonce,
    senderPublicKey,
    recipientSecretKey
  );
}

// ============================================================================
// Export cleanup utility
// ============================================================================

/**
 * Clear all stored keys (for logout)
 */
export function clearAllKeys(): void {
  clearPublicKeyCache();
  clearChannelKeys();
}
