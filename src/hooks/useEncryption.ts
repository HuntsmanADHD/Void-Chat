'use client';

/**
 * Thin convenience hook exposing the session's box public key + a
 * ready flag, useful for UI that wants to display the key or gate
 * rendering until the session has loaded.
 *
 * Actual encryption happens inside `useRealtime` / the relay client,
 * which has access to the per-channel roster needed for fan-out.
 * If you need to encrypt or decrypt directly, import the pure
 * functions from `@/lib/encryption`.
 */

import { useSession } from './useSession';

export interface UseEncryptionReturn {
  isReady: boolean;
  boxPublicKey: string | null;
}

export function useEncryption(): UseEncryptionReturn {
  const { session, isReady } = useSession();
  return {
    isReady,
    boxPublicKey: session?.boxPublicKey ?? null,
  };
}

export default useEncryption;
