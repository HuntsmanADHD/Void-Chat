# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email: **voidchat-sec@tutamail.com**

For sensitive reports, encrypt with the project's PGP key:

```
PGP - not setup yet.
```

PGP key fingerprint (verify out-of-band before encrypting):

```
[FINGERPRINT PLACEHOLDER — paste the `gpg --fingerprint` output here once
the key is generated. The fingerprint is what you compare against to know
you're encrypting to the right key.]
```

---

## What to include in your report

- A short description of the vulnerability and the affected component
  (frontend, relay, Tor sidecar, onion proxy, Rust shell)
- Steps to reproduce, ideally with a minimal proof of concept
- Your assessment of severity (CRITICAL / HIGH / MEDIUM / LOW)
- Whether you've disclosed it elsewhere (and if so, where + when)
- How you'd like to be credited in the fix advisory (real name,
  pseudonym, or "anonymous")

The clearer the report, the faster the fix.

---

## Response time

- **Acknowledgement** within 72 hours of receipt
- **Initial assessment** (severity + scope) within 7 days
- **Fix or update on progress** within 30 days for CRITICAL / HIGH
  issues. MEDIUM / LOW issues land on the normal commit cadence,
  typically within a few weeks

If you don't hear back within these windows, please assume the email
was lost and follow up. The project has one maintainer so ill do my best.

---

## Scope

### In scope

- All code in this repository (Rust shell, TypeScript frontend, Node
  relay, build scripts)
- The bundled Tor runtime fetch process (`scripts/fetch-tor-binaries.sh`)
  and the signature verification chain
- Any of the threat-model claims in `THREAT_MODEL.md`
- The protocol specification (wire format, identifier binding,
  cryptographic primitives as used)
- Anything that would let an attacker:
  - Read messages they shouldn't read
  - Substitute keys to MITM end-to-end encryption
  - Deanonymize a user (real IP, persistent identifier across sessions)
  - Steal or destroy a user's `.onion` identity
  - DoS the relay or the local Tauri shell
  - Escape the renderer sandbox via IPC

### Out of scope

- Issues in Tor itself (report to <https://gitlab.torproject.org>)
- Issues in upstream dependencies (Tauri, socket.io, Vite, Prisma,
  etc.) — report to those projects directly; we'll track and update
  on disclosure
- Theoretical attacks with no practical execution path against the
  documented threat model
- Findings that boil down to "the user installed malware on their own
  machine" — outside the trust boundary
- Findings that boil down to "the user joined a community whose host
  is malicious" — explicitly named as not protected against in
  `THREAT_MODEL.md`; the relay-MITM defenses already make this less
  bad than centralized chat apps

---

## Disclosure policy

We follow **coordinated disclosure**:

1. You report privately.
2. We acknowledge and assess.
3. We develop a fix; you may be asked to verify it works.
4. The fix lands in a commit; the advisory + credit publishes.
5. After the advisory is public, you're free to write about the issue
   however you like (blog post, conference talk, etc.).

We will not sit on a fix. If a critical issue is taking longer than
30 days, you'll be told why, and the conversation about disclosure
timing is yours to have.

We do not run a bug-bounty program (no payment). We do credit
reporters in the fix commit message and in `SecurityAudits/` when the
finding is significant enough to merit a dated audit file of its own.

---

## What the project has done historically

`SecurityAudits/` in this repository contains five iterative audit
files dated 2026-05-26 and 2026-05-27, with findings, severities,
fix locations, and reversal verdicts via cluade. They're checked into the public
repository as documentation, not because we're proud of having issues
but because privacy tools are trusted to the degree they can show
their work.

This is the standard of evidence we hold ourselves to. If you find
something that would warrant a sixth audit file, that's exactly what
we'd like to hear about.

---

## Generating the project key (maintainer notes)

Run once, then replace the placeholder blocks above:

```bash
# Generate (use the strongest available defaults)
gpg --quick-generate-key 'Void Chat Security <voidchat-sec@tutamail.com>' \
    ed25519 default 2y

# Export the armored public key for this file
gpg --armor --export voidchat-sec@tutamail.com > project-pgp-key.asc

# Get the fingerprint
gpg --fingerprint voidchat-sec@tutamail.com

# Publish to a keyserver so reporters can verify
gpg --send-keys --keyserver hkps://keys.openpgp.org <KEY-ID>
```

Paste the contents of `project-pgp-key.asc` into the PGP KEY
PLACEHOLDER above. Paste the fingerprint into the FINGERPRINT
PLACEHOLDER. Commit. Delete `project-pgp-key.asc` (public keys are
fine to commit, but the rest of the keyring shouldn't be).

Rotate the key every 1–2 years; update this file with the new
fingerprint and announce the rotation in a release note so reporters
know to fetch the new key.
