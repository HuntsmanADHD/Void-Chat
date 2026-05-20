# VOID CHAT — FULL SECURITY AUDIT REPORT

**Date:** 2026-03-20
**Scope:** Full-stack pentest — Next.js API, Express server, Socket.io, Tauri client, Prisma/DB, Cryptography layer
**Auditor:** Automated deep-dive (6 parallel agents, extended analysis)
**Status:** Pre-production review

---

## Executive Summary

Comprehensive pentest across 6 attack surfaces on the Void Chat codebase (Next.js + Express + Tauri + Prisma + Socket.io + NaCl crypto). The application has **critical showstopper issues** that must be resolved before production.

| Severity | Count | Status |
|----------|-------|--------|
| **CRITICAL** | 11 | Must fix before prod |
| **HIGH** | 17 | Must fix before prod |
| **MEDIUM** | 27 | Should fix before prod |
| **LOW** | 16 | Fix when possible |

---

## CRITICAL FINDINGS (11)

### CRIT-1: Encryption Key Exchange Functions Are Stubs (Return `null`)

- **Files:** `client/src/lib/encryption.ts:128-154`
- **Impact:** The entire E2E encryption layer is non-functional. `encryptForKeyExchange()`, `decryptFromKeyExchange()`, `encryptSecretKey()`, and `decryptSecretKey()` all return `null`. Channel keys can't be stored/retrieved. Private keys can't be encrypted at rest. **The app's core privacy promise is broken.**
- **Attack Scenario:** Since key exchange stubs return null, the app either silently sends unencrypted messages or fails to send entirely. If developers work around by storing keys in plaintext (which the fallback behavior encourages), every private key in localStorage is immediately extractable via XSS or physical access.
- **Fix:** Implement the actual NaCl box/secretbox encryption in these functions. This is the #1 priority.

---

### CRIT-2: DKG Protocol Is Not Actually Distributed

- **File:** `client/src/lib/dkg.ts:177-236`
- **Impact:** A single "initiator" generates the full channel key then splits it via Shamir. This is centralized key generation with secret sharing — NOT Distributed Key Generation. The initiator knows the full key at all times and can read all channel messages indefinitely.
- **Attack Scenario:** A malicious community admin initiates "DKG" for every channel, retains the full channel key in memory (or logs it before splitting), and can read all encrypted channel messages indefinitely.
- **Fix:** Either implement a proper DKG protocol with Feldman VSS commitments, or rename the feature honestly and document the trust model.

---

### CRIT-3: CORS Wildcard `*` on All Next.js API Routes

- **File:** `src/lib/auth.ts:664-665`
- **Impact:** `Access-Control-Allow-Origin: '*'` is hardcoded in `CORS_HEADERS`. Every API route returns this. Any website on the internet can make cross-origin requests to your API endpoints. Combined with Bearer token theft, this enables full cross-origin attacks. The `validateOrigin()` function elsewhere in the same file is rendered meaningless by this wildcard.
- **Attack Scenario:** Attacker hosts `evil.com` with JavaScript that calls `POST /api/communities` or `PUT /api/users/[wallet]` using a stolen/phished Bearer token. The browser allows it because CORS says `*`.
- **Fix:** Replace `'*'` with an environment-driven allowlist derived from `ALLOWED_ORIGINS`. The Express server already does this correctly — match that pattern.

---

### CRIT-4: Public Key Replacement = Account Takeover

- **File:** `src/app/api/users/[wallet]/route.ts:97-119`
- **Impact:** `PUT /api/users/[wallet]` allows updating `publicKey` with no re-authentication. A stolen token lets an attacker permanently hijack an account by rotating the cryptographic key. The victim can never log in again (their private key no longer matches), and the attacker can authenticate with their own private key.
- **PoC:**
  ```
  PUT /api/users/victim_id
  Authorization: Bearer <stolen_token>
  { "publicKey": "<attacker_base64_public_key>" }
  ```
- **Fix:** Either remove the ability to update `publicKey` via this endpoint, or require a signature proof with the CURRENT key before accepting a new key.

---

### CRIT-5: Vouch Route Has No Authentication

- **File:** `server/src/routes/vouches.ts:11-12`
- **Impact:** Uses raw `req.headers['x-public-id']` instead of `authenticateRequest()`. Any client can set this header to any value, allowing identity spoofing for vouch creation. While signature verification exists, it uses the spoofed user's stored public key — if the attacker knows the victim's key, they can craft attacks.
- **PoC:**
  ```bash
  curl -X POST http://localhost:3001/api/communities/COMMUNITY_ID/vouches \
    -H "Content-Type: application/json" \
    -H "X-Public-Id: victim_user" \
    -d '{"vouchedPublicId":"attacker","signature":"..."}'
  ```
- **Fix:** Replace header-based identity with `authenticateRequest()` middleware, consistent with all other routes.

---

### CRIT-6: Any Community Member Can Modify `reportThreshold`

- **Files:** `server/src/routes/communities.ts:190-275`, `src/app/api/communities/[id]/route.ts:79-192`
- **Impact:** No owner/admin role check — only membership is verified. Any member can change the community name, description, avatar, and critically the `reportThreshold`. Setting it to 1 enables instant-kick of anyone with a single report. Setting it to 100 makes the moderation system useless. **Completely undermines the moderation system.**
- **PoC:**
  ```bash
  curl -X PUT http://localhost:3001/api/communities/COMMUNITY_ID \
    -H "Authorization: Bearer <any_member_token>" \
    -H "Content-Type: application/json" \
    -d '{"reportThreshold": 1}'
  ```
- **Fix:** Implement an ownership/governance model. At minimum, only the community creator should be able to change settings. Consider requiring consensus for threshold changes.

---

### CRIT-7: Unauthenticated `notification:send` Socket Event

- **File:** `server/src/socket.ts:593-613`
- **Impact:** Zero `socket.authenticated` guard. Any socket connection — even one that never authenticated — can send arbitrary notifications to any online user by their publicId.
- **PoC:**
  ```javascript
  const io = require('socket.io-client');
  const socket = io('http://localhost:3001');
  // No authenticate call needed
  socket.emit('notification:send', {
    targetId: 'victim_user',
    notification: { id: 'fake', type: 'message', title: 'Phishing: Click here to verify your account' }
  });
  ```
- **Fix:** Add `if (!socket.authenticated) return;` guard at the top of the handler.

---

### CRIT-8: Socket Auth Timestamp Check Is Conditional (Bypassable)

- **File:** `server/src/socket.ts:204-276`
- **Impact:** The auth message has a 5-minute validity window, but the timestamp check only fires if the message matches a regex containing "timestamp:". If the message doesn't contain that keyword, the time validation is silently skipped. A captured signature without a timestamp keyword is valid **forever**. Additionally, there is no nonce tracking — valid signatures can be replayed unlimited times within the 5-minute window.
- **PoC:**
  ```javascript
  socket.emit('authenticate', {
    publicId: 'target',
    signature: '<captured_signature>',
    message: 'any message that was signed'  // No "timestamp:" = no expiry
  });
  ```
- **Fix:** Make timestamp mandatory in the message format. Reject messages without a valid timestamp. Implement nonce tracking to prevent replay within the window.

---

### CRIT-9: Prisma Schema Divergence Between Next.js and Express

- **Files:** `prisma/schema.prisma` vs `server/prisma/schema.prisma`
- **Impact:** Two different schemas pointing at the same database:
  - Server schema has `Vouch` model, `requireVouch` field, `messageRef` field on Report
  - Root schema is missing all of these, uses `messageId` instead of `messageRef`
  - The `fileReport()` function in `src/lib/moderation.ts` writes `messageId` to the Report model, but the schema defines the field as `messageRef` — **every report submission with a messageId will crash with a Prisma runtime error**
  - The root migrations create a completely different data model (wallet addresses, messages, strikes, attachments) than either current schema
- **Fix:** Reconcile the schemas immediately. Pick one source of truth. Clean up stale migrations.

---

### CRIT-10: Secret Key Exposed in React Hook Return Value

- **File:** `client/src/hooks/useEncryption.ts:484`
- **Impact:** `secretKey: secretKeyRef.current` is returned directly from the `useEncryption()` hook. Any component consuming this hook gets the raw base64-encoded secret key as a string property. The private key is exposed to all React components and can leak through React DevTools, component state dumps, error boundary captures, or Sentry/logging middleware. Any XSS vulnerability instantly yields the user's private key.
- **Fix:** Remove `secretKey` from the hook's return value. Keep it exclusively in the ref and expose only encryption/decryption methods.

---

### CRIT-11: No DKG Share Verification (Feldman VSS Missing)

- **Files:** `client/src/hooks/useDKG.ts:64-82`, `client/src/lib/dkg.ts:246-272`
- **Impact:** When `acceptShare()` or `decryptShare()` is called, the recipient decrypts the share and blindly trusts it. There is no Feldman VSS or Pedersen commitment scheme. The initiator can send different, inconsistent shares to different members to selectively exclude users from key reconstruction.
- **Fix:** Implement Feldman VSS commitments alongside share distribution so recipients can verify share consistency.

---

## HIGH FINDINGS (17)

### H-1: Registration Doesn't Require Proof of Key Ownership

- **File:** `server/src/routes/auth.ts:24-82`
- **Impact:** The `/api/auth/register` endpoint accepts a `publicKey` without requiring a signature proving the registrant holds the corresponding private key. An attacker can register with someone else's public key, permanently preventing the legitimate owner from ever registering ("This key has already been used to create an account. One identity per lifetime.").
- **PoC:**
  ```bash
  curl -X POST http://localhost:3001/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"publicId":"attacker","publicKey":"<victim_public_key>","artHash":"a]x64"}'
  ```
- **Fix:** Require a challenge-response signature during registration to prove key ownership.

---

### H-2: `publicKey` Field Has No `@unique` Constraint

- **Files:** Both `prisma/schema.prisma` and `server/prisma/schema.prisma`, line 21
- **Impact:** The `publicKey` field on the User model has no `@unique` annotation. While registration code does a `findFirst` check, two concurrent registrations with the same key can both pass the check (race condition). Two accounts with the same key breaks the authentication model.
- **Fix:** Add `@unique` to `publicKey` in the Prisma schema. This enforces uniqueness at the database level.

---

### H-3: Channel `join:channel` Has No Membership Verification

- **File:** `server/src/socket.ts:282-288`
- **Impact:** Only checks `socket.authenticated`, never verifies the user is a member of the community that owns the channel. Any authenticated user can join any channel room and receive all encrypted messages (metadata, ciphertext, timing).
- **Fix:** Query the database to verify community membership before allowing room join.

---

### H-4: Voice Channel Join Has No Membership Verification

- **File:** `server/src/socket.ts:684-699`
- **Impact:** Same as H-3 but for voice channels. Any authenticated user can join any voice channel room. Voice/video data relayed through WebRTC signaling could be intercepted.
- **Fix:** Same as H-3 — verify community membership.

---

### H-5: `call:end` / `call:media-toggle` Broadcast to ALL Sockets

- **File:** `server/src/socket.ts:669-682`
- **Impact:** Uses `socket.broadcast.emit()` which sends to every connected socket, not just call participants. All connected users receive call end/media toggle events, leaking who is in calls and their media state.
- **Fix:** Scope these events to the specific call room, not broadcast.

---

### H-6: Rate Limiting Uses Spoofable `X-Forwarded-For`

- **File:** `server/src/routes/auth.ts:36`
- **Impact:** Registration rate limiting uses the `X-Forwarded-For` header which is client-controlled. An attacker can cycle through arbitrary IPs to bypass rate limiting entirely, enabling mass account creation.
- **PoC:**
  ```bash
  for i in $(seq 1 1000); do
    curl -X POST http://localhost:3001/api/auth/register \
      -H "X-Forwarded-For: 10.0.0.$i" \
      -H "Content-Type: application/json" \
      -d "{\"publicId\":\"spam$i\",\"publicKey\":\"...\",\"artHash\":\"...\"}"
  done
  ```
- **Fix:** Use the actual client IP from the socket, or trusted proxy headers only. Configure `trust proxy` in Express appropriately.

---

### H-7: Search Channel Filter Bypassed via `communityId` Parameter

- **Files:** `server/src/routes/search.ts:113-115`, `src/app/api/search/route.ts:126-162`
- **Impact:** When `communityId` query parameter is provided, it overrides the membership filter. Any authenticated user can search channels in any community by passing the communityId parameter, leaking channel names and descriptions from private communities.
- **PoC:**
  ```
  GET /api/search?q=secret&types=channel&communityId=<private_community_id>
  Authorization: Bearer <any_user_token>
  ```
- **Fix:** Always intersect the `communityId` parameter with the user's actual membership list.

---

### H-8: Weaponizable Ban System (3 Kicks = Platform Ban)

- **File:** `src/lib/moderation.ts:36-185`
- **Impact:** Platform ban threshold is 3 community kicks. An attacker can:
  1. Create 3 communities (no limit on creation)
  2. Set `reportThreshold` to 1 on each (per CRIT-6)
  3. Invite/trick the target into joining all 3
  4. File one report per community
  5. Target is auto-kicked from all 3 and **permanently platform-banned**
- **Fix:** Decouple community kicks from platform bans, or require admin review for platform-level actions.

---

### H-9: localStorage Key Storage (XSS = Total Compromise)

- **File:** `client/src/lib/keyStore.ts:32-33, 102, 339`
- **Impact:** All key material stored in `localStorage` in browser mode: public key caches, channel keys, user keypairs. `localStorage` is accessible to any JavaScript on the same origin. Combined with CRIT-1 (broken key encryption), private keys are stored in plaintext.
- **Fix:** Use `IndexedDB` with origin-based isolation. For Tauri, the OS keyring is already used (good). Prioritize fixing CRIT-1 so keys are encrypted at rest.

---

### H-10: Auth Signature Used as Encryption Key (No KDF)

- **Files:** `client/src/hooks/useEncryption.ts:98-110`
- **Impact:** The authentication signature is used directly as the "password" for encrypting the private key at rest. No KDF (PBKDF2, Argon2, scrypt). The signature is deterministic (same key + same message = same signature) and is sent over the wire during auth — a compromised server logs it and can decrypt stored private keys.
- **Fix:** Use a proper KDF to derive the encryption key. Do not use the auth signature directly.

---

### H-11: Public Key MITM — Server Is Sole Trust Anchor

- **File:** `client/src/lib/keyStore.ts:186-215`
- **Impact:** Public keys are fetched from the server API and trusted without independent verification. The server can substitute its own public key when users request each other's keys, performing a classic MITM on all E2E encrypted messages.
- **Fix:** Implement key fingerprint verification (QR codes, safety numbers like Signal), or use a key transparency log.

---

### H-12: No TURN Server — P2P Silently Downgrades

- **File:** `client/src/lib/p2p.ts:25-31`
- **Impact:** Only STUN servers (Google's public ones) are configured. No TURN servers. Users behind symmetric NATs silently lose P2P capability with no notification.
- **Fix:** Add TURN server configuration. Notify users when P2P fails and they're falling back to server relay.

---

### H-13: `Math.random()` for File Transfer IDs

- **File:** `client/src/hooks/useFileTransfer.ts:52`
- **Impact:** File IDs generated with `Math.random().toString(36).slice(2, 10)` — not cryptographically secure. Predictable IDs enable file transfer hijacking.
- **Fix:** Use `crypto.getRandomValues()` or `crypto.randomUUID()`.

---

### H-14: No Token Revocation Mechanism

- **Files:** `src/lib/auth.ts`, `server/src/lib/auth.ts`
- **Impact:** Auth tokens are stateless HMAC-SHA256 with 24-hour expiry. No server-side session store, no blocklist. A compromised token remains valid for up to 24 hours. Combined with CRIT-4 (public key replacement), an attacker has a 24-hour window for permanent account takeover.
- **Fix:** Implement a token blocklist (Redis-backed) or reduce token TTL significantly.

---

### H-15: Race Condition in Report-to-Kick Flow (No Transaction)

- **File:** `src/lib/moderation.ts:105-166`
- **Impact:** The `fileReport` function has a TOCTOU race condition: report creation, report counting, and kick action are NOT in a single transaction. The report is not rolled back if the kick fails.
- **Fix:** Wrap the entire report-create-count-kick flow in a single serializable transaction.

---

### H-16: DM Room Join Has No Consent Verification

- **File:** `server/src/socket.ts:297-303`
- **Impact:** Any authenticated user can `join:dm` with any recipientId. No check that the recipient has consented or even exists. Enables unwanted DM stalking, typing indicator surveillance.
- **Fix:** Implement a DM consent/blocking mechanism. Require mutual opt-in before allowing DM room access.

---

### H-17: Missing `ALLOWED_ORIGINS` in .env.example

- **File:** `.env.example`
- **Impact:** The `ALLOWED_ORIGINS` environment variable used by CSRF protection is not documented. Production deployments will likely not configure it, and combined with CRIT-3 (CORS wildcard), the protection is irrelevant anyway.
- **Fix:** Add `ALLOWED_ORIGINS` to `.env.example` with documentation. Remove stale NextAuth/Twitter variables.

---

## MEDIUM FINDINGS (27)

### M-1: No `helmet` / Security Headers on Express Server

- **File:** `server/src/index.ts`
- **Missing:** `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`
- **Fix:** Add `helmet` middleware.

### M-2: CORS Allows Multiple Localhost Origins in Production

- **File:** `server/src/index.ts:39-57`
- **Issue:** `http://localhost:1420`, `http://localhost:3000`, `http://localhost:5173` hardcoded alongside production origins.
- **Fix:** Make CORS origins conditional on `NODE_ENV`.

### M-3: Tauri CSP Allows Broad WebSocket/HTTPS Connections

- **File:** `client/src-tauri/tauri.conf.json:28`
- **Issue:** `connect-src` includes `https: wss:` — allows the app to connect to ANY HTTPS/WSS endpoint. XSS can exfiltrate data to any server.
- **Fix:** Restrict to specific server domains.

### M-4: Tauri `shell:allow-open` Capability

- **File:** `client/src-tauri/capabilities/default.json:11`
- **Issue:** Allows opening arbitrary URLs in the system browser. Combinable with XSS for phishing.
- **Fix:** Scope to `https://` URLs only via Tauri's URL scope feature.

### M-5: Ban List Endpoint Has No Pagination, Auth, or Rate Limiting

- **File:** `server/src/routes/bans.ts:7-44`
- **Issue:** `GET /api/bans` returns ALL banned users with no pagination, no authentication, and no rate limiting.
- **Fix:** Add pagination, authentication, and rate limiting.

### M-6: In-Memory Rate Limiting Doesn't Survive Restarts

- **Files:** `server/src/lib/auth.ts:30`, `src/lib/auth.ts:37-38`
- **Issue:** Rate limit store is an in-memory `Map`. Resets on restart, per-process in clustered deployments, never cleaned up (memory leak).
- **Fix:** Use Redis-backed rate limiting for production.

### M-7: Report Response Leaks Moderation Thresholds

- **File:** `server/src/routes/reports.ts:65-72`
- **Issue:** Response includes `reportCount` and `threshold`, revealing how many more reports are needed to kick a user.
- **Fix:** Remove threshold information from the response.

### M-8: Self-Vouch Not Prevented

- **File:** `server/src/routes/vouches.ts`
- **Issue:** No check for `publicId === vouchedPublicId`. Users can vouch for themselves.
- **Fix:** Add self-vouch prevention check.

### M-9: No Key Rotation Mechanism / No Forward Secrecy

- **Files:** All key management files
- **Issue:** No mechanism for rotating channel keys or user keypairs. No Double Ratchet, no X3DH, no ephemeral keys. One key compromise reveals entire message history.
- **Fix:** Implement key rotation at minimum. Consider a ratcheting protocol for DMs.

### M-10: ICE Candidates Leak Local/Public IPs

- **Files:** `client/src/lib/p2p.ts`, `src/lib/p2p.ts`
- **Issue:** WebRTC config doesn't filter candidates or set `iceTransportPolicy: 'relay'`. All ICE candidates (including local network IPs) are sent through the signaling server.
- **Fix:** Filter local candidates. Consider `iceTransportPolicy: 'relay'` for privacy-sensitive users.

### M-11: File Key Derivation — Same Channel Key = Same File Key

- **File:** `client/src/lib/fileEncryption.ts:97-113`
- **Issue:** Static domain separator means same channel key always produces same file key. No per-file key derivation.
- **Fix:** Include a per-file random salt in the key derivation.

### M-12: P2P `senderId` Spoofing — Control Messages Unauthenticated

- **Files:** `client/src/lib/p2p.ts:182-202`, `client/src/hooks/useFileTransfer.ts:359-379`
- **Issue:** `senderId` in P2P data channel messages is self-reported. No verification against WebRTC peer identity. Typing indicators, file transfer controls can be spoofed.
- **Fix:** Authenticate P2P control messages using the sender's signing key.

### M-13: Avatar Field Accepts Arbitrary URLs in PUT (No Validation)

- **File:** `server/src/routes/communities.ts:238-239`, `src/app/api/communities/[id]/route.ts:146-148`
- **Issue:** Community creation validates avatar via Zod (`z.string().url()`), but the PUT update endpoint bypasses Zod for avatar. Accepts `javascript:`, `data:`, or internal network URLs. SSRF and stored XSS vector.
- **Fix:** Apply Zod URL validation on the PUT path as well. Allowlist URL schemes to `https://` only.

### M-14: Unbounded `findMany` Queries on 6+ Endpoints (DoS)

- **Files:**
  - `server/src/routes/bans.ts:9` — all banned users, no limit
  - `server/src/routes/members.ts:34` — all members, no limit
  - `server/src/routes/channels.ts:35` — all channels, no limit
  - `server/src/routes/vouches.ts:80` — all vouches, no limit
  - `src/app/api/communities/[id]/members/route.ts:49` — no limit
  - `src/app/api/communities/[id]/channels/route.ts:51` — no limit
- **Fix:** Add `take` limits and pagination to all `findMany` calls.

### M-15: `sanitizeInput` Corrupts Data

- **Files:** `server/src/lib/auth.ts:327-334`, `src/lib/auth.ts:570-577`
- **Issue:** HTML-encodes `/`, `'`, `"` before storing in the database. Stored data contains HTML entities. Search queries are also sanitized, so "test/foo" becomes "test&#x2F;foo". Breaks URLs, file paths, dates, and names like "Bob's Community".
- **Fix:** Store data raw. Sanitize/encode at render time on the frontend.

### M-16: Stale Migrations Create Wrong Schema

- **Files:** `prisma/migrations/` (root)
- **Issue:** Root migrations contain a completely different data model than the current schema (wallet addresses, messages, strikes, attachments, `MembershipRole` enum). Running `prisma migrate deploy` on a fresh database creates the wrong schema.
- **Fix:** Clean up or replace stale migrations to match the current schema.

### M-17: `testMode` Prop Bypasses Encryption in ChatContainer

- **File:** `client/src/components/chat/ChatContainer.tsx:61, 117-149, 221-239`
- **Issue:** `testMode` prop skips all encryption and uses plain base64 encoding. If accidentally enabled in production, messages are sent unencrypted.
- **Fix:** Gate `testMode` behind `import.meta.env.DEV` inside the component, or remove it from production builds.

### M-18: `useModeration` Uses Raw `fetch()` Without Auth Headers

- **File:** `client/src/hooks/useModeration.ts:93, 142-153`
- **Issue:** `reportUser()` sends `POST /api/reports` with only `Content-Type` — no auth token, no user identification headers. Reports may fail silently or be unauthenticated.
- **Fix:** Route all API calls through the `useApi` hook which properly attaches auth headers.

### M-19: Dev Secret in `server/.env`

- **File:** `server/.env:2`
- **Issue:** `AUTH_TOKEN_SECRET="voidchat-dev-secret-key-minimum-32-chars-long"` — predictable, dictionary-word-based. If deployed as-is, tokens are forgeable.
- **Fix:** Generate a cryptographically random secret. Add `.env` generation to setup docs.

### M-20: No DB Password / No TLS on PostgreSQL Connection

- **File:** `server/.env:1`
- **Issue:** `DATABASE_URL="postgresql://b0g@localhost:5432/voidchat"` — no password, no `?sslmode=require`.
- **Fix:** Require password auth and TLS for production PostgreSQL connections.

### M-21: Dual Codebase Divergence (client/ vs src/)

- **Issue:** The `client/` (Tauri/Vite) and `src/` (Next.js) codebases have divergent implementations. Different function signatures for crypto functions, different import paths, different behavior. Security fixes must be applied to both.
- **Fix:** Extract shared logic into a common package, or consolidate to one frontend.

### M-22: Signature-Based Auth Uses Different Key Encoding Than Registration

- **File:** `src/lib/auth.ts:393-450` vs `src/app/api/auth/verify/route.ts`
- **Issue:** `authenticateWithSignature()` decodes stored key as base64. The verify endpoint decodes as base58. Registration stores whatever format the client sends. Encoding mismatch means one auth method works while the other breaks depending on how the key was originally registered.
- **Fix:** Standardize on one encoding format (base58 or base64) across all auth paths.

### M-23: Community Creation Has No Rate Limit

- **File:** `src/app/api/communities/route.ts:90-172`
- **Issue:** No rate limiting on `POST /api/communities`. Each creation triggers a DB transaction with 3 records. Resource exhaustion vector.
- **Fix:** Add rate limiting per user on community creation.

### M-24: Blacklist Status Endpoint Enables Enumeration

- **File:** `src/app/api/auth/blacklist/route.ts:26-58`
- **Issue:** `GET /api/auth/blacklist?id=<publicId>` is unauthenticated and rate-limits by queried ID (not requester). Attacker can enumerate blacklist status of all users.
- **Fix:** Rate limit by requester IP/token, not queried ID.

### M-25: Vouch `communityId` Is Nullable in Unique Constraint

- **File:** `server/prisma/schema.prisma:121`
- **Issue:** `communityId String?` participates in `@@unique([voucherId, vouchedId, communityId])`. NULL values in unique constraints are treated as distinct in PostgreSQL — unlimited vouches with null communityId.
- **Fix:** Make `communityId` required, or add application-level validation.

### M-26: No Channel/Community Deletion Capability

- **Issue:** No DELETE routes for communities or channels. Griefing via channel spam is permanent. Abandoned communities can't be cleaned up.
- **Fix:** Add DELETE endpoints with proper authorization.

### M-27: Offline Message Buffer Has No Per-Sender Limits

- **File:** `server/src/socket.ts:130-150`
- **Issue:** Total offline buffer is 500 per recipient, but no per-sender limit. One user can fill another's entire buffer, pushing out legitimate messages.
- **Fix:** Add per-sender limits within the offline buffer.

---

## LOW FINDINGS (16)

### L-1: Prisma Query Logging in Development Mode
- **File:** `server/src/lib/prisma.ts:14`
- **Issue:** Full SQL queries logged in dev mode. Could expose sensitive data in logs.

### L-2: Error Messages Leak Internal Details in Non-Production
- **File:** `server/src/lib/auth.ts:363-372`
- **Issue:** Raw error messages including Prisma errors and stack traces exposed when `NODE_ENV !== 'production'`.

### L-3: No CSRF Protection Beyond CORS
- **File:** `server/src/index.ts`
- **Issue:** No CSRF tokens. CORS with `credentials: true` could enable attacks if cookies are ever added.

### L-4: Duplicate Prisma Client Instances
- **File:** `server/src/socket.ts:16`
- **Issue:** Creates `new PrismaClient()` instead of importing from `./lib/prisma.js`. Second connection pool.

### L-5: 128 Console Logging Statements in Production Code
- **Files:** 25+ files across the codebase
- **Issue:** Extensive `console.error` and `console.log` calls log encryption errors, key operations, and connection state.

### L-6: `document.execCommand('copy')` Exposes Private Key to DOM
- **File:** `client/src/pages/CreateAccountPage.tsx:55-62`
- **Issue:** Copy fallback creates a temporary `<textarea>` with the private key. Malicious browser extensions with MutationObserver could capture it.

### L-7: ErrorBoundary Exposes Stack Traces in Dev Mode
- **File:** `client/src/components/ui/ErrorBoundary.tsx:81-96`
- **Issue:** If `DEV` is accidentally true in production, stack traces are exposed.

### L-8: No Request ID / Correlation for Audit Trail
- **Issue:** No request IDs generated or logged. Makes security incident investigation difficult.

### L-9: Pagination Max Limit of 100 Enables Scraping
- **File:** `src/lib/auth.ts:587`
- **Issue:** Combined with lack of rate limiting on GET endpoints, enables efficient data scraping.

### L-10: Community Names Not Unique
- **File:** `server/prisma/schema.prisma:40`
- **Issue:** No unique constraint. Attacker can create identically-named communities for phishing.

### L-11: Channel Name Uniqueness Race Condition
- **File:** `server/prisma/schema.prisma:57`
- **Issue:** No `@@unique([communityId, name])` constraint. Application-level check has race condition.

### L-12: README References Removed Features
- **File:** `README.md`
- **Issue:** References X/Twitter verification, NextAuth, 3-strike system, Admin review panel — all removed.

### L-13: Stale Twitter/NextAuth Variables in .env.example
- **File:** `.env.example:9-10, 15-17`
- **Issue:** `NEXTAUTH_SECRET`, `TWITTER_CLIENT_ID`, etc. still listed but unused.

### L-14: ESLint Rules Too Permissive
- **File:** `.eslintrc.json`
- **Issue:** `no-explicit-any: "warn"` (should be error), `no-unused-expressions: "off"`.

### L-15: SQLite Database Not Encrypted at Rest (Tauri)
- **File:** `client/src-tauri/src/lib.rs:324`
- **Issue:** `void_chat.db` stored as plain SQLite. Message metadata (channel_id, sender_id, timestamps) in plaintext.

### L-16: Predictable Keyring Service Names
- **File:** `client/src-tauri/src/lib.rs:64`
- **Issue:** `KEYRING_SERVICE = "com.voidchat.app"` — another local app could query the same keyring entry.

---

## ARCHITECTURAL CONCERNS

### ARCH-1: No Forward Secrecy

The system uses static Curve25519 keypairs for DM encryption. There is no Double Ratchet, no X3DH, no ephemeral keys. Once a user's private key is compromised, ALL past DM messages can be decrypted. For a privacy-focused chat app, this is a fundamental gap.

### ARCH-2: Server Sees All Metadata

Messages route through the server which sees who talks to whom, when, how often, and message sizes. For a "zero-knowledge" chat app, this is a significant gap. The server can build a complete social graph and activity pattern analysis.

### ARCH-3: Two Separate Codebases With Diverging Implementations

The `client/` (Tauri/Vite) and `src/` (Next.js) codebases have divergent crypto implementations, different function signatures, and different behavior. Security fixes must be applied to both, increasing the risk of one being missed.

### ARCH-4: No Admin/Owner Role Model

Every community member has equal power over community settings. Combined with the weaponizable moderation system, this creates a power vacuum that malicious actors can exploit.

### ARCH-5: Channel Key Distribution Depends on Server

DKG share distribution goes through the server. The server relays encrypted shares but could drop, delay, or replay them. There is no protocol-level confirmation that all members received their shares.

---

## POSITIVE FINDINGS (Things Done Right)

1. **No `dangerouslySetInnerHTML` anywhere** — All message content rendered as text nodes. Prevents stored XSS.
2. **No raw SQL** — Zero usage of `$queryRaw` or `$executeRaw`. SQL injection risk is effectively zero.
3. **TweetNaCl for crypto** — Audited library, correct algorithm choices (xsalsa20-poly1305, curve25519).
4. **Proper cascade deletes** in Prisma schema with `onDelete: Cascade`.
5. **Zod validation schemas** with strict regex patterns for user input.
6. **Tauri capabilities reasonably scoped** — Only `core:default`, `notification`, `shell:allow-open`.
7. **File upload has both type and size validation** with allowlist approach.
8. **Proper `rel="noopener noreferrer"`** on external links.
9. **Constant-time token comparison** in auth verification.
10. **OS keyring integration** in Tauri for key storage (when not in browser).

---

## TOP 10 FIXES BEFORE PRODUCTION (Priority Order)

| Priority | Finding | Action |
|----------|---------|--------|
| 1 | CRIT-1 | **Implement encryption stub functions** — Without this, E2E encryption is a lie |
| 2 | CRIT-3 | **Fix CORS wildcard** — Replace `'*'` with env-driven allowlist |
| 3 | CRIT-4 | **Remove `publicKey` from updatable fields** or require re-auth signature |
| 4 | CRIT-5 | **Add `authenticateRequest()` to vouch route** |
| 5 | CRIT-6 | **Implement owner/admin role model** — Restrict community settings changes |
| 6 | CRIT-7 | **Add auth guard to `notification:send`** socket event |
| 7 | CRIT-8 | **Make socket auth timestamp mandatory** — Reject messages without valid timestamp |
| 8 | CRIT-9 | **Reconcile the two Prisma schemas** — Pick one source of truth |
| 9 | CRIT-10 | **Remove `secretKey` from hook return value** |
| 10 | H-1, H-2 | **Add `@unique` to `publicKey`** + require proof of key ownership at registration |
