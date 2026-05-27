# Void Chat — Roadmap

Versioned, with honest priorities. This is what's planned, not what's
promised. Dates are not attached because the project has one maintainer
and `SecurityAudits/` worth of evidence that good things take time.

Items in each version are listed roughly in priority order.

---

## v0.1 (current)

Source-run release. Clone the repo, install deps, `yarn tauri:dev`.

**Working today:**

- Tor hidden-service routing (bundled Tor binary, no system install
  required)
- End-to-end encryption (nacl.box per recipient, signed announce
  bindings, client-side roster verification)
- Ephemeral identity per browser tab
- Cross-host invites via `<community-id>@<onion>`
- Wash off-band passphrase encryption + SubPub asymmetric mode
- Tor bridges support (lyrebird bundled for obfs4)
- Onion identity backup/restore with Wash-encrypted file format
- Five iterative security audits with documented fix-chain
  (`SecurityAudits/`)
- `THREAT_MODEL.md` + `SECURITY.md` (this version)

**Known gaps in v0.1, addressed in later versions:**

- Binary installer that bundles the relay process — see C1 in
  `SecurityAudits/2026-05-27_user-privacy-network-security-audit.md`.
  v0.1 builds via `yarn tauri:build` are incomplete artifacts and
  should not be distributed. v0.2 closes this.
- Encrypted-at-rest IndexedDB. Currently FDE is the floor.
- Forward secrecy beyond per-tab session isolation.
- Independent third-party audit.
- Reproducible builds.
- Cross-host community sidebar listing (you can join a remote `.onion`
  community but it doesn't appear in the sidebar; reload loses it
  until you re-paste the invite).

---

## v0.2 — Rust port + installer (next)

The single largest piece of work. Closes the C1 packaging gap and
sets up the foundation for everything after.

- **Port the Node relay (`server/`) to Rust.** Eliminates Node from
  the deploy footprint; makes the installer single-binary; enables
  ownership of schema management via `rusqlite`. Closes the
  installer-doesn't-bundle-relay gap. This is the work that unblocks
  shipping `.deb` / `.rpm` / `.dmg` / `.msi` artifacts to non-developer
  users.
- **Encrypted-at-rest IndexedDB** via Tauri 2's keychain plugin. Wraps
  an AES-GCM IndexedDB encryption key in OS-native credential
  storage (Keychain / Credential Manager / libsecret). Closes the
  "plaintext history on disk" gap (audit pt5 user-perspective #4).
- **scrypt → argon2id for community passwords.** Drop-in modernization;
  the LOW-severity finding flagged in every code audit. Includes
  rehash-on-login so existing passwords migrate forward without user
  action.
- **Reproducible-build pipeline.** Set up from the start of the
  installer story rather than retrofitted. Tor Browser's reproducible
  build infrastructure is documented and Tauri-compatible. Without
  this, every user has to trust the build pipeline of whoever
  published the binary; with this, anyone can build from source and
  bit-match the published artifact.
- **Cross-host community sidebar listing.** Joined remote `.onion`
  communities show up in the sidebar; reload preserves them. Closes
  the README's "tracked for next iteration" cliff.
- **GitHub Actions CI** for `tsc --noEmit`, `cargo check`, basic
  lint. Single PR check; no silent regressions in main.
- **Independent maintainer PGP key** populated in `SECURITY.md`
  (placeholder today).

**Not in v0.2:** the SubPub forward-secrecy work (v0.3), multi-device
(v0.4+), voice/video (uncommitted).

---

## v0.3 — Closed-session forward secrecy + UX layering

With the Rust relay stable, layer the privacy properties that the v0.1
session model can't provide.

- **SubPub-wash for historical messages.** Post-tab-close, IndexedDB
  history is wash-encrypted with the user's persistent SubPub key.
  Provides *closed-session* forward secrecy: compromising current
  session keys does not decrypt past sessions' history, because
  session keys (Curve25519) and storage keys (P-256 + AES-GCM via
  Wash) are independent cipher families with independent compromise
  surfaces.
  - SubPub key persists via OS keychain (same plugin as #2 above).
  - Loss of SubPub = loss of history (acceptable trade-off given the
    ephemeral-by-default ethos; same shape as losing your `.onion`
    key losing your address).
  - Wash-on-close by default (write plaintext during session, encrypt
    on tab close). Wash-on-write available as a paranoid mode setting
    for users who want the invariant always.
  - **Not** Signal-style per-message ratcheting. This is the
    architectural choice; see `THREAT_MODEL.md` for the framing.
- **TOFU UI for cross-host community joins.** Today the join flow
  refuses silent onion swaps (audit pt5 #L4) but the user has no UI
  surface to compare fingerprints when first connecting. v0.3 shows
  the full `.onion` prominently in the join modal so the user
  actively confirms.
- **`bridges.txt` discovery via Moat.** Settings → Tor bridges
  currently asks the user to paste lines from torproject.org. v0.3
  integrates the Moat protocol so bridges can be fetched from inside
  the app, including when the user is censored from torproject.org
  directly.
- **Per-channel UI feedback for relay-rejected messages.** Today
  "message rate exceeded" surfaces as a toast; v0.3 shows a clearer
  failure state on the message bubble itself (timeout / rate-limited
  / no recipients).
- **Wash key rotation surfaced in Settings.** Landed in v0.1 (audit
  pt5 L1 cleanup) — confirming it's documented here so the v0.3 docs
  are accurate.
- **`Code of Conduct` and `CONTRIBUTING.md`** as first-class repo docs.

---

## v0.4 and beyond (design exploration, not commitments)

These are on the design board. None are committed; ordering will
depend on user feedback after v0.3 ships.

- **Multi-device, Void-shape.** Not Signal-style (one master device
  with linked secondaries — that's a stable identity surface we
  deliberately don't want). Each device generates its own keypair;
  cross-device "linkage" is a wash-encrypted bundle the user
  explicitly transports (USB stick, QR code containing a washed
  string, etc.). Relay sees N independent identities; user mentally
  treats them as "me on phone, me on laptop." Avoids the
  "phone is source of truth" centralization Signal/Session inherit.
- **Voice/video.** Maybe. WebRTC over Tor is famously janky; the
  right shape is probably direct peer connections through `.onion`
  rendezvous rather than ICE/STUN/TURN over Tor. Cwtch has had this
  conversation and mostly decided it's not worth their threat model;
  we'd reach a similar conclusion unless there's specific demand.
- **Mobile (Android)** via Tauri Mobile. After the desktop story is
  fully stable.
- **Independent third-party audit.** Trail of Bits, Cure53, NCC
  Group are the realistic options. Cost: $50k–$200k. When funding
  allows.
- **Federated relay discovery.** A way to find communities without
  manual invite-paste, *without* introducing a central directory. No
  clear shape yet — DHT? Tor's HSDir? Out-of-band-only? The right
  answer is unclear.

---

## Non-goals

These are things Void Chat is **deliberately not** doing. Saying no
to these is part of the value proposition.

- **Feature parity with Signal/Discord** — voice rooms, video calls,
  payments, stickers, emoji reaction packs. Void Chat is not Signal;
  trying to be Signal makes it a worse Briar. Every feature that
  expands the surface dilutes the privacy story. We add features
  only when they don't compromise the threat model.

- **A web version.** The Tauri app's strict CSP, capability
  isolation, and native dialog gating are load-bearing parts of the
  security model. A pure-web (browser-tab) version would be much
  weaker, would have to drop several IPC-based defenses, and would
  dilute the brand by association.

- **Anonymous community discovery features** — global directories,
  "trending" communities, recommendation engines. Would require
  centralized infrastructure with exactly the metadata visibility the
  current architecture avoids. Communities are advertised
  out-of-band; that's intentional friction.

- **User accounts, ever.** The ephemeral-identity model is the value
  prop. Adding accounts would erase it.

- **Phone-number verification, email verification, captchas.** Same
  reasoning. The cost of these in privacy/anonymity is higher than
  the spam-protection benefit at the scale this tool operates. Spam
  resistance is provided by the trust boundary of the friend group +
  the per-community password gate.

- **Cloud sync.** Cloud is the opposite of self-host. If you need
  cross-device history transport, use the Wash flow to encrypt a
  bundle and move it via a storage medium of your choice.

- **Telemetry of any kind.** No "anonymous usage statistics," no
  crash reporting that calls out, no auto-update phoning home. The
  user explicitly checks for updates by visiting the repository.

---

## How to contribute

Read `THREAT_MODEL.md` and `SECURITY.md` first. Then:

- **Issues** — feel free to open one for any non-security finding,
  feature suggestion, or design discussion.
- **PRs** — small, focused, with a clear "why" in the description.
  Match the existing comment style (explain *why* a piece of code
  exists, not *what* it does). Comments documenting non-obvious
  threats and the audit findings that introduced fixes are
  particularly welcome.
- **Security findings** — see `SECURITY.md` for the encrypted
  disclosure path. Do not open public issues for security work
  until coordinated disclosure has completed.
- **Audit work** — independent passes against the documented threat
  model are extremely welcome. Drop a dated file in
  `SecurityAudits/` matching the existing format; we'll triage and
  fix in the open.

The project is at the stage where every contributor changes the
trajectory. The audit history shows what "taking findings seriously"
looks like; if you're considering a contribution, that's the standard
to read in.
