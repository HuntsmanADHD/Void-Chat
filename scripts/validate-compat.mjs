/**
 * Parity proof for the zod replacement (`src/lib/validate.ts`).
 *
 * Re-builds the `wireSchemas.ts` schema graph with BOTH the hand-rolled
 * validator and real `zod`, then fires a battery of valid + adversarial inputs
 * (unknown keys, nulls, wrong types, missing required fields, length/array
 * boundaries, non-integer numbers, bad enums/literals) at both and asserts the
 * accept/reject decision is identical. This is the security oracle for the
 * untrusted-relay boundary — `wireSchemas.ts` is just these same builder calls,
 * so engine parity ⟹ schema parity.
 *
 * zod is intentionally NOT a project dependency anymore, so install ad-hoc:
 *
 *   npm i --no-save zod
 *   node scripts/validate-compat.mjs
 *
 * Exits non-zero on any mismatch.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { z: zod } = require('zod');
const { z } = await import('../src/lib/validate.ts');

const MAX_CT = 96 * 1024;

// Build the same schema graph under both engines.
function build(v) {
  const B58 = v.string().min(1).max(128);
  const NN = v.string().min(1).max(128);
  const BS = v.string().min(1).max(128);
  const NE = v.string().min(1);
  const RM = v.object({
    signingPublicKey: B58, boxPublicKey: B58, displayName: v.string().max(64),
    announceNonce: NN.optional(), announceTs: v.number().int().optional(),
    sig: BS.optional(), joinSig: BS.optional(), joinTs: v.number().int().optional(),
  }).strict();
  return {
    ConnectionNonceSchema: v.object({ nonce: NN }).strict(),
    SessionAckSchema: v.object({ ok: v.literal(true) }).strict(),
    ChannelRosterSchema: v.object({ channelId: NE, members: v.array(RM).max(2048) }).strict(),
    ChannelMemberJoinedSchema: v.object({ channelId: NE, member: RM }).strict(),
    ChannelMemberLeftSchema: v.object({ channelId: NE, signingPublicKey: B58 }).strict(),
    ChannelMessageRelaySchema: v.object({ channelId: NE, senderBoxPublicKey: B58, senderSigningPublicKey: B58, senderDisplayName: v.string().max(64), ciphertext: v.string().max(MAX_CT), nonce: v.string().min(1).max(128), msgId: NE, ts: v.number().int() }).strict(),
    DMMessageRelaySchema: v.object({ senderBoxPublicKey: B58, senderSigningPublicKey: B58, senderDisplayName: v.string().max(64), ciphertext: v.string().max(MAX_CT), nonce: v.string().min(1).max(128), msgId: NE, ts: v.number().int(), senderSig: B58 }).strict(),
    WireErrorSchema: v.object({ code: v.enum(['NOT_READY', 'BAD_SIGNATURE', 'STALE_TIMESTAMP', 'BAD_NONCE', 'RATE_LIMITED', 'NOT_IN_CHANNEL', 'INVALID_PAYLOAD']), message: v.string().max(512) }).strict(),
  };
}
const mine = build(z), theirs = build(zod);

const roster = () => ({ signingPublicKey: 'A'.repeat(44), boxPublicKey: 'B'.repeat(44), displayName: 'alice', announceNonce: 'n1', announceTs: 123, sig: 's1', joinSig: 'j1', joinTs: 456 });
const bases = {
  ConnectionNonceSchema: () => ({ nonce: 'abc' }),
  SessionAckSchema: () => ({ ok: true }),
  ChannelRosterSchema: () => ({ channelId: 'c1', members: [roster()] }),
  ChannelMemberJoinedSchema: () => ({ channelId: 'c1', member: roster() }),
  ChannelMemberLeftSchema: () => ({ channelId: 'c1', signingPublicKey: 'A'.repeat(44) }),
  ChannelMessageRelaySchema: () => ({ channelId: 'c1', senderBoxPublicKey: 'B'.repeat(44), senderSigningPublicKey: 'A'.repeat(44), senderDisplayName: 'a', ciphertext: 'x', nonce: 'n', msgId: 'm1', ts: 1 }),
  DMMessageRelaySchema: () => ({ senderBoxPublicKey: 'B'.repeat(44), senderSigningPublicKey: 'A'.repeat(44), senderDisplayName: 'a', ciphertext: 'x', nonce: 'n', msgId: 'm1', ts: 1, senderSig: 'A'.repeat(44) }),
  WireErrorSchema: () => ({ code: 'RATE_LIMITED', message: 'slow down' }),
};

function* variants(name) {
  const b = bases[name];
  yield ['baseline', b()];
  yield ['unknown-field', { ...b(), evil: 1 }];
  yield ['null', null];
  yield ['array', []];
  yield ['string', 'nope'];
  yield ['missing-first-key', (() => { const o = b(); delete o[Object.keys(o)[0]]; return o; })()];
  yield ['number-for-string', (() => { const o = b(); const k = Object.keys(o).find((k) => typeof o[k] === 'string'); o[k] = 5; return o; })()];
  if (name === 'ConnectionNonceSchema') { yield ['nonce-empty', { nonce: '' }]; yield ['nonce-128', { nonce: 'x'.repeat(128) }]; yield ['nonce-129', { nonce: 'x'.repeat(129) }]; }
  if (name === 'SessionAckSchema') { yield ['ok-false', { ok: false }]; yield ['ok-1', { ok: 1 }]; yield ['ok-truthy', { ok: 'true' }]; }
  if (name === 'WireErrorSchema') { yield ['bad-code', { code: 'NOPE', message: 'm' }]; yield ['msg-512', { code: 'NOT_READY', message: 'm'.repeat(512) }]; yield ['msg-513', { code: 'NOT_READY', message: 'm'.repeat(513) }]; }
  if (name.includes('MessageRelay')) { yield ['ts-float', { ...b(), ts: 1.5 }]; yield ['ts-string', { ...b(), ts: '1' }]; yield ['ct-max', { ...b(), ciphertext: 'c'.repeat(MAX_CT) }]; yield ['ct-over', { ...b(), ciphertext: 'c'.repeat(MAX_CT + 1) }]; yield ['displayname-65', { ...b(), senderDisplayName: 'd'.repeat(65) }]; }
  if (name === 'ChannelRosterSchema') { yield ['members-2048', { channelId: 'c', members: Array.from({ length: 2048 }, roster) }]; yield ['members-2049', { channelId: 'c', members: Array.from({ length: 2049 }, roster) }]; yield ['member-extra-key', { channelId: 'c', members: [{ ...roster(), x: 1 }] }]; yield ['member-bad-ts', { channelId: 'c', members: [{ ...roster(), announceTs: 1.2 }] }]; yield ['roster-missing-optional', { channelId: 'c', members: [(() => { const m = roster(); delete m.sig; delete m.joinSig; return m; })()] }]; }
  if (name.includes('MemberJoined')) { yield ['member-unknown', { channelId: 'c', member: { ...roster(), z: 1 } }]; }
}

let total = 0, mism = 0;
for (const name of Object.keys(bases)) {
  for (const [label, input] of variants(name)) {
    total++;
    const a = mine[name].safeParse(input).success;
    const b = theirs[name].safeParse(input).success;
    if (a !== b) { console.log(`MISMATCH ${name}/${label}: mine=${a} zod=${b}`); mism++; }
  }
}
console.log(mism === 0 ? `✅ validator matches zod on all ${total} cases` : `❌ ${mism} mismatch(es) of ${total}`);
process.exit(mism === 0 ? 0 : 1);
