# Production plan — Void Chat pure-Java v0.1

Goal: first shippable release of the zero-dependency Java stack
(`seal-java` + `relay-java` + `client-java`), with an explicit
**optimization pass** and a **security & privacy audit layer** before
anything is tagged. Plain JDK only, end to end — no jars, no build system,
nothing beyond `javac` and the JDK's own packaging tools.

## Where we are (proven baseline, 2026-06-11)

- 364 test assertions green across the three modules.
- **Live Tor round-trip proven** (`LiveOnionTest`, 9/9): relay published as a
  real v3 onion via the managed tor process (`relay-java/Tor.java`), client
  dialed back through real Tor circuits, E2E message + verified DM.
- Engine is pure `java.base` (`jdeps`-verified); hand-rolled SOCKS5,
  RFC 6455 client+server, HTTP/1.1 client+server, JSON, Argon2id, Blake2b,
  scrypt, ChaCha20/Poly1305/XChaCha, Base58.
- relay-java is wire-compatible with the TS client; the XChaCha seal is
  already cut into the TS client (`voidseal.ts`), byte-proven both ways.

---

## Phase A — Feature completion (the v0.1 surface)

The release story is: **one app = host + client**, like the Tauri model.

1. **Host mode in the GUI.** All pieces exist; this is wiring. A "Host"
   toggle in `VoidChatApp` boots `Main.start` (relay) in-process +
   `Tor.start`, shows bootstrap %, then the onion address + a copyable
   invite. Joining stays as-is (relay URL field + `Transport`).
2. **Local stores** (parity with the TS client's pinned-chats feature):
   pinned/recent communities, community password cache, known-hosts list.
   One JSON file each under `~/.voidchat/`, `0600`, same atomic-write
   pattern as `Store.java`.
3. **Identity passphrase encryption (opt-in).** `identity.json` sealed with
   Argon2id (KDF) + XChaCha20-Poly1305 — both already in-stack. GUI
   passphrase prompt on startup; skipping keeps today's plaintext-0600.
4. **GUI completion to "usable by a friend":** password prompt on gated
   communities, DM conversation view (currently inline in the channel log),
   message timestamps, connection-status line (incl. tor bootstrap %).
5. **Message history: recommend shipping WITHOUT.** Ephemerality is the
   product ethos and the TS client doesn't persist either. Decision noted
   below; revisit post-v0.1 if at all.

## Phase B — Optimization layer

Measure first: add a small `Bench.java` (seal/open throughput, channel
fan-out at 50 members, relay frame echo rate, app startup). Optimize only
what the numbers indict. Known candidates, found by reading the code:

1. **`Box.beforenm` cache (the real win).** `sealForRecipient` recomputes
   the full X25519 ECDH + HChaCha per recipient per message
   (`seal-java/Box.java:65`), so a channel send is O(N · ECDH). libsodium's
   beforenm/afternm split exists exactly for this: cache
   `recipientPub → boxKey` (bounded LRU; sender key is fixed per identity).
   Channel sends become amortized one cheap AEAD per recipient.
   Correctness gate: the existing 600-case libsodium cross-check must stay
   green with the cache on.
2. **`VoidChatApp.append` is O(n²)** — `setText(getText() + line)` re-copies
   the whole log per message. Switch to `Document.insertString` + a
   line cap.
3. **Store writes:** full-file rewrite per mutation is fine at friend scale;
   debounce only if the bench disagrees. Do not gold-plate.
4. **Footprint/startup:** measure; the jlink work in Phase D is the lever.

## Phase C — Security & privacy audit layer

Runs AFTER Phase B so the audit covers final code. Output: an
`AUDIT_JAVA.md` with findings rated C/H/M/L; all C+H fixed before tag.

1. **Tooling passes:** `/pre-prod-audit` and `/security-review` on the
   branch, then `/fix-audit` on the findings.
2. **Crypto checklist** (verify, fix where wrong):
   - Constant-time compares wherever secrets are compared. Verified today:
     AEAD tag (`Seal.ctEqual`), Argon2 verify (`MessageDigest.isEqual`).
     Still to sweep: delete-token verify, any remaining `Arrays.equals` on
     secret material.
   - `SecureRandom` everywhere randomness is security-relevant (sweep for
     `Math.random`/`new Random`).
   - Nonce regime: random 24-byte XChaCha nonces are sound by construction —
     assert no path reuses a nonce buffer.
   - Best-effort key zeroization (`Arrays.fill`) after passphrase/KDF use.
3. **Hostile-input fuzz pass:** mutate valid wire frames (truncation, type
   confusion, huge numbers, deep nesting, invalid UTF-8) against
   `Json` + `Realtime` + `HttpServer`; nothing may throw uncaught, hang, or
   echo internals in error messages. Confirm every cap: JSON depth, frame
   size, body size, header size, recipients-per-send, rate limits.
4. **Privacy sweep:**
   - Log hygiene: no plaintext, keys, or onion-correlatable data at default
     log level. `VOIDCHAT_DEBUG`/`VOIDCLIENT_TRACE` print message text —
     must be compile-out or hard-gated for release builds.
   - `SafeLogging 1` in the generated torrc; tor state dirs 0700 (done);
     identity/store files 0600.
   - DNS-leak proof: domain-ATYP only (already test-enforced by
     `TorTransportTest`).
   - **Disk inventory documented:** exactly what exists at rest (identity,
     store JSON, tor keys, pinned list) and what each leaks if seized.
   - Loopback-only binds for relay and SOCKS (verify both).
5. **Abuse resistance:** verify rate-limit coverage (announce/join/send/HTTP),
   read timeouts (slowloris), and that one slow consumer can't stall fan-out
   (collect-then-send discipline carried over from the Rust relay).

## Phase D — Packaging & distribution

All JDK-native tooling — the zero-dep rule applies to the build too.

1. `build.sh`: `javac` → jars with `Main-Class` → **jlink** minimal runtime
   (`java.base` + `java.desktop`) → self-contained directory; **jpackage**
   for native artifacts (.AppImage/.deb, .msi, .dmg) as a stretch.
2. **Tor binary policy for v0.1: require system tor** (document
   `pacman -S tor` etc., `VOIDCHAT_TOR_BINARY` override). Bundling per-OS
   tor binaries (the Tauri approach) is post-v0.1.
3. README quickstart: the two flows (host a community / join via onion),
   threat-model summary, backup story (`<data>/tor/onion/` = your address).
4. Repo hygiene: mark the TS/Rust stack's role (reference implementation vs
   deprecated) in the top-level README.

## Phase E — Release gates (definition of done for v0.1)

- [ ] Full suite green on the release build (364+ and growing)
- [ ] `LiveOnionTest` green on the release artifact
- [ ] **Two-machine test:** a second physical machine joins your onion,
      messages flow both ways, survives a reconnect (the one thing no test
      here can replace)
- [ ] 24 h soak: idle connection stays alive across Tor circuit rotation;
      no memory growth
- [ ] Interop decision exercised: either a TS client joins a Java relay live
      (wire contract claim proven end-to-end) or v0.1 is declared Java-only
- [ ] Audit: all C/H findings fixed, M findings documented in AUDIT_JAVA.md
- [ ] `jdeps` clean: `java.base` (+ `java.desktop` for the GUI) only
- [ ] Tag `v0.1.0-java`, artifacts attached, branch merged

## Open product decisions (need your call, in Phase A)

1. **Message history:** recommend shipping without (ephemeral ethos).
2. **Tor:** system tor for v0.1 (recommended) vs bundled binaries.
3. **App shape:** single GUI with host toggle (recommended; relay CLI stays
   for servers) vs separate host/client apps.
4. **TS/Rust stack:** keep as in-tree reference (recommended) or split out.

## Order & rough effort

A (2–3 sessions) → B (1) → C (1–2) → D (1) → E (user-paced).
Commit + push at every phase boundary — that's the checkpoint discipline
that already saved this branch once.

---

## Progress log

**2026-06-11 — Phases A + B done, suite at 416 assertions, all green.**

- **A1 Host mode**: `HostRuntime.java` (store+relay+tor in one call), GUI
  "Host over Tor" button with bootstrap %, copyable onion invite; joining an
  `.onion` auto-starts a client-only tor (`Tor.startClient`, no hidden
  service) when no SOCKS is configured. Tests: `HostRuntimeTest` (9),
  client-mode additions in `TorHostTest` (16 total). `SafeLogging 1` now in
  every generated torrc.
- **A2 Local stores**: `LocalStore.java` — pinned communities (quick-connect
  combo + Pin/Unpin button, auto-opens the pinned community after connect),
  community-password cache (401 → cached → prompt → cache), recent-hosts
  MRU. `LocalStoreTest` (19).
- **A3 Identity encryption**: opt-in sealed identity file —
  Argon2id(m=64 MiB,t=3,p=1, params stored per-file) → XChaCha20-Poly1305;
  wrong passphrase = retry, never a fresh identity; GUI "Identity…"
  set/change/remove; `VOIDCHAT_ID_PASSPHRASE` for headless; key/passphrase
  buffers zeroized. `IdentityCryptoTest` (19).
- **A4 GUI completion**: per-peer DM conversation tabs (double-click roster),
  relay timestamps in message lines, O(n²) `setText` append replaced with
  `Document.insertString` (the Phase-B GUI item, done early).
- **B Optimization**: `Bench.java`; `Box.beforenm` LRU cache (SHA-256
  composite key, evicted entries scrubbed). Before → after on this machine:
  seal same-peer 10.7k → **92k ops/s**, 50-peer channel send 227 →
  **3.9k sends/s**, open 11.6k → **264k ops/s**. Correctness gates re-run
  green: SealTest vectors, **libsodium 600-case cross-check**, TS↔Java
  `seal-compat.mjs` byte-equality. JSON measured a non-issue (~400k
  frames/s); store-write debounce skipped (bench did not indict it).

Next: **Phase C audit** — run against a committed checkpoint.
