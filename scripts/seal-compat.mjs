/**
 * Cross-implementation proof: the TS message seal (`src/lib/voidseal.ts`) and
 * the Java seal (`seal-java/`) produce the same wire format and interoperate
 * byte-for-byte. Same role nacl-compat.mjs plays for the noble shims.
 *
 * Construction under test: crypto_box_curve25519xchacha20poly1305
 *   (X25519 + HChaCha20 beforenm + XChaCha20-Poly1305). The Java side is
 *   already verified against libsodium; this proves TS == Java, so all three
 *   (TS, Java, libsodium) agree.
 *
 * Requires the compiled Java: `(cd seal-java && javac -d out *.java)`.
 *   node scripts/seal-compat.mjs
 * Exits non-zero on any mismatch.
 */
import { execFileSync } from 'node:child_process';
import { x25519 } from '@noble/curves/ed25519.js';
import { webcrypto } from 'node:crypto';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
if (!globalThis.crypto) globalThis.crypto = webcrypto; // for getRandomValues in the module

// The client uses Vite's bundler resolution, so its modules import relative
// paths without extensions (e.g. `./base58`). Node ESM can't follow those, so
// resolve extensionless relative specifiers to the actual `.ts`/`.js` file.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z0-9]+$/i.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      for (const ext of ['.ts', '.js', '.mjs']) {
        if (existsSync(fileURLToPath(base + ext))) return { url: base + ext, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const { sealForRecipient, openFromSender, boxPublicKeyFromSecret, _internal } =
  await import('../src/lib/voidseal.ts');
const { default: bs58 } = await import('../src/lib/base58.ts');
const { encodeBase64, decodeBase64 } = await import('../src/lib/naclUtil.ts');

const JAVA_CP = 'seal-java/out';
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (s) => new Uint8Array(Buffer.from(s, 'hex'));
// An X25519 secret key is just 32 random bytes (clamped internally on use).
const randSk = () => globalThis.crypto.getRandomValues(new Uint8Array(32));
let fails = 0;
const ok = (cond, m) => { if (!cond) { console.log('FAIL:', m); fails++; } };

// ── 1. HChaCha20 draft vector (TS side) ──────────────────────────────────
{
  const key = unhex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const in16 = unhex('000000090000004a0000000031415927');
  ok(
    hex(_internal.hchacha20(key, in16)) ===
      '82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc',
    'TS HChaCha20 draft vector',
  );
}

// ── 2. TS self round-trip ────────────────────────────────────────────────
{
  const aSec = randSk();
  const aPub = bs58.encode(boxPublicKeyFromSecret(aSec));
  const bSec = randSk();
  const bPub = bs58.encode(boxPublicKeyFromSecret(bSec));
  const sealed = sealForRecipient('hello bob 😀', bPub, aSec);
  ok(sealed !== null, 'TS seal succeeds');
  ok(openFromSender(sealed.ciphertext, sealed.nonce, aPub, bSec) === 'hello bob 😀', 'TS round-trip');
  // tamper
  const raw = decodeBase64(sealed.ciphertext);
  raw[0] ^= 1;
  ok(openFromSender(encodeBase64(raw), sealed.nonce, aPub, bSec) === null, 'TS rejects tampered');
}

// ── 3. TS seals → Java opens ─────────────────────────────────────────────
{
  const N = 300;
  const lines = [];
  const expect = [];
  for (let i = 0; i < N; i++) {
    const senderSec = randSk();
    const senderPub = bs58.encode(boxPublicKeyFromSecret(senderSec));
    const recipientSec = randSk();
    const recipientPub = bs58.encode(boxPublicKeyFromSecret(recipientSec));
    const mlen = (i * 7) % 2048;
    const m = new Uint8Array(mlen);
    for (let k = 0; k < mlen; k++) m[k] = (k * 31 + i) & 0xff;
    const plaintext = new TextDecoder().decode(m);
    const plainUtf8 = new TextEncoder().encode(plaintext);

    const sealed = sealForRecipient(plaintext, recipientPub, senderSec);
    lines.push(
      JSON.stringify({
        senderPub,
        recipientSecret: hex(recipientSec),
        nonce: sealed.nonce,
        ct: sealed.ciphertext,
      }),
    );
    expect.push(hex(plainUtf8));
  }
  // Note: don't .trim() — an empty plaintext yields a legitimate empty output
  // line, and trimming would drop it and misalign every subsequent comparison.
  const out = execFileSync('java', ['-cp', JAVA_CP, 'SealInterop', 'open'], {
    input: lines.join('\n') + '\n',
    maxBuffer: 1 << 28,
  })
    .toString()
    .replace(/\n$/, '')
    .split('\n');
  let bad = 0;
  for (let i = 0; i < N; i++) if (out[i] !== expect[i]) bad++;
  ok(bad === 0, `TS→Java: Java opens all TS-sealed boxes (${N - bad}/${N})`);
}

// ── 4. Java seals → TS opens ─────────────────────────────────────────────
{
  const N = 300;
  const jsonl = execFileSync('java', ['-cp', JAVA_CP, 'SealInterop', 'selfgen', String(N)], {
    maxBuffer: 1 << 28,
  })
    .toString()
    .trim()
    .split('\n');
  let bad = 0;
  for (const line of jsonl) {
    const o = JSON.parse(line);
    const senderPub = o.senderPub;
    const recipientSec = unhex(o.recipientSecret);
    const got = openFromSender(o.ct, o.nonce, senderPub, recipientSec);
    const want = new TextDecoder().decode(unhex(o.plain));
    if (got !== want) bad++;
  }
  ok(bad === 0, `Java→TS: TS opens all Java-sealed boxes (${N - bad}/${N})`);
}

if (fails === 0) console.log('seal-compat: ALL CHECKS PASS — TS seal ≡ Java seal (byte-for-byte interop)');
process.exit(fails === 0 ? 0 : 1);
