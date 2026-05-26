# Void Chat — Security Audit

**Date:** 2026-05-26
**Branch:** `main` (working tree clean at HEAD `e6ab98a`)
**Scope:** Code-level security, with emphasis on network privacy and communications confidentiality.
**Reviewer:** Claude (Opus 4.7)

---

**Bottom line:** the protocol design is sound (nacl.box per recipient, signed announce bound to a per-socket nonce, Tor sidecar, ephemeral identity). But three concrete bugs leak the privacy properties the app advertises, and one IPC/CSP chain turns any future XSS into permanent .onion-identity theft. Two of these are network-privacy bugs.

---

## CRITICAL — network privacy

### 1. Community avatar/banner is fetched over clearnet → real IP leaks to attacker
**Files:** `src/components/community/CommunityCard.tsx:159,173`, `src/components/layout/Sidebar.tsx:188`, `server/api.ts:192`

`api.ts` accepts up to 256 KiB of arbitrary string in the `avatar` field with no scheme/MIME validation:
```ts
const avatar = body.avatar ? sanitize(String(body.avatar), 256 * 1024) : null;
```
It's stored verbatim and returned to every client that lists or opens that community. Then the renderers do:
```tsx
<img src={community.icon} ... />
<img src={community.banner} ... />
```
A malicious community owner — or a compromised relay — sets `avatar` to `https://attacker.com/pixel.gif`. Every joiner's webview fetches that URL **directly over the open internet**, bypassing Tor entirely and handing the attacker the user's real IP. The browse page is the worst case: a user listing communities triggers the fetch without ever joining.

This is the exact threat Tor is supposed to defeat, and the marketing copy in `tauri.conf.json` implies it does ("never published," "ISPs see only Tor traffic").

**Fix:** at the API boundary, reject anything that isn't `data:image/(png|jpeg|webp|gif);base64,...` (which is fine — the Create modal at `CreateCommunityModal.tsx:53` already builds data URIs). Reject all `http://`/`https://` schemes. Apply the same to the `banner` field. The 256 KiB cap is roughly fine for data URIs but you can drop it once schemes are validated.

### 2. Relay can MITM e2ee by substituting `boxPublicKey` in roster
**Files:** `src/lib/realtimeClient.ts:370-379`, `src/types/wire.ts:28-37`, `server/socket-server.ts:202-272`

The relay verifies each user's announce signature server-side (`socket-server.ts:146`) — good — but **never forwards the signed binding to other clients**. The wire format for a roster entry is just `{signingPublicKey, boxPublicKey, displayName}` with no signature. Clients then encrypt to whatever `boxPublicKey` the relay claims belongs to a given member:
```ts
// realtimeClient.ts: roster from server is trusted blindly
for (const m of raw.members) {
  entry.roster.set(m.boxPublicKey, m);
  this.rememberPeer(m);
}
```
And the per-message send loop encrypts to `member.boxPublicKey` for every recipient.

In the single-host model (you trust your own relay) this is fine. But the README and project memory push the cross-host onion model where you join *a friend's* .onion — and the host of that .onion runs the relay. **That host can hand out their own box public key as every member's `boxPublicKey`**, intercept every message intended for any participant, decrypt with their own secret, optionally re-encrypt to the real recipient, and forward. The relay would see all plaintext. The whole "relay never sees plaintext" property is contingent on roster integrity that the protocol never enforces.

The same issue applies to `lookupBoxKey()` for DMs (line 211) — the peer cache is populated from relay-supplied rosters, so DMs to a peer you know only through a malicious relay's roster are also routed to the attacker's box key.

**Fix:** the announce already carries `sig` over `nonce|boxPublicKey|displayName|ts`. Have the relay store that and re-broadcast it as part of the roster. Clients verify `sig` against `signingPublicKey` before using `boxPublicKey`. Mismatched pairs get dropped. Optional belt-and-braces: have the joiner publish an out-of-band-verifiable identity (the signing key fingerprint shown in the UI), so a malicious relay can't even substitute the signing key without the user noticing on first contact.

---

## CRITICAL — exfiltration chain

### 3. `csp: null` + extractable wash key + ungated `tor_backup_keys` IPC = one XSS = permanent .onion identity theft
**Files:** `src-tauri/tauri.conf.json:23`, `src/lib/wash.ts:132`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs:10-18`

Treat these as one chain, not three findings:

- `tauri.conf.json`: `"security": { "csp": null }`. No CSP at all — the renderer can `fetch()` anything on the open internet, set arbitrary `<img src>`, load arbitrary `<script src>`. Tauri's own docs flag this as the primary defense for desktop webviews.
- `wash.ts:132,137`: the wash keypair is generated with `extractable: true` and `subtle.exportKey('jwk', privateKey)` is reachable from any JS in the page. Same for session keys, which are persisted as base58 in sessionStorage (`useSession.ts:43`).
- `capabilities/default.json` exposes only `core:default`, but the `invoke_handler` in `lib.rs` registers `tor_backup_keys` and `tor_restore_keys` with no per-window allowlist or arg-pattern gate. Any JS in the main window can `invoke('tor_backup_keys')` and get back the v3 hidden-service secret key, base64-encoded.

Composed: any XSS in the renderer (today's app code, a future dep update, a Lucide/Tailwind transitive, or a markdown renderer added next month) → JS calls `invoke('tor_backup_keys')` → JS POSTs the result to `https://attacker.com/` → attacker now permanently owns that .onion address. The v3 hidden-service secret is the .onion; whoever holds it *is* that identity. There's no rotation, no revocation. Onion-key backup also includes a passphrase prompt in the UI flow, but `tor_backup_keys` itself takes no passphrase — the IPC returns the raw secret unencrypted.

**Fix (do all three):**
1. Set a strict CSP. Minimum:
   ```
   default-src 'self'; connect-src 'self' ipc: http://ipc.localhost ws://localhost:* http://localhost:* http://127.0.0.1:*; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'
   ```
   No `https:` or `http:` in `connect-src` or `img-src` — that's the whole point of running on Tor. (See finding #1.)
2. Gate `tor_backup_keys`/`tor_restore_keys` behind a non-default capability that requires explicit user confirmation in the UI flow (the Tauri 2 capabilities system supports per-command ACL). At minimum, move them to a separate capability not granted to the main window by default — make Settings explicitly request it on a button press.
3. Generate the wash keypair as **non-extractable** and don't persist it across reloads. The cost is "user's SubPub changes on reload"; the gain is `subtle.exportKey` returning `InvalidAccessError` from XSS. Same for session keys — store them as IndexedDB `CryptoKey` handles rather than base58 strings in sessionStorage.

---

## HIGH

### 4. Localhost forward proxy at 127.0.0.1:11811 is an unauthenticated open .onion proxy
**File:** `src-tauri/src/proxy.rs`

The proxy accepts `GET /o/<onion>/...` from anything that can reach `127.0.0.1:11811` and dials it through Tor SOCKS. No origin check, no auth header, no token. On a multi-user box (Linux user sharing a desktop, dev VM, container with `--net=host`) any other process can use Void Chat's Tor circuit to reach arbitrary .onion services, attributed to the user. It also widens the renderer's attack surface — *any* JS that can issue `fetch('http://127.0.0.1:11811/o/<attacker-onion>/...')` reaches whatever the attacker is running.

**Fix:** require a per-session secret in the request line or a custom header. Generate it at proxy startup, pass it to the renderer via a Tauri command, drop the connection unless the header matches. Bonus: bind to a Unix socket or named pipe instead of a TCP loopback port so cross-user isolation is enforced by the OS.

### 5. CORS allows any `.onion` origin with `credentials: true`
**Files:** `server/socket-server.ts:185-194`, `server/api.ts:40-55`

```ts
if (new URL(origin).hostname.endsWith('.onion')) return cb(null, true);
```
Combined with `credentials: true` on socket.io, this means any onion origin can establish authenticated WebSocket sessions, and if you ever add anything cookie-flavored or `x-community-password`-flavored to a normal browser flow, it's accessible from arbitrary .onion pages. The argued justification ("only reachable through our onion") is true for inbound-via-Tor, but the relay is also bound to localhost (`3001`), so any local process can hit it with a forged Origin header and get the permissive ACAO.

**Fix:** scope the `.onion` origin allowance to a single onion — the relay's own hostname (which `tor.rs` already knows once the HS is up). Pass it into the relay process and only accept that exact origin.

### 6. Bundled Tor binary downloaded with no signature verification
**File:** `scripts/fetch-tor-binaries.sh`

`curl -fL --proto '=https' --tlsv1.2` to `archive.torproject.org` is fine for transport, but no GPG signature or sha256 check against a pinned hash. If torproject.org's archive is ever served compromised (or you build from a workstation with a tampered system root store), every shipped installer ends up with a backdoored Tor. The Tor Project signs every Expert Bundle release; verifying is `gpg --verify` against the Tor Browser developers' signing key (downloaded once and pinned in-repo).

**Fix:** ship `tor.keyring` in `scripts/`, fetch the `.asc`, gpg-verify, then extract. Alternatively pin a sha256 per version in the script and refuse to extract on mismatch.

---

## MEDIUM

### 7. `NEXT_PUBLIC_VOID_RELAY_URL` env override is a foot-gun in Tauri builds
**File:** `src/lib/realtimeClient.ts:93-99`

A leftover from the Next era. Vite inlines `process.env['NEXT_PUBLIC_VOID_RELAY_URL']` at build time; a developer who sets it to an HTTPS URL during build leaks the build's identity through any user who runs that installer. In Tauri, the relay is always localhost-via-Tor; the override should not exist in this build path.

**Fix:** delete the override. Hardcode localhost.

### 8. `imageUrl` for user avatars also reaches `<img src>` unfiltered
**File:** `src/components/ui/Avatar.tsx:130-135`, called from `Message.tsx:314`

Same shape as #1 but for sender avatars in messages. Today `sender.avatarUrl` always comes back as `undefined` so it's latent, but adding any UI to set a user avatar without scheme validation reopens the leak. Validate at the type boundary.

### 9. DM offline state confirms presence to senders
**File:** `server/socket-server.ts:405`

`dm:offline` tells the sender "this box public key has no online sockets right now." Combined with rate-limited polling, an attacker who knows a target's `boxPublicKey` can map online/offline transitions over time. Hidden-service latency masks fine-grained timing, but coarse presence still leaks. Not a confidentiality issue, but a metadata one for a privacy app.

**Fix:** consider responding identically (queue or drop) whether or not the recipient is online. The README already warns DMs don't persist when offline; making "offline" indistinguishable from "online but didn't reply" closes the oracle.

### 10. Display names spoofable, only shown as title-tooltip
**File:** `src/components/chat/Message.tsx:330-334`

Already a known/accepted limitation, restating it because the UI leans hard on display names and the truncated public ID is only visible on hover. In a public channel, an attacker calling themselves "Alice" is indistinguishable from real Alice unless someone hovers. Show the truncated signing-key fingerprint inline next to the name, at least for senders the user hasn't seen before.

---

## LOW / cleanup

- **`simple-peer` in `package.json` but never imported** — WebRTC bypasses Tor entirely via STUN. Today it's a dead dep; remove it before someone wires it up. Also drop `socket.io` from deps (vs devDeps) on the client side — only the server needs it.
- **scrypt with Node defaults (N=16384)** in `communityPassword.ts` — acceptable for a community gate, not 2026-strong. If you ever migrate community auth to anything more sensitive, move to argon2id.
- **Hand-rolled base64 in `tor.rs:706-763`** — works, but every roll-your-own crypto-adjacent helper is a maintenance smell. `base64 = "0.22"` adds ~50KB to the binary; cheap.
- **No identity TOFU prompt on first onion connect** — when a user pastes `id@xyz.onion`, the app trusts it. Display the full onion prominently before connecting; for repeat connects, warn if it changed.

---

## What's done well

- Per-recipient `nacl.box` fan-out keeps ciphertext recipient-specific; the relay genuinely can't decrypt.
- Connection-bound nonce + signed announce prevents replay of announces.
- The Tor sidecar is well-isolated, with shutdown handling, restart watchdog, and HiddenServiceDir permissions correctly set to 0o700.
- `verifyAnnounceSignature` correctly uses `nacl.sign.detached.verify` (matching the noble-vs-nacl interop quirk).
- No secrets in git history, no `.db`/`.env`/onion-key files tracked, `.gitignore` covers `data/`, `*.pem`, `src-tauri/binaries/`, env files.
- `messageStore.ts` namespaces by `boxPublicKey` so identity rotation naturally orphans old plaintext.
- `wash.ts` uses different primitive families from chat (P-256 / PBKDF2-AES-GCM vs. Curve25519/XSalsa20) — cracking one doesn't give you the other.

---

## Suggested order of attack

1. **Add CSP** (`tauri.conf.json`) and validate the avatar/banner scheme (`api.ts`) — these are one afternoon of work and close both the IP-leak and most of the IPC-exfil chain.
2. **Sign-and-verify rosters** (`socket-server.ts`/`realtimeClient.ts`) — this is the protocol fix; non-trivial, but it's what makes "the relay never sees plaintext" actually true cross-host.
3. **Gate `tor_backup_keys` IPC + make wash key non-extractable** — small Tauri capability + WebCrypto change, big risk reduction.
4. **Token-auth the local proxy** — protects against multi-tenant boxes and same-host malware.
5. Everything else as you can.

---

## Findings index

| # | Severity | Area | Title |
|---|----------|------|-------|
| 1 | CRITICAL | Network privacy | Avatar/banner clearnet fetch leaks real IP |
| 2 | CRITICAL | Communications | Relay can MITM e2ee via roster boxPublicKey substitution |
| 3 | CRITICAL | Exfiltration chain | csp:null + extractable wash key + ungated tor_backup_keys IPC |
| 4 | HIGH | Network | Unauthenticated localhost forward proxy on 11811 |
| 5 | HIGH | Network | Permissive `.onion` CORS with credentials |
| 6 | HIGH | Supply chain | Bundled Tor downloaded without GPG/checksum verification |
| 7 | MEDIUM | Build | NEXT_PUBLIC_VOID_RELAY_URL override foot-gun |
| 8 | MEDIUM | Network privacy | User avatar `imageUrl` unfiltered (latent) |
| 9 | MEDIUM | Metadata | DM offline status is a presence oracle |
| 10 | MEDIUM | UX/spoofing | Display-name spoofing — public ID only on hover |
