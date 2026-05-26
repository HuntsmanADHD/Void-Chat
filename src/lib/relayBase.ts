/**
 * Endpoint resolution for the relay (HTTP + WebSocket).
 *
 * Two shapes:
 *   - Local: `http://localhost:3001/api/...`. The relay is a sidecar of
 *     this app instance, so all calls for communities we host go here.
 *   - Cross-host: `http://localhost:11811/o/<onion>/api/...`. The Rust
 *     forward proxy (src-tauri/src/proxy.rs) opens a SOCKS5 connection
 *     to Tor and dials the remote relay at `<onion>:80` on our behalf.
 *     The same base URL works for socket.io — when socket.io appends
 *     `/socket.io/?...` the proxy still parses the request and pumps
 *     bytes after the WebSocket upgrade.
 *
 * Per-community routing is decided by `getCommunityHost(id)` in
 * `communityHostStore.ts`; callers usually go through `apiUrlFor(id)`
 * or `relayBaseFor(id)`.
 */

import { getCommunityHost } from './communityHostStore';

const RELAY_PORT = 3001;
const PROXY_PORT = 11811;

export const HTTP_RELAY_BASE = `http://localhost:${RELAY_PORT}`;
const HTTP_PROXY_BASE = `http://localhost:${PROXY_PORT}`;

function joinPath(base: string, path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Resolve a relative API path against the local relay. Use this only
 *  when you know the call is local (e.g. /api/communities listing, which
 *  hits the local relay regardless). For per-community calls, prefer
 *  apiUrlFor(communityId, path). */
export function apiUrl(path: string): string {
  return joinPath(HTTP_RELAY_BASE, path);
}

/** Resolve a relative API path against the appropriate relay for the
 *  given community. If the community lives on a remote .onion, returns
 *  the proxy URL; otherwise returns the local relay URL. */
export function apiUrlFor(communityId: string, path: string): string {
  const onion = getCommunityHost(communityId);
  if (!onion) return apiUrl(path);
  return joinPath(HTTP_PROXY_BASE, `/o/${onion}${path.startsWith('/') ? path : `/${path}`}`);
}

/** Compute the realtime (socket.io) base URL for a community. socket.io
 *  appends its own `/socket.io/...` paths, and the proxy treats those
 *  same as any other HTTP path. Returns the local relay if community is
 *  local or unknown. */
export function relayBaseFor(communityId: string | null): string {
  if (!communityId) return HTTP_RELAY_BASE;
  const onion = getCommunityHost(communityId);
  if (!onion) return HTTP_RELAY_BASE;
  return `${HTTP_PROXY_BASE}/o/${onion}`;
}
