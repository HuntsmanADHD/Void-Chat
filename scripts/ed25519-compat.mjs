/**
 * Cross-implementation proof: the Java Ed25519 signer (`seal-java/
 * Ed25519Sign.java`) is byte-for-byte equivalent to the client's
 * noble-backed `nacl.sign` — so the future Java client signs announces /
 * messages / channel-joins that the relay and existing TS peers verify, and
 * vice versa. Ed25519 is deterministic, so equal inputs ⇒ equal signatures.
 *
 * Requires the compiled Java: `(cd seal-java && javac -d out *.java)`.
 *   node scripts/ed25519-compat.mjs
 * Exits non-zero on any mismatch.
 */
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
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

const { default: nacl } = await import('../src/lib/nacl.ts');

const JAVA_CP = 'seal-java/out';
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (s) => new Uint8Array(Buffer.from(s, 'hex'));
let fails = 0;
const ok = (cond, m) => { if (!cond) { console.log('FAIL:', m); fails++; } };

const N = 300;

// ── 1. TS signs → bytes must equal Java's signature (deterministic) ──────
//      and Java verifies the TS signature.
{
  const signLines = [];
  const verifyLines = [];
  const tsSigs = [];
  for (let i = 0; i < N; i++) {
    const kp = nacl.sign.keyPair();
    const msg = webcrypto.getRandomValues(new Uint8Array((i * 13) % 300));
    const tsSig = nacl.sign.detached(msg, kp.secretKey);
    tsSigs.push(hex(tsSig));
    signLines.push(JSON.stringify({ secretKey: hex(kp.secretKey), msg: hex(msg) }));
    verifyLines.push(JSON.stringify({ pub: hex(kp.publicKey), sig: hex(tsSig), msg: hex(msg) }));
  }

  const javaSigs = run('sign', signLines);
  let mismatch = 0;
  for (let i = 0; i < N; i++) if (javaSigs[i] !== tsSigs[i]) mismatch++;
  ok(mismatch === 0, `TS sig ≡ Java sig, byte-identical (${N - mismatch}/${N})`);

  const javaVerdicts = run('verify', verifyLines);
  ok(javaVerdicts.every((v) => v === '1'), 'Java verifies all TS signatures');
}

// ── 2. Java generates keypairs + signs → TS verifies ─────────────────────
{
  const kps = run('keygen', [], [String(N)]).map((l) => JSON.parse(l));
  const signLines = [];
  const msgs = [];
  for (let i = 0; i < N; i++) {
    const msg = webcrypto.getRandomValues(new Uint8Array((i * 17) % 256));
    msgs.push(msg);
    signLines.push(JSON.stringify({ secretKey: kps[i].secretKey, msg: hex(msg) }));
  }
  const javaSigs = run('sign', signLines);
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const pub = unhex(kps[i].pub);
    const sig = unhex(javaSigs[i]);
    if (!nacl.sign.detached.verify(msgs[i], sig, pub)) bad++;
  }
  ok(bad === 0, `TS verifies all Java keypair+signatures (${N - bad}/${N})`);
}

// ── 3. tamper rejection both sides ───────────────────────────────────────
{
  const kp = nacl.sign.keyPair();
  const msg = new TextEncoder().encode('the canonical announce|boxpub|name|1700000000000');
  const sig = nacl.sign.detached(msg, kp.secretKey);
  const badSig = sig.slice(); badSig[0] ^= 1;
  const badMsg = msg.slice(); badMsg[0] ^= 1;
  // Java rejects tampered sig + tampered msg
  const verdicts = run('verify', [
    JSON.stringify({ pub: hex(kp.publicKey), sig: hex(sig), msg: hex(msg) }),       // 1
    JSON.stringify({ pub: hex(kp.publicKey), sig: hex(badSig), msg: hex(msg) }),    // 0
    JSON.stringify({ pub: hex(kp.publicKey), sig: hex(sig), msg: hex(badMsg) }),    // 0
  ]);
  ok(verdicts[0] === '1' && verdicts[1] === '0' && verdicts[2] === '0', 'Java rejects tampered sig/msg');
  // TS rejects the same
  ok(nacl.sign.detached.verify(msg, sig, kp.publicKey), 'TS accepts good sig');
  ok(!nacl.sign.detached.verify(msg, badSig, kp.publicKey), 'TS rejects tampered sig');
}

function run(mode, stdinLines, extraArgs = []) {
  const res = execFileSync('java', ['-cp', JAVA_CP, 'SignInterop', mode, ...extraArgs], {
    input: stdinLines.length ? stdinLines.join('\n') + '\n' : undefined,
    maxBuffer: 1 << 28,
  });
  return res.toString().replace(/\n$/, '').split('\n');
}

if (fails === 0)
  console.log('ed25519-compat: ALL CHECKS PASS — Java Ed25519 ≡ client nacl.sign (byte-for-byte)');
process.exit(fails === 0 ? 0 : 1);
