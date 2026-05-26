/**
 * Per-session IndexedDB store for received + sent plaintext messages.
 *
 * Scope: persistence across reload within the same browser tab session.
 * NOT cross-session — the store is namespaced by the session's box public
 * key, so closing the tab (which wipes sessionStorage) effectively
 * orphans the old DB. We keep at most one prior DB around (the active
 * session's) and let the browser GC older ones when storage pressure hits.
 *
 * The relay never sees plaintext; this store does. If you wanted at-rest
 * encryption you'd seal entries with a key derived from the session
 * secret. For v1 we accept that anyone with filesystem access to the
 * browser profile can read these — same threat model as any web app.
 */

const DB_PREFIX = 'voidchat:';
const SCHEMA_VERSION = 1;
const CHANNEL_STORE = 'channelMessages';
const DM_STORE = 'dmMessages';

export interface StoredMessage {
  /** Unique within a topic. Server-issued `m_*` for received, `local-*` for optimistic. */
  id: string;
  /** epoch ms */
  ts: number;
  senderSigningPublicKey: string;
  senderBoxPublicKey: string;
  senderDisplayName: string;
  plaintext: string;
  /** True if this is the sender's own optimistic copy. */
  optimistic?: boolean;
}

let activeDb: IDBDatabase | null = null;
let activeKey: string | null = null;
let opening: Promise<IDBDatabase> | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function dbName(boxPublicKey: string): string {
  return `${DB_PREFIX}${boxPublicKey}`;
}

function openDb(boxPublicKey: string): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName(boxPublicKey), SCHEMA_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHANNEL_STORE)) {
        const store = db.createObjectStore(CHANNEL_STORE, { keyPath: ['topicId', 'id'] });
        store.createIndex('topic_ts', ['topicId', 'ts']);
      }
      if (!db.objectStoreNames.contains(DM_STORE)) {
        const store = db.createObjectStore(DM_STORE, { keyPath: ['topicId', 'id'] });
        store.createIndex('topic_ts', ['topicId', 'ts']);
      }
    };
    req.onsuccess = () => resolve(req.result);
  }).finally(() => {
    opening = null;
  });
  return opening;
}

/**
 * Bind the store to a session. Calling this with a new boxPublicKey closes
 * the previous DB handle and opens a fresh one. Safe to call repeatedly
 * with the same key — it's a no-op when already active.
 */
export async function setActiveSession(boxPublicKey: string): Promise<void> {
  if (!isBrowser()) return;
  if (activeKey === boxPublicKey && activeDb) return;
  if (activeDb) {
    activeDb.close();
    activeDb = null;
  }
  activeKey = boxPublicKey;
  activeDb = await openDb(boxPublicKey);
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  if (!isBrowser() || !activeDb) {
    return Promise.reject(new Error('messageStore: no active session'));
  }
  const tx = activeDb.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await fn(store);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return result;
}

async function append(
  storeName: string,
  topicId: string,
  msg: StoredMessage,
): Promise<void> {
  if (!isBrowser() || !activeDb) return; // silently no-op if not ready
  try {
    await withStore(storeName, 'readwrite', (store) => {
      store.put({ ...msg, topicId });
    });
  } catch (err) {
    console.warn('[messageStore] append failed', err);
  }
}

/**
 * Build a key range covering every entry whose compound key begins with
 * `topicId`, regardless of what type the second slot ends up being.
 *
 *   - Length-1 array `[topicId]` sorts before any length-2 array `[topicId, x]`
 *     (IDB array comparison: shorter wins when one runs out of elements).
 *   - Length-2 array with `[]` in the second slot sorts after every primitive
 *     in that slot, because per IDB key order Array > Binary > String > Date
 *     > Number.
 *
 * Today the index is `[topicId, ts: number]` and an `[Inf]..[+Inf]` range would
 * also match. This shape is the more general one — survives a future schema
 * change to a string or compound second slot without quietly going empty.
 */
function topicRange(topicId: string): IDBKeyRange {
  return IDBKeyRange.bound([topicId], [topicId, []]);
}

async function list(
  storeName: string,
  topicId: string,
  limit: number,
): Promise<StoredMessage[]> {
  if (!isBrowser() || !activeDb) return [];
  try {
    return await withStore(storeName, 'readonly', async (store) => {
      const index = store.index('topic_ts');
      const out: StoredMessage[] = [];
      // Walk newest-first via 'prev' so we can stop as soon as we hit `limit`,
      // then reverse for UI (oldest-first).
      await new Promise<void>((resolve, reject) => {
        const cursorReq = index.openCursor(topicRange(topicId), 'prev');
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || out.length >= limit) {
            resolve();
            return;
          }
          const { topicId: _drop, ...rest } = cursor.value as StoredMessage & { topicId: string };
          void _drop;
          out.push(rest);
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      return out.reverse();
    });
  } catch (err) {
    console.warn('[messageStore] list failed', err);
    return [];
  }
}

export function appendChannel(channelId: string, msg: StoredMessage): Promise<void> {
  return append(CHANNEL_STORE, channelId, msg);
}

export function appendDM(peerSigningKey: string, msg: StoredMessage): Promise<void> {
  return append(DM_STORE, peerSigningKey, msg);
}

export function listChannel(channelId: string, limit = 200): Promise<StoredMessage[]> {
  return list(CHANNEL_STORE, channelId, limit);
}

export function listDM(peerSigningKey: string, limit = 200): Promise<StoredMessage[]> {
  return list(DM_STORE, peerSigningKey, limit);
}

/** Drop a stored topic entirely. Used by "clear chat" UX. */
export async function clearChannel(channelId: string): Promise<void> {
  if (!isBrowser() || !activeDb) return;
  try {
    await withStore(CHANNEL_STORE, 'readwrite', (store) => {
      // `delete` on an object store accepts a key or a key range; the
      // store's primary key is the compound `[topicId, id]`, so the same
      // `[topicId]..[topicId, []]` range that `list()` uses matches every
      // entry under this topic.
      store.delete(topicRange(channelId));
    });
  } catch (err) {
    console.warn('[messageStore] clearChannel failed', err);
  }
}

/** Drop the entire active DB. Used by settings "End Session". */
export async function destroyActiveSession(): Promise<void> {
  if (!isBrowser() || !activeKey) return;
  if (activeDb) {
    activeDb.close();
    activeDb = null;
  }
  const key = activeKey;
  activeKey = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName(key));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // best-effort; another tab holds it
  });
}
