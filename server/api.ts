/**
 * HTTP API handler for the relay process. Mounts on the same Node http
 * server that socket.io attaches to, listening for `/api/*` requests.
 *
 * Endpoints (formerly Next App Router routes):
 *   GET    /api/communities                        — list (paginated)
 *   POST   /api/communities                        — create
 *   GET    /api/communities/:id                    — fetch (pw-gated if private)
 *   DELETE /api/communities/:id                    — delete (pw-gated if private)
 *   GET    /api/communities/:id/channels           — list channels
 *   POST   /api/communities/:id/channels           — create channel
 *
 * Prisma stays for now; Phase 3+ replaces it with Rust/rusqlite via Tauri
 * commands and this file goes away entirely.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { prisma } from '../src/lib/prisma';
import {
  COMMUNITY_PASSWORD_MAX_LEN,
  COMMUNITY_PASSWORD_MIN_LEN,
  hashPassword,
  verifyPassword,
} from '../src/lib/communityPassword';

// ── CORS allowlist ────────────────────────────────────────────────────────

// In production, only the Tauri webview's own origin is legitimate.
// Dev origins (localhost:5173/1420/3000) are added back when running
// `yarn dev:all` — the dev:all script sets CORS_ORIGIN explicitly via
// env so the relay accepts the Vite dev server's fetches.
//
// Why this matters: even on a loopback-bound listener, any local
// process that can bind one of the dev ports (e.g. another app's
// Vite default :5173) could pose as a legit Tauri webview by setting
// the right Origin header and exfiltrate community/channel metadata.
// Tightening the prod default removes that handle without breaking
// any user-facing flow.
const PRODUCTION_DEFAULT_CORS =
  'tauri://localhost,https://tauri.localhost,http://tauri.localhost';
const CORS_RAW = process.env['CORS_ORIGIN'] || PRODUCTION_DEFAULT_CORS;
const CORS_ALLOW_ANY = CORS_RAW.trim() === '*';
const CORS_ORIGINS = new Set(CORS_RAW.split(',').map(o => o.trim()).filter(Boolean));

/**
 * Earlier versions accepted any `*.onion` origin on the theory that
 * reaching the relay over Tor already proved the caller had the onion
 * address. That reasoning was wrong: the relay is also bound to
 * localhost (3001), so any local process could send a request with a
 * forged `Origin: http://something.onion` header and trip the permissive
 * ACAO branch — letting same-machine malware read community + channel
 * metadata.
 *
 * Cross-host flow doesn't need the .onion allowance: the local proxy
 * forwards Origin from the webview unchanged, so legitimate cross-host
 * requests arrive at the remote relay with `Origin: tauri://localhost`
 * (or whatever the peer's webview origin is), which is already in
 * `CORS_ORIGINS`. The allowance was vestigial.
 */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin || '';
  if (CORS_ALLOW_ANY) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else if (CORS_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-community-password');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── Rate limit (IP-keyed, in-memory) ──────────────────────────────────────

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Daily budget on inline-image bytes accepted via community-create
 * avatars. Without a global cap, a malicious joiner (in the cross-host
 * model the SQLite file lives on the *host's* disk) could spam community
 * creates with 256 KiB avatars at the rate-limit ceiling and fill the
 * host's disk: 60/min × 256 KiB = 15 MiB/min = 21 GiB/day per IP, and
 * IP-keying on loopback collapses to one bucket on a Tor-fronted host.
 *
 * Budget resets every 24h. Conservative — 50 MiB/day = ~200 large
 * avatars; a real friend-group host creates a handful per day. The
 * resulting "host capacity" error lands at the same layer as the
 * other 429s so existing client error paths handle it.
 */
const AVATAR_DAILY_BUDGET_BYTES = 50 * 1024 * 1024;
let avatarBytesThisWindow = 0;
let avatarWindowStartMs = Date.now();

function avatarBudgetAllows(size: number): boolean {
  const now = Date.now();
  if (now - avatarWindowStartMs > 24 * 60 * 60 * 1000) {
    avatarBytesThisWindow = 0;
    avatarWindowStartMs = now;
  }
  if (avatarBytesThisWindow + size > AVATAR_DAILY_BUDGET_BYTES) return false;
  avatarBytesThisWindow += size;
  return true;
}

function rateAllowed(key: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count++;
  return { ok: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (v.resetAt < now) rateBuckets.delete(k);
}, RATE_WINDOW_MS);

function clientIp(req: IncomingMessage): string {
  // Deliberately ignore `X-Forwarded-For`. The relay is pinned to
  // loopback (see socket-server.ts) — any connection has to come
  // through 127.0.0.1, either from the local renderer / Tauri proxy
  // or from the Tor hidden-service in-port. There is no legitimate
  // upstream proxy to trust.
  //
  // Trusting XFF here would let any local process (or any caller
  // through the .onion) forge an arbitrary IP via the header to
  // evade the per-IP rate-limit buckets — defeating the only
  // throttle we have against abuse.
  return req.socket.remoteAddress || 'unknown';
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sanitize(input: string, maxLen: number): string {
  return input.replace(/\0/g, '').trim().slice(0, maxLen);
}

/**
 * Whitelist for image inputs accepted into the directory (avatars,
 * banners). Only inline base64 data URIs of common raster formats are
 * allowed — `http://` / `https://` and `javascript:` are rejected.
 *
 * Background: a remote-URL avatar would be loaded by every joiner's
 * webview via plain <img src>, which goes straight over clearnet and
 * unmasks the user's real IP. The whole point of running on Tor is
 * defeated by a single rogue community owner setting a tracking pixel
 * as their avatar.
 */
function isAllowedDataImageUri(value: string): boolean {
  // Cheap shape check first so we don't run the regex on giant inputs.
  if (!value.startsWith('data:image/')) return false;
  return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function err(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

async function readBody(req: IncomingMessage, max = 512 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > max) {
        reject(new Error('payload-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      // Yield to the event loop before parsing. JSON.parse on a 512KB
      // body blocks the loop for ~5-10ms; under load this stalls every
      // other in-flight request including the socket.io WebSocket
      // pings. setImmediate gives the loop a tick to drain queued
      // network events between accept and parse.
      setImmediate(() => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('invalid-json'));
        }
      });
    });
    req.on('error', reject);
  });
}

async function gateCommunity(
  req: IncomingMessage,
  passwordHash: string | null,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (passwordHash === null) return { ok: true };
  const provided = (req.headers['x-community-password'] as string | undefined) || '';
  if (!provided) return { ok: false, status: 401, message: 'Password required' };
  const valid = await verifyPassword(provided, passwordHash);
  if (!valid) return { ok: false, status: 401, message: 'Invalid password' };
  return { ok: true };
}

// ── Route handlers ────────────────────────────────────────────────────────

async function listCommunities(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const skip = (page - 1) * limit;

  const [communities, total] = await Promise.all([
    prisma.community.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { channels: true } } },
    }),
    prisma.community.count(),
  ]);

  json(res, 200, {
    communities: communities.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      avatar: c.avatar,
      channelCount: c._count.channels,
      isPrivate: c.passwordHash !== null,
      createdAt: c.createdAt.toISOString(),
    })),
    total,
  });
}

async function createCommunity(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rate = rateAllowed(`community-create:${clientIp(req)}`);
  if (!rate.ok) return err(res, 429, `Rate limit exceeded. Retry after ${rate.retryAfter} seconds`);

  let body: any;
  try {
    body = await readBody(req);
  } catch (e: any) {
    return err(res, e?.message === 'payload-too-large' ? 413 : 400, 'Invalid request body');
  }

  const name = sanitize(String(body.name || ''), 64);
  const description = body.description ? sanitize(String(body.description), 500) : null;
  const avatar = body.avatar ? sanitize(String(body.avatar), 256 * 1024) : null;
  const rawPassword = typeof body.password === 'string' ? body.password : '';

  if (name.length < 2 || name.length > 64) return err(res, 400, 'Community name must be 2–64 characters');
  if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
    return err(res, 400, 'Community name may only contain letters, numbers, spaces, _ and -');
  }
  // Avatar must be an inline data: URI — never an http/https URL.
  // Storing a remote URL would make every joiner's webview fetch it
  // straight over the open internet (the renderer can't route fetches
  // through Tor without help), unmasking the user's IP to whoever
  // controls the URL. The Create modal already emits data URIs from
  // a FileReader, so this only rejects malicious inputs.
  if (avatar !== null && !isAllowedDataImageUri(avatar)) {
    return err(res, 400, 'Avatar must be an inline data:image/(png|jpeg|webp|gif);base64 URI');
  }
  if (avatar !== null && !avatarBudgetAllows(avatar.length)) {
    return err(res, 429, 'Avatar storage budget reached — retry tomorrow or create without an avatar');
  }

  let passwordHash: string | null = null;
  if (rawPassword) {
    if (rawPassword.length < COMMUNITY_PASSWORD_MIN_LEN || rawPassword.length > COMMUNITY_PASSWORD_MAX_LEN) {
      return err(res, 400, `Password must be ${COMMUNITY_PASSWORD_MIN_LEN}–${COMMUNITY_PASSWORD_MAX_LEN} characters`);
    }
    passwordHash = await hashPassword(rawPassword);
  }

  try {
    const community = await prisma.community.create({
      data: {
        name,
        description,
        avatar,
        passwordHash,
        channels: { create: [{ name: 'general', isDefault: true }] },
      },
      include: { channels: true },
    });
    json(res, 201, {
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      isPrivate: community.passwordHash !== null,
      channels: community.channels.map((ch) => ({ id: ch.id, name: ch.name, isDefault: ch.isDefault })),
      createdAt: community.createdAt.toISOString(),
    });
  } catch (e: any) {
    if (e?.code === 'P2002') return err(res, 409, 'A community with that name already exists');
    console.error('[api] create community failed:', e);
    err(res, 500, 'Internal server error');
  }
}

async function getCommunity(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const community = await prisma.community.findUnique({
    where: { id },
    include: {
      channels: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, description: true, isDefault: true },
      },
    },
  });
  if (!community) return err(res, 404, 'Community not found');
  const gate = await gateCommunity(req, community.passwordHash);
  if (!gate.ok) return err(res, gate.status, gate.message);
  json(res, 200, {
    id: community.id,
    name: community.name,
    description: community.description,
    avatar: community.avatar,
    isPrivate: community.passwordHash !== null,
    channels: community.channels,
    createdAt: community.createdAt.toISOString(),
  });
}

async function deleteCommunity(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const rate = rateAllowed(`community-delete:${clientIp(req)}`);
  if (!rate.ok) return err(res, 429, `Rate limit exceeded. Retry after ${rate.retryAfter} seconds`);
  const community = await prisma.community.findUnique({
    where: { id },
    select: { id: true, passwordHash: true },
  });
  if (!community) return err(res, 404, 'Community not found');
  const gate = await gateCommunity(req, community.passwordHash);
  if (!gate.ok) return err(res, gate.status, gate.message);
  await prisma.community.delete({ where: { id } });
  json(res, 200, { deleted: id });
}

async function ensureCommunityAccess(
  req: IncomingMessage,
  communityId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { id: true, passwordHash: true },
  });
  if (!community) return { ok: false, status: 404, message: 'Community not found' };
  return gateCommunity(req, community.passwordHash);
}

async function listChannels(req: IncomingMessage, res: ServerResponse, communityId: string): Promise<void> {
  const gate = await ensureCommunityAccess(req, communityId);
  if (!gate.ok) return err(res, gate.status, gate.message);
  const channels = await prisma.channel.findMany({
    where: { communityId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, description: true, isDefault: true, createdAt: true },
  });
  json(res, 200, {
    channels: channels.map((ch) => ({ ...ch, createdAt: ch.createdAt.toISOString() })),
  });
}

async function createChannel(req: IncomingMessage, res: ServerResponse, communityId: string): Promise<void> {
  const rate = rateAllowed(`channel-create:${clientIp(req)}`);
  if (!rate.ok) return err(res, 429, `Rate limit exceeded. Retry after ${rate.retryAfter} seconds`);
  const gate = await ensureCommunityAccess(req, communityId);
  if (!gate.ok) return err(res, gate.status, gate.message);

  let body: any;
  try {
    body = await readBody(req);
  } catch (e: any) {
    return err(res, e?.message === 'payload-too-large' ? 413 : 400, 'Invalid request body');
  }

  const name = sanitize(String(body.name || ''), 32);
  const description = body.description ? sanitize(String(body.description), 200) : null;
  if (name.length < 1 || name.length > 32) return err(res, 400, 'Channel name must be 1–32 characters');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return err(res, 400, 'Channel name may only contain letters, numbers, _ and -');
  }

  try {
    const channel = await prisma.channel.create({ data: { name, description, communityId } });
    json(res, 201, {
      id: channel.id,
      name: channel.name,
      description: channel.description,
      isDefault: channel.isDefault,
      createdAt: channel.createdAt.toISOString(),
    });
  } catch (e: any) {
    if (e?.code === 'P2002') return err(res, 409, 'A channel with that name already exists in this community');
    console.error('[api] create channel failed:', e);
    err(res, 500, 'Internal server error');
  }
}

// ── Top-level router ──────────────────────────────────────────────────────

/**
 * Entry called by the relay's httpServer 'request' listener. Returns true
 * if this request matched an /api/* route (whether or not it succeeded);
 * the caller skips its fallback when we return true.
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url || '';
  if (!url.startsWith('/api/')) return false;

  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    const path = url.split('?')[0] || '';
    if (path === '/api/communities') {
      if (req.method === 'GET') await listCommunities(req, res);
      else if (req.method === 'POST') await createCommunity(req, res);
      else err(res, 405, 'Method not allowed');
      return true;
    }
    const channelsMatch = path.match(/^\/api\/communities\/([^/]+)\/channels$/);
    if (channelsMatch) {
      const id = channelsMatch[1]!;
      if (req.method === 'GET') await listChannels(req, res, id);
      else if (req.method === 'POST') await createChannel(req, res, id);
      else err(res, 405, 'Method not allowed');
      return true;
    }
    const idMatch = path.match(/^\/api\/communities\/([^/]+)$/);
    if (idMatch) {
      const id = idMatch[1]!;
      if (req.method === 'GET') await getCommunity(req, res, id);
      else if (req.method === 'DELETE') await deleteCommunity(req, res, id);
      else err(res, 405, 'Method not allowed');
      return true;
    }
    err(res, 404, 'Not found');
  } catch (e) {
    console.error('[api] handler crashed:', e);
    if (!res.headersSent) err(res, 500, 'Internal server error');
  }
  return true;
}
