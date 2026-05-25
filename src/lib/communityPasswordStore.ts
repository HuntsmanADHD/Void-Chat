'use client';

/**
 * Per-tab cache of community passwords the user has entered, so they
 * aren't re-prompted every navigation within the same session. Lives in
 * sessionStorage — gone on tab close, gone on End-Session.
 *
 * Keyed by community id. The password itself is never sent to the relay,
 * only to the Next API routes via the `x-community-password` header.
 */

const KEY_PREFIX = 'voidchat_pw:';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getCommunityPassword(id: string): string | null {
  if (!isBrowser()) return null;
  try {
    return sessionStorage.getItem(KEY_PREFIX + id);
  } catch {
    return null;
  }
}

export function setCommunityPassword(id: string, password: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(KEY_PREFIX + id, password);
  } catch {
    // sessionStorage quota or disabled; nothing actionable.
  }
}

export function clearCommunityPassword(id: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(KEY_PREFIX + id);
  } catch {
    // ignore
  }
}

/** Build fetch headers with the cached password for this community. */
export function communityAuthHeaders(id: string): Record<string, string> {
  const pw = getCommunityPassword(id);
  return pw ? { 'x-community-password': pw } : {};
}
