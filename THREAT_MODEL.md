# Void Chat — Threat Model

What Void Chat protects against, what it doesn't, and what threat models
it's appropriate for. Read this before deciding whether to use it.

This is not the marketing pitch. It is the honest list of properties.
Where Signal would say "private," we say "private from X but not from Y,
here's how to think about Y."

---

## Who this is for

Small groups of technically literate people who want their conversations
private from the relay operator, their ISP, and the recipient's ISP.

It is **not** designed for high-stakes journalism involving state level
adversaries, and you should not use it as your only defense in that
context. For that use case, assume this is the wrong tool.

---

## Protected against

### The relay operator

The machine your messages route through.

- **Cannot decrypt messages.** Per-recipient `nacl.box` ciphertext.
  Encryption happens client-side before the relay sees anything. The
  relay never receives plaintext.
- **Cannot substitute keys to MITM the e2ee.** Every roster member's
  box public key is bound to their signing key by an ed25519 signature
  the relay can't forge. Clients verify the binding before encrypting
  to anyone (`src/lib/realtimeClient.ts` `verifyRosterMember`).
- **Cannot map presence over time.** The relay knows who's currently
  connected but does not expose this to other clients. The previous
  `dm:offline` indicator was a presence oracle; it has been removed
  end-to-end (audit pt1 #9, pt5 M1).
- **Cannot exfiltrate via XSS in the renderer.** Strict CSP blocks
  outbound `fetch` to anything but `localhost` (the local relay + the
  local Tor proxy). Sensitive Tauri IPCs (`tor_backup_keys`,
  `tor_restore_keys`, `tor_set_bridges`) require native OS
  confirmation dialogs that JS cannot dismiss.

### Your ISP / network operator

- All traffic goes through Tor. Your ISP sees encrypted Tor traffic,
  not "user is connecting to chat-server.example.com."
- The relay's address is a `.onion`; rendezvous happens inside the Tor
  network. No DNS query identifies the destination.

### The recipient's ISP / network operator

- The hidden service rendezvous doesn't reveal either side's IP. Both
  ends terminate inside Tor.

### Mass-collection / data-harvesting business models

- No accounts. No email. No phone number. No analytics. No telemetry.
  No auto-update server you'd have to trust. (I will keep this always and will hold these values in future features)
- Nothing identifies a user across sessions other than the
  cryptographic identity they generated themselves, which lives only
  in `sessionStorage` and dies with the tab.

### Casual XSS / supply-chain compromise

- **Wash** private keys are non-extractable Web Crypto handles; cannot
  be exfiltrated via `subtle.exportKey` from compromised JS.
- The bundled Tor binary is fetched with GPG signature verification
  by default; a tampered upstream archive is a hard fail.
- The local onion proxy requires a per-session token (192-bit, generated
  fresh per launch) to accept connections another local process
  cannot use Void Chat's Tor circuit attributed to the user.
- Per-message DM sender signatures (audit pt6 C1) prevent a malicious
  relay from re-attributing your real ciphertext to a different
  "sender" on the recipient's screen. The receiver verifies the sig
  AND cross-checks `(signing, box)` against a peer cache populated
  only by roster-sig-verified bindings.

---

## NOT protected against

### The host of a community you join

In the cross-host model (you join someone *else's* `.onion`), the host
operates the relay you're connected to. They cannot read your messages,
but they **can** see:

- Every box public key that connects to their server (one per session)
- Which channels each one joined
- Which DMs were sent (sender box pubkey → recipient box pubkey;
  ciphertext opaque to them)
- Timing, frequency, and length of every message
- Roster membership

For the **friend-group model** (you and your friends share a server
that one of you runs), this is "we see our own data, fine."

For joining a **stranger's** community, the host learns who you talk to
and when, even though Tor hides your IP. The relay metadata can build
a behavioral fingerprint over time.

**Mitigation:** only join communities run by people you'd trust with
metadata anyway. Treat advertised-on-a-forum community invites the same
way you'd treat advertised-on-a-forum chat rooms — fine for public
discussion, not fine for sensitive comms.

### Channel-roster members

When you join a channel, every other member learns your signing public
key and current display name. Vice versa. The signing key is stable
for the lifetime of a tab; an attacker in the same channel can
recognize you across messages within that session.

**Mitigation:** close the tab and open a fresh one to rotate identity.
Prefer small/trusted channels. The display name is intentionally
spoofable (anyone can pick "alice"); the truncated signing-key
fingerprint shown next to messages is the actual identity.

### Traffic analysis

No padding, no cover traffic, no decorrelation beyond what Tor itself
provides. A global passive adversary watching both ends could in
principle correlate timing.

**Mitigation:** none we provide. This is out of scope. Tor's own
defenses are what you get.

### Device seizure / local malware (filesystem read)

Messages received during the session are written to IndexedDB **in
plaintext** under `~/.local/share/dev.voidchat.app/EBWebView/` or the
platform equivalent. Anyone with read access to the browser profile
can read every message you've received.

**Mitigation:** use full-disk encryption (FileVault / LUKS /
BitLocker) at minimum. Encrypted-at-rest message storage is on the
roadmap for v0.2 via OS keychain integration; until then, FDE is the
floor.

### Renderer-side compromise of chat session keys

The chat protocol's ed25519 signing-secret and Curve25519 box-secret
for the current tab are stored in `sessionStorage` as base58 strings,
recoverable by any script running in the renderer:

- An XSS regression (e.g. a future dev introducing `'unsafe-inline'`
  scripts via CSP relaxation) would let an attacker exfiltrate them
  via `sessionStorage.getItem('voidchat_session_keys')`.
- A compromised npm dependency loading at runtime could do the same.

The protections in place are CSP (currently disallows inline scripts +
foreign script sources in production), dependency hygiene (audited
`yarn.lock`, `enableScripts: false` in `.yarnrc.yml`, supply-chain
checksum enforcement), and the per-tab session-isolation model that
caps the blast radius of a successful exfil to that single tab's
lifetime of messages.

The **Wash** off-channel cipher's keys are a separate story — those
ARE non-extractable Web Crypto handles, immune to `subtle.exportKey`.
Wash and chat use different cipher families on purpose; a renderer
compromise that lifts chat keys does NOT lift Wash keys.

**Why not WebCrypto for chat too?** TweetNaCl-JS, which the chat
protocol uses, predates Web Crypto's ed25519 / X25519 support and
exposes raw key bytes by design. Porting chat crypto to Web Crypto's
non-extractable handles is a meaningful refactor (every signing,
verifying, sealing, and opening call site changes) — queued for v0.3.
See `ROADMAP.md`.

**Mitigation in the meantime:** keep the dependency tree small and
audited; treat sessions as the trust boundary (close the tab if you
suspect compromise; identity rotates).

### Forward secrecy in the per-message (Signal/SimpleX) sense

`nacl.box` uses long-term Curve25519 keys for the session. If your
session secret is compromised while the tab is open — memory dump,
browser zero-day, malicious extension — **every message in that
session** is decryptable, not just future ones.

**What we DO have today:** session isolation — each browser tab
generates a fresh keypair, so compromising one session doesn't reveal
others. Closing the tab destroys the key in memory. The window of
compromise is bounded by tab lifetime.

**What's planned for v0.3:** historical messages (after tab close)
get wash-encrypted with the user's persistent SubPub key, providing
**closed-session forward secrecy** — past sessions are safe even if a
future session's keys are compromised, because session keys and
historical-storage keys are separate cipher families with independent
compromise surfaces. See `ROADMAP.md`.

**What's not planned:** per-message ratcheting (Signal's double
ratchet). The session-as-trust-boundary model is the architectural
choice; ratcheting would significantly increase protocol complexity for
a property the threat model accepts is not provided.

### State-level adversaries with global passive surveillance

Out of scope. Void Chat does not claim resistance to a nation-state-grade
adversary with the ability to observe both ends of a Tor circuit, run
a meaningful fraction of the Tor network, or compel infrastructure
operators.

If your threat model is "if this conversation is intercepted, the
consequences are imprisonment or worse," do not rely on Void Chat as
your only protection. Layer it with Signal (different protocol,
independent audit history) at minimum.

---

## What we explicitly do not claim

- **That we're audited by an independent third party.** We're not.
  Self-audited five times to date with documented findings + fixes
  (see `SecurityAudits/`); that's better than zero audits, less than
  a Trail of Bits / NCC Group / Cure53 report. An external audit is
  on the v0.4+ roadmap when funding allows.

- **That losing your keys is recoverable.** It's not. No password
  reset, no recovery phrase, no account portal. Lose your session
  keys = identity gone (rotates per tab anyway). Lose your `.onion`
  key = address gone, every previously-shared invite dies. Settings →
  "Backup identity" exports the onion key encrypted with a passphrase
  if you want persistence.

- **That this replaces another tool for high-sensitivity use.** It doesn't.
  Different threat model, different protections, different trust
  assumptions.

- **That the v0.1 installer works.** It doesn't ship the relay
  process; v0.1 is a source-run release. The v0.2 Rust port makes
  the installer self-contained.

---

## Appropriate uses

- Small organizing groups where everyone runs the same install
- Friend groups who want a private alternative to Discord
- Self-hosted "private IRC over Tor" for technical communities
- Conversations where "session = browser tab" is an acceptable trust
  boundary
- Backup channel for higher-sensitivity comms that primarily live on
  Signal/Briar

## Inappropriate uses

- High-stakes journalism where source identity must remain protected
  if your device is later seized
- Communication where past messages must remain confidential after
  future key compromise (use Signal or SimpleX)
- Scenarios requiring resistance to global passive surveillance (no
  consumer messenger meets this bar; closest is Briar's
  contact-discovery model)
- Anything where the consequences of leak are physical-safety
  threatening — Signal + Briar both have stronger guarantees here

---

## When in doubt

Use another tool you trust. Void Chat exists for cases where a tool's centralization,
phone-number requirement, or feature set are wrong for you. It is not
a tool replacement, it is a different shape for a different audience.

The audit history in `SecurityAudits/` is the standard of evidence we
hold ourselves to. The README's "Honest limitations" section is the
ground truth on what's missing. This document is the threat-model
formalization of both.

If you find a discrepancy between this document and the code, the code
is the truth please open an issue or use the disclosure path in
`SECURITY.md` if it's a security impacting discrepancy.
