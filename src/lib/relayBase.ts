/**
 * Where the bundled relay process lives, both in dev and in production
 * Tauri builds. Always on localhost:3001 — the relay is a sidecar of
 * whichever app instance is running.
 *
 * In Phase 3 the HTTP base goes away entirely: community/channel CRUD
 * becomes Tauri Rust commands invoked via `invoke()`, no HTTP between
 * the webview and native side. This helper exists so the migration is
 * one find-and-replace.
 */

const RELAY_PORT = 3001;

export const HTTP_RELAY_BASE = `http://localhost:${RELAY_PORT}`;

/** Resolve a relative API path to the full relay URL. */
export function apiUrl(path: string): string {
  return `${HTTP_RELAY_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
