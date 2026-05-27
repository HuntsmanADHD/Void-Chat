/**
 * Per-machine cache of delete-tokens issued by the relay when a
 * community is created without a password. Audit pt6 C2: without
 * this, any joiner who learned the community ID could DELETE the
 * community via the API. The relay now issues a one-time
 * delete-token at create time; the creator stores it here and
 * presents it in the same `x-community-password` header on DELETE.
 *
 * Lives in localStorage (NOT sessionStorage) so the creator can
 * still delete their community after closing the tab. Trade-off:
 * losing the browser profile or clearing site data = losing
 * delete authority for any community created without a password.
 * Wiping is the user's choice; the alternative (sessionStorage)
 * would mean every delete required re-creating the community.
 *
 * Storage shape: a single JSON object keyed by community id →
 * token string. Single entry keeps the localStorage surface small
 * and easy to inspect/clear by hand.
 */

const STORAGE_KEY = 'voidchat_community_delete_tokens_v1';

type Store = Record<string, string>;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function readStore(): Store {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Sanity-filter: only accept string→string entries.
    const out: Store = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded, disabled, or private-mode browser. Tokens are
    // recoverable only if persisted somewhere — we can't substitute.
  }
}

export function setDeleteToken(communityId: string, token: string): void {
  const store = readStore();
  store[communityId] = token;
  writeStore(store);
}

export function getDeleteToken(communityId: string): string | null {
  const store = readStore();
  return store[communityId] ?? null;
}

export function clearDeleteToken(communityId: string): void {
  const store = readStore();
  if (!(communityId in store)) return;
  delete store[communityId];
  writeStore(store);
}

/**
 * Build the auth headers for a community DELETE: prefer a per-tab
 * password (if the user has typed one) over the persisted delete-token.
 * The same header (`x-community-password`) carries either credential
 * — the relay's `verify_credential` runs argon2id against whatever's
 * stored (password_hash OR delete_token_hash). Returns `{}` when no
 * credential is available locally, which the relay will reject with
 * 401 — exactly the audit pt6 C2 behavior we want.
 */
export function communityDeleteAuthHeaders(
  communityId: string,
  password: string | null,
): Record<string, string> {
  const pw = password && password.length > 0 ? password : null;
  const credential = pw ?? getDeleteToken(communityId);
  return credential ? { 'x-community-password': credential } : {};
}
