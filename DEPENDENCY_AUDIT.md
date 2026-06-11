# Dependency Audit — runtime trust-surface reduction

Goal (as scoped): **(1) shrink the runtime dependency surface** — remove/replace
libraries that ship to the user with vendored standard-platform code — and
**(2) vendor + pin the audited crypto** so nothing security-critical is fetched
at install time. Explicitly **out of scope**: rewriting React in vanilla JS, and
hand-rolling crypto.

A note on terminology this audit uses throughout:

- **Ships to user** = code that ends up in the bundle running on the user's
  machine. This is the only trust surface that matters for the stated goal.
- **Build-time** = tooling that transforms code but ships nothing. Removing it
  changes the user's trust surface by **zero**, so it is out of scope.
- **Vendor + pin** = copy the dependency's reviewed source into the repo, pin a
  checksum, import it locally. Keeps audited code; removes install-time fetch.

---

## Runtime dependencies

| Package | Ships? | Used in | Verdict | Effort / risk |
|---|---|---|---|---|
| `react` | yes | 38 imports | **Keep** (bucket 3, declined) | — |
| `react-dom` | yes | core render | **Keep** | — |
| `react-router-dom` | yes | 14 imports | **Keep** | — |
| `@tauri-apps/api` | yes | 5 files (Tor/proxy status, relayBase, onionBackup, Settings) | **Keep** — required by Tauri; removing it means removing the desktop shell | — |
| `socket.io-client` | yes | 1 file (`realtimeClient.ts`) | **Replace → raw WebSocket** (bucket 1) | **HIGH — coupled to Rust relay** |
| `zod` | yes | `wireSchemas.ts`, `CreateCommunityModal.tsx` | **Replace → hand validators** (bucket 1) | Medium — security-sensitive |
| `lucide-react` | yes | 18 files, 29 distinct icons | **Replace → vendored inline SVGs** (bucket 1) | Low, tedious |
| `@fontsource/inter` | yes | `main.tsx` | **Self-host woff2, drop pkg** (bucket 1) | Low |
| `@fontsource/jetbrains-mono` | yes | `main.tsx` | **Self-host woff2, drop pkg** (bucket 1) | Low |
| `tweetnacl` | yes | crypto core (`box`, `sign`) | **Vendor + pin** (bucket 2) | Low — audited, zero-dep |
| `tweetnacl-util` | yes | base64/utf8 helpers (~30 LOC) | **Inline + drop pkg** (bucket 2) | Trivial |
| `bs58` | yes | base58 encode/decode, 5 files | **Vendor + pin** (bucket 2) | Low |
| `@noble/ed25519` | — | **none** | **DELETE — dead dependency** | Trivial |

### Dead code (delete, not in any bucket — pure win)

- **`src/lib/communityPassword.ts`** — imports Node's `crypto` (`scrypt`,
  `randomBytes`, `timingSafeEqual`) and `util` (`promisify`). **Zero importers.**
  Leftover from the Next.js API-route era; password hashing now lives in the
  Rust relay (`argon2`). Deleting it removes the *only* Node-builtin imports in
  the front end — which is significant, because the Vite config has **no** node
  polyfill, so this file would not even bundle correctly in the Tauri webview.

---

## Build-time only — OUT OF SCOPE (ships nothing to the user)

`vite`, `typescript`, `@vitejs/plugin-react`, `vite-tsconfig-paths`,
`tailwindcss`, `postcss`, `autoprefixer`, `eslint`, `@tauri-apps/cli`,
`@types/*`, `fake-indexeddb`.

Removing any of these changes the user's runtime trust surface by **zero**.
Tailwind/PostCSS transform CSS that *does* ship, but the tooling itself does
not run on the user's machine. Out of scope for this effort.

---

## The one that isn't a client-only swap: `socket.io-client`

`realtimeClient.ts` uses socket.io for: the Engine.IO handshake, named events
(`socket.on(WIRE.*)`), and **ack-gated emits** (`emitWithAck` relies on
socket.io's per-message ack ids). The relay implements the *server* half via the
Rust crate `socketioxide = "0.16"` (`relay/Cargo.toml`).

Socket.IO is a framing protocol on top of WebSocket (Engine.IO handshake, packet
type bytes, ack-id correlation, optional namespaces). **You cannot replace the
client without also replacing the server.** Swapping to raw `WebSocket` means:

1. Define a minimal JSON message envelope (`{type, id?, data}`) to replace
   socket.io packets, including an ack-id scheme to preserve `emitWithAck`.
2. Rewrite the relay's socket.io handlers (Rust) onto Axum's raw `ws` upgrade
   (already a dependency) with the new envelope.
3. Re-test the full handshake → announce → join → roster → message path,
   including reconnect/backoff (socket.io currently provides `reconnection`).

This is the highest-effort, highest-risk item and it touches the Rust relay. It
should be its own phase with explicit sign-off — a bug here breaks all
connectivity, not just one screen.

---

## Recommended execution order (lowest risk → highest)

Done on a branch, committed in stages so each is a checkpoint:

- **Phase 0 — dead code (zero risk):** delete `communityPassword.ts`; remove
  `@noble/ed25519` from `package.json`.
- **Phase 1 — trivial inlines (bucket 2): ✅ DONE.** Inlined `tweetnacl-util`
  as `src/lib/naclUtil.ts` (byte-for-byte behavior, incl. throw-on-invalid +
  multibyte round-trip, verified against `Buffer`); dropped the package and its
  ambient `.d.ts`. typecheck + build green.
- **Phase 2 — fonts (bucket 1): ✅ DONE.** Vendored 40 woff2 files (Inter
  400/500/600/700 + JetBrains Mono 400/500, all subsets) into `public/fonts/`;
  generated `src/fonts.css` from the `@fontsource` `@font-face` declarations
  (woff2 only — universally supported in the Tauri webview; dropped the legacy
  woff fallback); replaced the 6 CSS imports in `main.tsx` with one; dropped
  `@fontsource/*`. Verified all 40 refs resolve in `dist/`, no `@fontsource`
  left in `dist`. typecheck + build green.
  Regenerate transform: read each `@fontsource/{inter,jetbrains-mono}/<wt>.css`,
  strip `, url(./files/*.woff) format('woff')`, rewrite `url(./files/` →
  `url(/fonts/`, concatenate to `src/fonts.css`.
- **Phase 3 — crypto migration to noble (bucket 2): ✅ DONE.** Scope upgraded
  from "vendor tweetnacl" to a full migration onto Paul Millr's audited stack
  (user decision — standardize on the actively-maintained noble ecosystem).
  - Added `@noble/curves`, `@noble/ciphers`, `@scure/base` (depend-pinned;
    lockfile integrity-checks them; noble has zero transitive deps beyond
    `@noble/hashes`). Removed `tweetnacl`, `bs58`, and its transitive `base-x`.
  - `src/lib/nacl.ts` — tweetnacl-API-shaped shim on noble. `nacl.box`
    reproduces NaCl's `crypto_box` exactly: X25519 ECDH → `hsalsa`
    (audited primitive, NOT hand-written) → `xsalsa20poly1305`. `nacl.sign`
    maps tweetnacl's 64-byte secret (seed‖pub) to noble's 32-byte seed.
    Single audited boundary; all call sites + key/storage formats unchanged.
  - `src/lib/base58.ts` — shim over `@scure/base`.
  - **PROVEN, not assumed:** `scripts/nacl-compat.mjs` byte-compares the
    shipping shims to tweetnacl/bs58 — box ciphertext equality both directions
    + interop + tamper-reject (400 vec), the canonical NaCl box test vector,
    ed25519 cross sign/verify (300 vec), x25519 derivation (100 vec), base58
    incl. leading-zero edges (300 vec). All pass. typecheck + build green.

  **Residual gaps (cannot close in this sandbox — verify before shipping):**
  1. **Live mesh:** byte-equality is proven offline, but a real two-client
     encrypt→relay→decrypt against the running Rust relay was not exercised.
     Run one two-instance smoke test.
  2. **ed25519 verification criteria:** acceptance of *honestly-generated*
     sigs is proven identical across tweetnacl/noble/(dalek via cross-verify).
     The acceptance set for *adversarially* non-canonical/small-order sigs
     (ed25519's well-known cofactor/ZIP215 divergence) was not exhaustively
     compared between noble (client) and `ed25519-dalek` (relay). If malleable
     sig edge-cases are in scope, confirm both agree.
- **Phase 4 — icons (bucket 1): ✅ DONE.** Replaced `lucide-react` with
  `src/lib/icons.tsx` — the **42** icons actually in use (the earlier "29" was
  an incomplete one-line grep), geometry copied verbatim from lucide-react
  v0.555.0 (ISC) `__iconNode` data, with a base `Icon` + `createIcon` that
  faithfully mirror lucide's `Icon.js`/`createLucideIcon.js` (same defaults +
  prop API: `size`/`color`/`strokeWidth`/`absoluteStrokeWidth`/`className`), so
  call sites are unchanged. Repointed all 18 importers; dropped `lucide-react`.
  Build confirms vendored paths land in the bundle. typecheck + build green.
  Regenerate: iterate `node_modules/lucide-react/dist/esm/icons/*.js`, match
  `toPascalCase(filename)` to the needed set, import each `__iconNode` (follow
  `export … from './x.js'` alias files to the real geometry), emit `createIcon`
  lines.
- **Phase 5 — wire validation (bucket 1): ✅ DONE (hand-reimplemented).** User
  chose reimplement over vendor-pin. `src/lib/validate.ts` reimplements the
  exact `zod` subset used (`string/number/boolean/object/literal/enum/array`,
  `.min/.max/.int/.regex/.optional/.strict`, `safeParse` with `.error.issues`
  AND `.error.errors`). Security semantics preserved deliberately: `.strict()`
  rejects unknown keys, non-strict strips them, length/array caps, `int`
  rejects non-integer/NaN/Infinity, exact literal/enum matching, `optional`
  permits absent-but-validates-when-present. Repointed `wireSchemas.ts`
  (`z.ZodSchema<T>` → exported `Schema<T>`) and `CreateCommunityModal.tsx`;
  dropped `zod`. Bundle 536→499 KB.
  - **PROVEN:** `scripts/validate-compat.mjs` rebuilds the full wire schema graph
    under both the new validator and real zod, fires valid + adversarial inputs
    (unknown keys, null, wrong types, missing required, 128/129 + 512/513 length
    boundaries, non-integer ts, ciphertext at/over cap, members 2048/2049, bad
    enum/literal) — decisions match on all cases. typecheck + build green.
  - **Minor residual:** validator error-message *text* is zod-like but not
    byte-identical to zod's. Only surfaced in the create-community form UI
    (`err.message` per field) — not a security or wire concern.
- **Phase 6 — transport (bucket 1, COUPLED TO RUST): ✅ DONE (pending live Tor
  test).** Replaced `socket.io-client` + the relay's `socketioxide` with a raw-
  WebSocket `{t,d,id}` envelope (`$ack`/`$ping`/`$pong` reserved). See
  `PHASE6_PLAN.md` for the full design. Client: `src/lib/wsConn.ts` (manager +
  `wsUrlFor`), `realtimeClient.ts` repointed. Relay: `realtime.rs` transport
  rewritten (manual rooms, collect-then-send broadcasts), `GET /ws` route,
  dropped `socketioxide` + added `futures-util`. Proxy: no change (upgrades off
  the `Upgrade:` header). Verified: `scripts/wsconn-test.mjs` (client unit) +
  `scripts/relay-mesh-smoke.mjs` (two-client local mesh) both pass; typecheck +
  `cargo build` + client build green; bundle 536→460 KB.
  **Residual gap:** cross-host two-instance test over Tor — sandbox can't run it;
  user must verify before shipping.

### Icons in use (for Phase 4)

NOTE: the list below came from a one-line-per-import grep and is INCOMPLETE —
multi-line `lucide-react` import blocks (e.g. `OnboardingModal.tsx`:
ChevronLeft, ChevronRight, Share2, Eye as EyeIcon) were missed. Re-run a
multi-line-aware census immediately before Phase 4.

Partial set: AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, Check,
CheckCircle, Copy, Crown, Download, Eye, EyeOff, Globe, Hash, Info, Key,
KeyRound, Lock, MessageCircle, Plus, RefreshCw, Server, Shield, Sparkles,
Trash2, Upload, Users, UserX, X, Zap (+ ChevronLeft, ChevronRight, Share2).
