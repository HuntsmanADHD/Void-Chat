/**
 * Pinned cross-host communities — opt-in sidebar persistence.
 *
 * Design intent (see THREAT_MODEL "Renderer-side compromise" + the
 * audit pt6 user-perspective analysis):
 *
 *   - Joining a cross-host community is ephemeral by default. The
 *     `communityHostStore` already persists the `<id> → <onion>`
 *     routing map silently in localStorage, but nothing surfaces it
 *     in the sidebar. The user navigates there once, closes the tab,
 *     and (UI-wise) the community is forgotten.
 *
 *   - Pinning is the EXPLICIT user gesture that promotes a cross-host
 *     community to first-class sidebar resident. The Pin button on
 *     the community header writes here; the sidebar reads from here.
 *
 *   - Unpinning removes the sidebar entry AND clears the routing map +
 *     any cached password — the only way the app forgets a cross-host
 *     community completely. This is the cleanup surface the current
 *     architecture is missing.
 *
 *   - We DO NOT auto-refresh metadata on app launch. Doing so would
 *     fan out N silent Tor circuits visible to the local Tor process
 *     and (potentially) ISP-observable timing. The sidebar shows the
 *     last-known name/icon captured at pin time; refresh happens
 *     organically when the user navigates into the community.
 *
 * Storage shape: single localStorage entry holding a JSON array.
 * Keyed by community id; idempotent insert overwrites. Cap at a
 * reasonable number to keep the sidebar manageable.
 */

const STORAGE_KEY = 'voidchat_pinned_cross_host_v1';
const MAX_PINNED = 200;

export interface PinnedCrossHostCommunity {
  /** Community ID (the same opaque string used everywhere else). */
  id: string;
  /** v3 onion hostname that hosts this community. */
  onion: string;
  /** Display name captured at pin time. May go stale if the host
   *  renames; refreshed when the user navigates into the community. */
  name: string;
  /** Avatar data URI captured at pin time (optional). */
  icon?: string;
  /** Whether the community required a password the last time we saw
   *  it. Lets the sidebar render the lock icon without a network hit. */
  isPrivate?: boolean;
  /** Epoch ms — used only to show "added X ago" if we ever want it,
   *  and to give us a sort order. Doesn't affect routing. */
  pinnedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function read(): PinnedCrossHostCommunity[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filter — only accept well-shaped entries. A schema
    // drift between app versions shouldn't crash the sidebar.
    return parsed
      .filter(
        (e): e is PinnedCrossHostCommunity =>
          e &&
          typeof e === 'object' &&
          typeof e.id === 'string' &&
          typeof e.onion === 'string' &&
          typeof e.name === 'string' &&
          typeof e.pinnedAt === 'number',
      )
      .slice(0, MAX_PINNED);
  } catch {
    return [];
  }
}

function write(list: PinnedCrossHostCommunity[]): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_PINNED)));
  } catch {
    /* quota / private mode — silently degrade */
  }
}

export function listPinnedCrossHost(): PinnedCrossHostCommunity[] {
  return read();
}

export function isPinned(id: string): boolean {
  return read().some((e) => e.id === id);
}

/** Add or update the pinned entry for this community. Idempotent —
 *  re-pinning with new metadata overwrites the cached name/icon. */
export function pinCrossHost(entry: Omit<PinnedCrossHostCommunity, 'pinnedAt'>): void {
  const existing = read().filter((e) => e.id !== entry.id);
  existing.unshift({ ...entry, pinnedAt: Date.now() });
  write(existing);
}

/** Remove the pinned entry. Returns true if anything was removed. */
export function unpinCrossHost(id: string): boolean {
  const before = read();
  const after = before.filter((e) => e.id !== id);
  if (after.length === before.length) return false;
  write(after);
  return true;
}

/** Refresh just the cached metadata for an already-pinned entry.
 *  No-op if the community isn't pinned. Used by the community page
 *  after a successful metadata fetch so the sidebar stays current
 *  without us proactively poking N onions on app launch. */
export function refreshPinnedMetadata(
  id: string,
  patch: Partial<Pick<PinnedCrossHostCommunity, 'name' | 'icon' | 'isPrivate'>>,
): void {
  const list = read();
  const idx = list.findIndex((e) => e.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch };
  write(list);
}
