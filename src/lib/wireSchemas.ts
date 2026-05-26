import { z } from 'zod';

/**
 * Runtime validation for inbound socket.io events. TypeScript types are
 * compile-time only — a hostile or buggy relay can send any JSON, and
 * the client would either crash on a `.foo` deref or carry forward
 * half-valid state into the e2ee layer. The relay is not in our trust
 * boundary (cross-host invites point at someone else's relay); every
 * frame coming from it must be parsed before use.
 *
 * `.strict()` rejects unknown fields so an attacker can't smuggle
 * extra data that one of our handlers might pick up later.
 */

const Base58Str = z.string().min(1).max(128);
const NonceStr = z.string().min(1).max(128);
const Bs58Sig = z.string().min(1).max(128);
const NonEmptyString = z.string().min(1);

// Used by ChannelRoster / ChannelMemberJoined.
export const RosterMemberSchema = z
  .object({
    signingPublicKey: Base58Str,
    boxPublicKey: Base58Str,
    displayName: z.string().max(64),
    // Optional during rollout; verifyRosterMember already rejects when missing.
    announceNonce: NonceStr.optional(),
    announceTs: z.number().int().optional(),
    sig: Bs58Sig.optional(),
  })
  .strict();

export const ConnectionNonceSchema = z
  .object({
    nonce: NonceStr,
  })
  .strict();

export const SessionAckSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export const ChannelRosterSchema = z
  .object({
    channelId: NonEmptyString,
    members: z.array(RosterMemberSchema).max(2048),
  })
  .strict();

export const ChannelMemberJoinedSchema = z
  .object({
    channelId: NonEmptyString,
    member: RosterMemberSchema,
  })
  .strict();

export const ChannelMemberLeftSchema = z
  .object({
    channelId: NonEmptyString,
    signingPublicKey: Base58Str,
  })
  .strict();

export const ChannelMessageRelaySchema = z
  .object({
    channelId: NonEmptyString,
    senderBoxPublicKey: Base58Str,
    senderSigningPublicKey: Base58Str,
    senderDisplayName: z.string().max(64),
    // Ciphertext + nonce shape: enforcement of size limits is by the
    // server (MAX_CIPHERTEXT_BYTES); here we just bound the upper end.
    ciphertext: z.string().max(256 * 1024),
    nonce: z.string().min(1).max(128),
    msgId: NonEmptyString,
    ts: z.number().int(),
  })
  .strict();

export const DMMessageRelaySchema = z
  .object({
    senderBoxPublicKey: Base58Str,
    senderSigningPublicKey: Base58Str,
    senderDisplayName: z.string().max(64),
    ciphertext: z.string().max(256 * 1024),
    nonce: z.string().min(1).max(128),
    msgId: NonEmptyString,
    ts: z.number().int(),
  })
  .strict();

export const DMOfflineSchema = z
  .object({
    recipientBoxPublicKey: Base58Str,
  })
  .strict();

export const WireErrorSchema = z
  .object({
    code: z.enum([
      'NOT_READY',
      'BAD_SIGNATURE',
      'STALE_TIMESTAMP',
      'BAD_NONCE',
      'RATE_LIMITED',
      'NOT_IN_CHANNEL',
      'INVALID_PAYLOAD',
    ]),
    message: z.string().max(512),
  })
  .strict();

/**
 * Helper for the client-side handlers. Returns parsed data or null;
 * logs once at warn level on failure so a misbehaving relay is visible
 * without spamming on every malformed frame.
 */
export function safeParse<T>(schema: z.ZodSchema<T>, raw: unknown, eventName: string): T | null {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(`[wire] dropping malformed ${eventName} from relay:`, result.error.issues);
  return null;
}
