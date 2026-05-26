/**
 * Invite-code format for cross-host community joins.
 *
 * Pre-Tor invites were bare community IDs (e.g. `clx7abc123`) that only
 * resolved against the local relay. With hidden services, an invite must
 * also carry the host's .onion so the joiner knows where to dial.
 *
 * Wire format: `<communityId>@<onion>`
 *   - `<communityId>` — the same cuid as before (URL-safe, no `@`).
 *   - `<onion>` — 56-char base32 + `.onion` suffix (v3 hidden service).
 *
 * Legacy bare-ID invites still parse — `onion` is null and the joiner
 * uses the local relay. That keeps single-host setups working unchanged.
 */

const ONION_RE = /^[a-z2-7]{56}\.onion$/;

export interface ParsedInvite {
  communityId: string;
  /** null = legacy/local invite, no host specified */
  onion: string | null;
}

/**
 * Parse a user-supplied invite string. Returns null if it can't be
 * interpreted as either a bare community ID or a `<id>@<onion>` combo.
 */
export function parseInvite(raw: string): ParsedInvite | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1) {
    return { communityId: trimmed, onion: null };
  }

  const communityId = trimmed.slice(0, atIdx).trim();
  const onion = trimmed.slice(atIdx + 1).trim().toLowerCase();
  if (!communityId) return null;
  if (!ONION_RE.test(onion)) return null;

  return { communityId, onion };
}

/**
 * Format an invite for sharing. `onion` may be null when the host's Tor
 * service isn't ready yet — callers should generally wait, but emitting
 * a bare-ID invite is safe (recipient on the same host can still join).
 */
export function formatInvite(communityId: string, onion: string | null): string {
  if (!onion) return communityId;
  return `${communityId}@${onion}`;
}

/** Quick sanity test — used by the join UI to decide whether to even
 *  attempt a network resolution before bothering the user. */
export function looksLikeInvite(raw: string): boolean {
  return parseInvite(raw) !== null;
}
