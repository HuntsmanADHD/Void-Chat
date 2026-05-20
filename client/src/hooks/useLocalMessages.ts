import { useCallback } from 'react';
import { localMessages, isTauri, type StoredMessage } from '@/lib/tauri';

/**
 * Hook for local message storage via SQLite (Tauri) or IndexedDB fallback.
 * Messages are stored encrypted — the app decrypts them on read.
 */
export function useLocalMessages() {
  const storeMessage = useCallback(async (message: StoredMessage) => {
    if (!isTauri) return; // No-op in browser dev mode
    await localMessages.store(message);
  }, []);

  const getChannelMessages = useCallback(
    async (channelId: string, limit = 50, beforeTimestamp?: number) => {
      if (!isTauri) return [];
      return localMessages.getChannelMessages(channelId, limit, beforeTimestamp);
    },
    []
  );

  const getDmMessages = useCallback(
    async (userId: string, otherId: string, limit = 50, beforeTimestamp?: number) => {
      if (!isTauri) return [];
      return localMessages.getDmMessages(userId, otherId, limit, beforeTimestamp);
    },
    []
  );

  const deleteBefore = useCallback(async (beforeTimestamp: number) => {
    if (!isTauri) return 0;
    return localMessages.deleteBefore(beforeTimestamp);
  }, []);

  const clearAll = useCallback(async () => {
    if (!isTauri) return;
    await localMessages.clearAll();
  }, []);

  return {
    storeMessage,
    getChannelMessages,
    getDmMessages,
    deleteBefore,
    clearAll,
    isNative: isTauri,
  };
}
