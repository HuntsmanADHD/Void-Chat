# Security & privacy audit — pure-Java stack (Phase C)

Date: 2026-06-11. Scope: the `seal-java` + `relay-java` + `client-java`
modules on `rework/zero-runtime-deps`, audited after the Phase-B
optimization so this covers final code. Method: the `security-review` skill
(sub-agent, traced to ground truth) + manual crypto/privacy/input sweeps.

**Result: no Critical or High findings. No Medium findings.** A handful of
Low / informational items are recorded below with their rationale. The
release gate (C/H = 0) is met.

---

## Crypto checklist

| Check | Result |
|---|---|
| AEAD (Poly1305) tag compare | constant-time `Seal.ctEqual` — verified |
| Password/delete-token verify | Argon2 `MessageDigest.isEqual`; scrypt-legacy `MessageDigest.isEqual` — constant-time |
| Randomness | `SecureRandom` everywhere security-relevant (nonces, msgId, salts, WS masks, SOCKS not applicable). No `Math.random`/`new Random` in non-test code |
| Nonce regime | random 24-byte XChaCha nonces (sound by construction); no buffer reused across seals |
| Argon2 params | id, m=19456 KiB (relay pw) / 64 MiB (identity), t≥2, length caps enforced |
| `beforenm` LRU cache (new) | cache key = SHA-256(mySecret‖theirPublic), both fixed 32 B (length-checked before use); returns `.clone()`; evicted keys scrubbed. **Cannot** return a box key from a different keypair — traced |
| Ed25519 verify | JDK verifier, fails closed on malformed sig/key |
| Key zeroization | identity passphrase + derived key + plaintext buffers `Arrays.fill`-scrubbed after use |

The lone `Arrays.equals` in non-test code (`VoidChatApp.java:387`) compares
the two passphrase-entry fields the user just typed — not a secret-vs-attacker
comparison, so no timing channel.

## Protocol / authorization (relay can't be trusted)

- **DM attribution**: AEAD-decrypt under the claimed sender box key (fails
  closed if the relay lies), then `verifyDM` over the canonical
  `signPub‖boxPub‖recipient‖nonce‖ct` tuple, then cross-check
  `senderBoxPub == bindingSignToBox[senderSignPub]` where bindings are
  learned only from join-sig-verified roster members. A malicious relay
  cannot forge the Ed25519 sig nor substitute a binding it lacks the key
  for. Verified.
- **Roster join sigs** bind to the specific `channelId`, blocking
  cross-channel replay. Members failing verification are dropped.
- **Announce handshake** verifies the signed nonce‖box‖name‖ts tuple with
  strict field-shape checks.

## Input hardening (hand-rolled parsers fail closed)

Every parser treats malformed input as a hard error (close/throw), never as
smuggling or auth state. Caps confirmed present:

| Surface | Cap |
|---|---|
| JSON nesting depth | 64 (`Json.java`) |
| HTTP request headers (server) | 32 KiB / bounded count (`HttpServer`) |
| HTTP response headers (client) | 64 KiB (`RelayHttpClient`) |
| HTTP body (server) | 512 KiB |
| HTTP response body (client) | 4 MiB |
| WS frame (both ends) | 256 KiB |
| WS handshake response | 16 KiB |
| Ciphertext (relay) | 96 KiB |
| Avatar | 256 KiB |
| Plaintext seal | 64 KiB |
| Password length | 4–128 |

A 64-bit WS length with bit 63 set bypasses the `> MAX` check (it's a
negative `long`) but then hits `NegativeArraySizeException`, which is caught
→ connection closed. Fail-closed; DoS-class only.

## Subprocess / Tor

- `Tor.java` spawns `tor` (or `$VOIDCHAT_TOR_BINARY`, operator-controlled)
  via `ProcessBuilder` with an explicit arg array — **no shell**, no
  injection surface.
- torrc is built only from `stateDir`-derived absolute paths + an
  internally-chosen free port; no network/peer input reaches it.
- `SocksPort 127.0.0.1:…`, `ControlPort 0` (control port disabled),
  `HiddenServicePort 80 127.0.0.1:<relay>`, `SafeLogging 1`.

## Privacy

- **Binds are loopback-only**: relay `ServerSocket(port, 128,
  InetAddress.getByName("127.0.0.1"))`; tor SOCKS on 127.0.0.1; control port
  off. The relay is reachable only via the local renderer or the onion.
- **DNS-leak-proof outbound**: `Transport` SOCKS5 is domain-ATYP only — the
  hostname (an `.onion`) goes to the proxy verbatim, never resolved locally.
  Enforced by `TorTransportTest` (a fake `.onion` only the proxy can map).
- **Log hygiene**: at the default log level nothing prints plaintext, keys,
  or onion-correlatable secrets. Relay trace prints state/event names only;
  `tor` runs with `SafeLogging 1`.
  - **Low-1**: `VoidChatApp` prints UI lines (which include message text) to
    stderr **only** under `VOIDCHAT_DEBUG=1` — an opt-in debug mode, off by
    default. Acceptable for v0.1; documented here. Release builds should keep
    it gated (it already is; env var is a trusted input).

### Disk inventory (what exists at rest, and what it leaks if the device is seized)

| Path | Contents | Exposure |
|---|---|---|
| `~/.voidchat/identity.json` | Ed25519 + X25519 secret keys, display name | **Plaintext 0600 by default** — full identity if read. Opt-in passphrase encryption (Argon2id + XChaCha20-Poly1305) seals it; then only KDF params + salt + nonce + ciphertext on disk |
| `~/.voidchat/pinned.json` | pinned community names + relay/onion URLs + ids | reveals which communities you frequent (0600) |
| `~/.voidchat/passwords.json` | **plaintext** community passwords (cache) | 0600; sealed only indirectly — see Low-2 |
| `~/.voidchat/hosts.json` | recently-connected relay/onion URLs | reveals contacts/servers (0600) |
| `~/.voidchat/host/data/voidchat.json` | hosted communities/channels directory | host-side only |
| `~/.voidchat/host/tor/onion/` | **v3 onion ed25519 secret key** (your server identity) | 0700; possession = ability to impersonate your onion. Back up to keep the address; treat as a secret |
| `~/.voidchat/{host,tor-client}/tor/tor-data/` | tor's own state | standard tor data |

- **Low-2**: `passwords.json` and `pinned`/`hosts` are plaintext 0600 and are
  **not** covered by the identity passphrase. For v0.1 this matches the TS
  client's localStorage exposure and is documented, not silently shipped. A
  post-v0.1 hardening is to seal the whole `~/.voidchat` under the same
  passphrase, or drop the password cache in favor of always-prompt.
- **Low-3 (UX, not a weakness)**: a first-contact DM from someone you've
  never shared a roster with surfaces as `⚠ unverified` because no binding
  exists yet. This fails *closed* (correct); noting so it isn't mistaken for
  a bug.

## Abuse resistance

- Rate limits cover announce / join / channel-send / DM and the HTTP API
  (carried from the Rust relay; `Realtime` `RateBucket`, `Api` `RateBucket`).
- Broadcast is collect-then-send (lock dropped before sending), so one slow
  consumer can't stall fan-out.
- Read paths have EOF/timeout handling; no unbounded blocking read without a
  cap.

---

## Disposition (security-review skill)

- **Critical / High**: none → nothing for `/fix-audit` to apply.
- **Low-1/2/3**: documented; no code change required for v0.1. Low-2 is the
  one worth a follow-up (whole-profile encryption) and is logged for
  post-v0.1.

---

## Pre-prod correctness audit (`/pre-prod-audit`, 6 parallel agents)

Ran after the security review as defense-in-depth. The agents over-reported;
each candidate was re-checked against the code. **False positives** (verified
non-issues): heartbeat "stops after reconnect" (the fixed-rate task persists
and re-reads the volatile `ws`); LocalStore "reentrant deadlock" (Java
`synchronized` is reentrant); DM-maps "data race" (all `dmTab` calls run
inside `invokeLater`, i.e. on the EDT); DM-binding "race" and relay-
reattribution (both fail closed — join sigs can't be forged); Content-Length
"2 GB alloc" (`readN` caps it). **Real issues fixed** (all retested green):

| Fix | File | Why |
|---|---|---|
| Announce `ts < 0` reject | `Realtime.java` | `Math.abs(nowMs - Long.MIN_VALUE)` overflows negative, slipping past the skew check. Input-validation defense-in-depth |
| Constant-time nonce compare | `Realtime.java` | `String.equals` → `MessageDigest.isEqual` on the announce challenge |
| Relay store file `0600` | `Store.java` | `voidchat.json` holds Argon2 password/token *hashes*; now owner-only like the client files |
| WS read idle-timeout (90 s) | `WebSocket.java` (relay) + `WsClientConnection.java` (client) | a silently dropped Tor circuit left a half-open socket blocking the reader forever — no `onClose`, no reconnect/reap. Timeout → `IOException` → disconnect cleanup → client redials. **The biggest reliability fix.** |
| SOCKS/handshake/request timeouts | `Transport.java`, `WsClientConnection.java`, `RelayHttpClient.java` | a stalled proxy or relay can no longer hang the caller thread indefinitely |
| RFC 6455 control-frame ≤125 B | both WS ends | rejects oversized ping/pong (RFC compliance; kills a small amplification) |
| Content-Length parsed as bounded `long` | `RelayHttpClient.java` | a hostile relay's non-numeric / >2³¹ Content-Length now yields a clean `IOException`, not an uncaught `NumberFormatException` |
| Relay host allowlist (loopback or `.onion`) | `RelayHttpClient.java` | blocks being tricked into cleartext HTTP to an arbitrary internet host — enforces the Tor-only threat model |
| Untrusted display-name clamp (64) | `VoidClient.java` | join sig doesn't cover `displayName`, so a hostile relay could supply a huge string; clamped for UI safety (identity is the verified key) |

**Deferred (documented, not v0.1 blockers):** client-side `$ack` correlation
so a relay-side send rejection (e.g. RATE_LIMITED) surfaces to the UI instead
of failing silently — a feature, not a security bug; `tor` PATH-hijack
hardening (use `VOIDCHAT_TOR_BINARY` / absolute path) — out of the threat
model (needs an attacker-writable PATH entry).

Full suite re-run after fixes: **416 assertions, 0 failures.**
