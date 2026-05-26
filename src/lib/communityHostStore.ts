/**
 * Per-community host map: `<communityId>` → `<onion>` of the host whose
 * relay actually owns the community.
 *
 * Populated by the join flow (`Dashboard.handleJoinCommunity`) and read
 * by community/channel/DM pages so they know whether to talk to the
 * local relay (`localhost:3001`) or route through the onion proxy
 * (`localhost:11811/o/<onion>/...`).
 *
 * Stored in localStorage so a remote community sticks around across tab
 * closes — without this, the user would have to re-enter the invite
 * after every reload. The map is per-browser, not per-session.
 */

const STORAGE_PREFIX = 'voidchat_host:';

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Record that `<communityId>` is hosted on `<onion>`. Pass null to
 *  clear (e.g. user leaves a cross-host community). */
export function setCommunityHost(communityId: string, onion: string | null): void {
  const store = safeStorage();
  if (!store) return;
  const key = `${STORAGE_PREFIX}${communityId}`;
  try {
    if (onion) {
      store.setItem(key, onion);
    } else {
      store.removeItem(key);
    }
  } catch {
    /* private mode etc. — silently degrade to in-memory */
  }
}

/** Return the onion that hosts this community, or null if it's local
 *  (or we have no record — defaulting to local is the legacy behavior). */
export function getCommunityHost(communityId: string): string | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    return store.getItem(`${STORAGE_PREFIX}${communityId}`);
  } catch {
    return null;
  }
}
