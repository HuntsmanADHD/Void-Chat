# Void Chat — Rework Progress

## Vision

Anonymous, decentralized messaging platform where:
- Your wallet is your only identity
- No centralized server authority
- Each community is a self-governing ecosystem
- Every member is equal — no admins, no hierarchy
- Bad actors are removed by community consensus, not authority
- Users banned from enough communities get platform-banned automatically

---

## Phase 1 — Cleanup (COMPLETED)

### Removed: X/Twitter Integration
All X/Twitter account linking has been stripped from the codebase. Void Chat is wallet-only.

**Files deleted:**
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth OAuth handler
- `src/app/api/auth/x/link/route.ts` — X account linking API
- `src/app/api/auth/x/unlink/route.ts` — X account unlinking API
- `src/app/api/auth/x/status/route.ts` — X link status API
- `src/app/auth/x-link/page.tsx` — X linking page
- `src/app/auth/x-link/complete/page.tsx` — X linking completion page
- `src/app/auth/x-link/error/page.tsx` — X linking error page
- `src/components/auth/XLinkButton.tsx` — X link UI component
- `src/hooks/useXAuth.ts` — X auth hook

**Fields removed from database schema (`prisma/schema.prisma`):**
- `xHandle` (String, unique) from User model
- `xId` (String, unique) from User model

**Dependency removed from `package.json`:**
- `next-auth` — no longer needed

**Code stripped from 40+ files:**
- All `xHandle`, `xId`, `xVerified`, `senderXHandle` references removed from:
  - API route responses and database queries
  - TypeScript interfaces and types (`api.ts`, `wallet.ts`, `call.ts`, `encryption.ts`)
  - UI components (Message, DMList, MemberList, Header, Sidebar, SearchModal, UserProfileModal, ParticipantVideo, VoiceChannel, ChatContainer, TypingIndicator)
  - Settings page (X verification section removed)
  - Privacy policy and Terms of Service pages
  - Provider wrappers (NextAuthProvider removed from AppProviders)
  - Lib utilities (`isValidXHandle` removed from auth.ts, validation.ts, validation-client.ts)
  - Export indexes (auth/index.ts, hooks/index.ts, providers/index.ts, moderation/index.ts)

### Removed: Platform Admin System
No more centralized admin authority. Moderation will be community-driven.

**Files deleted:**
- `src/app/api/admin/reports/route.ts` — Admin report review endpoint
- `src/app/api/admin/appeals/route.ts` — Admin appeals endpoint
- `src/components/moderation/AdminPanel.tsx` — Admin UI panel
- `src/components/providers/NextAuthProvider.tsx` — NextAuth session provider

**Code removed:**
- `PLATFORM_ADMIN_WALLETS` environment variable usage
- `isPlatformAdmin()` function
- Admin panel imports and rendering in layout components

---

## Security Vulnerabilities Identified

These were found during initial audit and should be addressed in upcoming phases:

### Critical
1. **`notification:send` socket event has no auth check** — Any connected socket can send fake notifications to any user
2. **`call:end` and `call:media-toggle` broadcast to ALL sockets** — Leaks call metadata globally, trivial DoS vector
3. **Channel join has no membership verification** — Any authenticated user can join any channel room via socket

### High
4. **CORS wildcard (`Access-Control-Allow-Origin: *`)** contradicts CSRF protection in `src/lib/auth.ts`
5. **Public key substitution attack** — Anyone who can sign with a wallet can overwrite the E2E encryption public key, enabling MITM on DMs
6. **Auth message replay attacks** — No nonce tracking within the 5-minute timestamp window
7. ~~**Community owner = instant platform admin**~~ — FIXED in Phase 2, moderation is now community-driven consensus

### Medium
8. **In-memory rate limiting** — Doesn't scale across multiple instances
9. **Token gating bypass** — Balance cached on login, never re-checked on channel access
10. **DM room joining leaks metadata** — No verification that recipient consented to DM room

### Low
11. **No token revocation mechanism** — Banned user's token valid until natural expiry (24h)
12. **`reaction` socket event doesn't validate message access**
13. **Duplicate message ID systems** — Socket server and DB generate different IDs

---

## Phase 2 — Community-Driven Moderation (COMPLETED)

Replaced the entire admin-based moderation system with decentralized community consensus.

### How It Works Now
```
Within a Community:
  Any member reports another member → report stored (tally hidden)
  Unique report count hits community threshold → user auto-kicked
  Anti-raid: only reports from members who joined BEFORE the target count
  No admin. Every member has equal weight.

Across the Platform:
  Kicked from 3 communities → automatic permanent platform ban
  No human decision. Fully automatic.
```

### Schema Changes Made
- **Removed**: `Strike` model, `Appeal` model, `AppealStatus` enum, `ReportStatus` enum
- **Removed from User**: `strikes`, `blacklistedAt`, `timeoutUntil` fields
- **Simplified `MembershipRole`**: removed `ADMIN` — only `OWNER` (informational) and `MEMBER`
- **Updated `NotificationType`**: removed `STRIKE_RECEIVED`/`APPEAL_UPDATE`, added `COMMUNITY_KICKED`/`PLATFORM_BANNED`
- **Updated `Report`**: added `communityId`, removed `status`/`reviewedAt`/`reviewedById`, added `@@unique([reporterId, reportedUserId, communityId])`
- **Updated `Community`**: added `reportThreshold` (default: 5, configurable 1-100 by owner)
- **Added `CommunityKick`** model: tracks which users were kicked from which communities

### Files Rewritten
- `src/lib/moderation.ts` — complete rewrite with `fileReport()`, `isUserBanned()`, `isWalletBanned()`, `getKickCount()`, `isKickedFromCommunity()`
- `src/app/api/reports/route.ts` — now requires `communityId`, delegates to `fileReport()` for auto-kick/ban
- `src/hooks/useModeration.ts` — simplified, removed all strike/appeal/timeout UI logic

### Files Modified (20+ files)
- `src/lib/auth.ts` — removed `strikes`/`timeoutUntil` from `AuthenticatedUser`, removed timeout checks
- `src/types/api.ts` — removed admin types, updated report types with `communityId`
- `src/lib/validation.ts` / `validation-client.ts` — added `communityId` to report schema, removed review/appeal schemas
- `src/app/api/communities/[id]/route.ts` — added `reportThreshold` to response, owner can update it
- `src/app/api/communities/[id]/members/route.ts` — kicked users blocked from rejoining
- UI components (Message, MemberList, UserProfileModal, DMList, community pages) — removed all strike indicators and admin role badges

---

## Phase 0 — Ephemeral Pivot (IN PROGRESS)

Decision (2026-05-21): pivot to a fully ephemeral identity model. No accounts,
no persistent users, no moderation. Open a tab → fresh keypair. Close tab →
gone. Server is a community/channel directory; everything else is client-side.

**Completed in this phase (branch: `rework/ephemeral-pivot`):**

- Schema reduced to `Community` + `Channel` only. Dropped `User`,
  `Membership`, `Report`, `CommunityKick`, `Vouch`, `ReportCategory`.
- All `/api/auth/*`, `/api/users/*`, `/api/reports/*`, `/api/admin/*`,
  `/api/appeals/*`, `/api/search`, `/api/communities/[id]/members` routes
  deleted.
- Three surviving routes (GET/POST `/communities`, GET `/communities/[id]`,
  GET/POST `/communities/[id]/channels`) rewritten with no auth, IP-keyed
  rate limiting for writes.
- `src/lib/auth.ts` gutted to minimal API utilities (CORS, IP rate limit,
  input sanitization, response shaping). Kept the filename to avoid churn.
- `src/lib/index.ts` slimmed to just the things still exported.
- New `useSession` hook (`src/hooks/useSession.ts`) generates ephemeral
  ed25519 + Curve25519 keypairs on mount, persists keys to sessionStorage
  only, persists display name to localStorage. Includes legacy compat
  fields (`publicId`, `publicKey`, `signature`) so old pages compile.
- Call/voice subsystem (useCall, useP2P, src/components/call/, src/lib/p2p.ts,
  src/types/p2p.ts, src/types/call.ts) — deleted entirely. ~1500 lines.
  Can be added back as v2 feature.
- Dead lib files deleted: keyStore.ts, validation.ts, validation-client.ts,
  notifications.ts, socket.ts, useNotifications, useFileUpload.
- 7 useAuth consumers swapped to useSession.
- `useEncryption` and `useRealtime` rewritten as stubs with legacy-compat
  method surface so consumers compile without a real protocol yet.
- `SearchModal` and `AttachmentDisplay` stubbed to render null
  (features don't exist without users / server file storage).
- tsconfig scoped to `src/` only (was including `client/` and `server/src/`).
- **`yarn tsc --noEmit` passes with 0 errors.**

**What's stubbed and waiting for the next phase:**

- The real `useRealtime` per-session-DH protocol: server roster, channel
  join broadcasts roster, fan-out sender encrypts to each member's
  `boxPublicKey`, server relays per-recipient ciphertext.
- The real `useEncryption` with `nacl.box` per-recipient encryption and
  DH-based DM encryption.
- `server/socket-server.ts` — currently has a no-op `user` stub. Needs full
  rewrite to in-memory roster + per-recipient channel relay.
- Client-side IndexedDB message store (`src/lib/messageStore.ts`).
- Landing + app page rewrites for sessionless entry (currently the pages
  redirect to login/etc on old flows).
- README rewrite to match the ephemeral model.

**Known limitations the user explicitly accepted (not bugs):**

- Channel messages are O(N) bandwidth (N = recipients per channel).
- New joiners see zero history (per-device storage only).
- Display names are spoofable and unfightable (no identity).
- Open community creation can be spammed (only IP rate-limited).
- DMs don't persist across sessions for either party.

---

## Phase 3 — Solana Removal & Identity Migration (COMPLETED)

All Solana wallet integration has been stripped. Identity is now self-custodied
NaCl keypairs with a soul-art ceremony at creation.

**Removed:**
- `src/lib/solana.ts` (deleted)
- `@solana/*` SDKs (already gone from `package.json`)
- Helius / `$CLAWED` token-gating code
- `HELIUS_API_KEY` and `NEXT_PUBLIC_SOLANA_RPC` from `.env.example`
- `src/components/auth/WalletConnect.tsx` (placeholder)
- `src/components/providers/WalletProvider.tsx` (passthrough)
- Dead `.wallet-address` CSS class in `globals.css`

**Renamed (URLs unchanged, internal param names only):**
- `src/app/app/dm/[wallet]/` → `[publicId]/`
- `src/app/api/users/[wallet]/` → `[publicId]/`
- `truncateWallet` → `truncatePublicId` in `src/lib/format.ts` (+ 6 importers)
- `localWallet` → `localPublicId` inside `src/lib/p2p.ts`

**New identity model (built in this branch, now fully wired):**
- `src/types/identity.ts`
- `src/hooks/useAuth.ts` — paste-key login flow
- `src/app/api/auth/register/route.ts` — one-key-per-lifetime enforcement
- `src/app/login/page.tsx`, `src/app/create/page.tsx`
- `src/components/auth/SoulArtCanvas.tsx` — 256×256, ≥3 strokes, ≥5s minimum
- Schema: `User { publicId, publicKey, artHash, isBlacklisted }`. No `wallet` field.

**Follow-up:** the standalone `server/` rewrite (Express + Socket.io) has its
own `src/routes/auth.ts`. If `server/` becomes canonical, the new identity
model (publicId + soul-art + one-key-per-lifetime) needs to be mirrored there.

---

## Phase 4 — Fix Socket Server Vulnerabilities (UPCOMING)

These are unchanged from the original audit and remain open:

- [ ] Add auth guard to `notification:send` socket event
- [ ] Scope `call:end` and `call:media-toggle` to call participants only
- [ ] Add membership verification to `join:channel` socket event
- [ ] Add consent/validation to `join:dm` socket event
- [ ] Fix CORS wildcard — use specific allowed origins
- [ ] Add nonce tracking to prevent auth message replay

---

## Phase 5 — Decentralized Infrastructure (FUTURE)

Replace centralized server components:

| Current | Target |
|---|---|
| PostgreSQL | Decentralized storage (IPFS/OrbitDB) |
| Socket.io server | Waku / Nostr relays / Nym mixnet |
| Next.js API routes | Client-side logic + decentralized protocols |
| Central file storage | IPFS for attachments |

Candidates:
- **Nostr** — federated relay network for community channels
- **Waku** — libp2p-based messaging
- **Nym** — mixnet for traffic analysis resistance (Mullvad-style privacy)
- **IPFS** — decentralized file storage

---

## Phase 6 — Desktop App (IN PROGRESS)

The `client/` folder contains a Vite + React + Tauri 2 desktop client. Not
yet feature-complete, but the shell is in place.

- [x] Tauri shell scaffolded
- [x] React Router pages (Landing, Login, CreateAccount, App, Settings, DM, Channel, etc.)
- [ ] Wire to the standalone `server/` backend
- [ ] Native OS notifications via `@tauri-apps/plugin-notification`
- [ ] System tray support

---

## Tech Stack (Current)

| Layer | Technology |
|---|---|
| Frontend (web) | Next.js 14, TypeScript, Tailwind CSS |
| Frontend (desktop, WIP) | Vite + React + Tauri 2 |
| Backend (current) | Next.js API Routes, Prisma ORM |
| Backend (rewrite, WIP) | Express + Socket.io + Helmet |
| Database | PostgreSQL |
| Crypto | TweetNaCl (nacl.box / nacl.secretbox), @noble/ed25519 |
| Real-time | Socket.io |
| P2P Calls | WebRTC via simple-peer |
| Auth | Self-custodied NaCl ed25519 keypair, paste-key login |
