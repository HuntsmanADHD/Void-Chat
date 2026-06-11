# Void Chat Seal — Pure Java message crypto

Public-key authenticated message encryption that replaces the client's
`nacl.box` seal. Zero dependencies (`java.base` only — `jdeps` confirmed).
Step 2 of the JVM migration (after the relay).

## Construction

libsodium's standard **`crypto_box_curve25519xchacha20poly1305`**:

```
shared = X25519(mySecret, theirPublic)          // ECDH — JDK XDH
boxKey = HChaCha20(key = shared, in = zeros16)   // beforenm
sealed = XChaCha20-Poly1305(boxKey, nonce24, m)  // afternm
```

Chosen over raw NaCl box (XSalsa20) on purpose: the **24-byte** XChaCha
nonce makes the client's random per-message nonces safe (a 12-byte RFC 8439
nonce would not be), and every layer is an independently test-vectored
standard.

## Files

| file | what |
|---|---|
| `Seal.java` | ChaCha20, Poly1305, ChaCha20-Poly1305 (RFC 8439), HChaCha20, XChaCha20-Poly1305 — ported from the verified JS VoidSeal, plus the XChaCha layer |
| `Box.java` | X25519 (JDK XDH, raw key specs) + the box seal/open; `sealForRecipient`/`openFromSender` mirroring the TS surface |
| `Base58.java` | shared with the relay (key encoding) |
| `SealTest.java`, `SealReverse.java`, `oracle.py`, `runseal.sh` | verification (not shipped) |

## ⚠️ Wire-format change

This is a **new, incompatible** message format — it is **not** interoperable
with the old `nacl.box` (XSalsa20-Poly1305). Cutting over is a flag day:
every client must upgrade together, and messages sealed under the old scheme
cannot be opened under the new one. This was a deliberate decision (own the
whole stack, drop noble/tweetnacl from the message path). Box public keys are
base58; ciphertext (`ct‖tag`) and the 24-byte nonce are base64, matching the
existing envelope field names.

## Verification

```sh
java -cp out SealTest        # fixed vectors only (RFC 8439, HChaCha20 draft)
./runseal.sh                 # + full libsodium cross-check (needs the oracle venv)
```

Status (all green):
- **RFC 8439** ChaCha20 §2.4.2, Poly1305 §2.5.2, AEAD §2.8.2 vectors.
- **HChaCha20** draft-irtf-cfrg-xchacha vector.
- **libsodium cross-check** (test-only oracle via ctypes — never shipped):
  HChaCha20, X25519 scalarmult/base, and XChaCha20-Poly1305 match byte-for-byte.
- **Full box, 600 random cases**: libsodium seals → Java opens (300), and
  Java seals → libsodium opens (300), zero mismatches both directions.
- Round-trip + wrong-recipient + tampered-ciphertext + oversized + malformed-key
  negative tests.

### Recreating the oracle

`runseal.sh` expects a libsodium-backed Python at `/tmp/nacl-oracle`:

```sh
python3 -m venv /tmp/nacl-oracle && /tmp/nacl-oracle/bin/pip install pynacl
```

This is the same pattern used elsewhere in the project: an independent
implementation as test-time ground truth, never a runtime dependency.

## Ed25519 signing (Ed25519Sign.java)

`Ed25519Sign.java` ports the client's announce / message / channel-join
signing (`nacl.sign.detached`) to the JDK (`Signature("Ed25519")`), preserving
the tweetnacl key format (`secretKey = seed32 ‖ pub32`, deterministic 64-byte
sigs). Verified in `scripts/ed25519-compat.mjs`: Java signatures are
**byte-identical** to the client's noble-backed `nacl.sign` (300 cases),
Java verifies all TS signatures, TS verifies all Java keypair+signatures, and
both reject tampered sig/message. So a future Java client signs what the relay
and existing TS peers accept, and vice versa.

## TS interop + remaining noble

The message seal is wired into the TS client as `src/lib/voidseal.ts` (the
AEAD core is the vendored `voidchacha.js`; X25519 is noble's for now), proven
byte-for-byte against this Java module in `scripts/seal-compat.mjs` (600 cases
both directions). With seal + signing both ported and cross-verified, the only
remaining `@noble`/cipher use is the X25519 ECDH on the JS side — it drops when
the client itself becomes Java (this module's `Box` already uses JDK X25519).

## Cross-impl proofs (run from the project root)

```sh
(cd seal-java && javac -d out *.java)
node scripts/seal-compat.mjs       # TS seal ≡ Java seal
node scripts/ed25519-compat.mjs    # Java Ed25519 ≡ client nacl.sign
```
