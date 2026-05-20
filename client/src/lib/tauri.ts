/**
 * Tauri bridge — wraps invoke() calls to Rust commands.
 * Falls back gracefully when running in a browser (dev without Tauri).
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    throw new Error(`Tauri not available — cannot invoke "${cmd}"`);
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// =============================================================================
// KEYRING
// =============================================================================

export const keyring = {
  async store(key: string, value: string): Promise<void> {
    await invoke('keyring_store', { key, value });
  },

  async get(key: string): Promise<string | null> {
    return invoke<string | null>('keyring_get', { key });
  },

  async delete(key: string): Promise<void> {
    await invoke('keyring_delete', { key });
  },
};

// =============================================================================
// LOCAL MESSAGE STORAGE
// =============================================================================

export interface StoredMessage {
  id: string;
  channel_id: string | null;
  recipient_id: string | null;
  sender_id: string;
  encrypted_content: string;
  nonce: string;
  timestamp: number;
  is_dm: boolean;
}

export const localMessages = {
  async store(message: StoredMessage): Promise<void> {
    await invoke('store_message', { message });
  },

  async getChannelMessages(
    channelId: string,
    limit: number = 50,
    beforeTimestamp?: number
  ): Promise<StoredMessage[]> {
    return invoke<StoredMessage[]>('get_channel_messages', {
      channelId,
      limit,
      beforeTimestamp: beforeTimestamp ?? null,
    });
  },

  async getDmMessages(
    userId: string,
    otherId: string,
    limit: number = 50,
    beforeTimestamp?: number
  ): Promise<StoredMessage[]> {
    return invoke<StoredMessage[]>('get_dm_messages', {
      userId,
      otherId,
      limit,
      beforeTimestamp: beforeTimestamp ?? null,
    });
  },

  async deleteBefore(beforeTimestamp: number): Promise<number> {
    return invoke<number>('delete_messages_before', { beforeTimestamp });
  },

  async clearAll(): Promise<void> {
    await invoke('clear_all_local_data');
  },
};

// =============================================================================
// KEY CACHE
// =============================================================================

export const keyCache = {
  async set(publicId: string, publicKey: string): Promise<void> {
    await invoke('cache_public_key', { publicId, publicKey });
  },

  async get(publicId: string): Promise<string | null> {
    return invoke<string | null>('get_cached_key', { publicId });
  },
};

// =============================================================================
// NOTIFICATIONS (via Tauri plugin)
// =============================================================================

export const tauriNotifications = {
  async send(title: string, body?: string): Promise<void> {
    if (!isTauri) return;
    const {
      isPermissionGranted,
      requestPermission,
      sendNotification,
    } = await import('@tauri-apps/plugin-notification');

    let permitted = await isPermissionGranted();
    if (!permitted) {
      const result = await requestPermission();
      permitted = result === 'granted';
    }
    if (permitted) {
      sendNotification({ title, body });
    }
  },
};

// =============================================================================
// UTILITY
// =============================================================================

export { isTauri };
