import { useCallback } from 'react';
import { keyring, isTauri } from '@/lib/tauri';

/**
 * Hook for secure key storage via system keyring (macOS Keychain,
 * Windows Credential Manager, Linux Secret Service).
 *
 * Falls back to localStorage when running outside Tauri (dev mode).
 */
export function useKeyring() {
  const FALLBACK_PREFIX = 'voidchat_keyring_';

  const store = useCallback(async (key: string, value: string) => {
    if (isTauri) {
      await keyring.store(key, value);
    } else {
      localStorage.setItem(FALLBACK_PREFIX + key, value);
    }
  }, []);

  const get = useCallback(async (key: string): Promise<string | null> => {
    if (isTauri) {
      return keyring.get(key);
    }
    return localStorage.getItem(FALLBACK_PREFIX + key);
  }, []);

  const remove = useCallback(async (key: string) => {
    if (isTauri) {
      await keyring.delete(key);
    } else {
      localStorage.removeItem(FALLBACK_PREFIX + key);
    }
  }, []);

  return { store, get, remove, isNative: isTauri };
}
