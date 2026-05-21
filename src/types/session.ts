/**
 * Ephemeral session types.
 *
 * A session is the user's identity for the lifetime of a single browser tab.
 * Close the tab and it's gone — no recovery, no account, no persistence.
 *
 * Keys live in sessionStorage. Display name lives in localStorage as a
 * convenience so the user doesn't re-type it on every tab open (but anyone
 * else can claim the same display name — names are not unique or owned).
 */

export interface Session {
  /** Ed25519 public key for signing, base58. */
  signingPublicKey: string;
  /** Ed25519 secret key for signing, raw bytes. Never leaves the device. */
  signingSecretKey: Uint8Array;
  /** Curve25519 public key for nacl.box encryption, base58. */
  boxPublicKey: string;
  /** Curve25519 secret key for nacl.box encryption, raw bytes. Never leaves the device. */
  boxSecretKey: Uint8Array;
  /** User-chosen display name. Not unique. Not authenticated. */
  displayName: string;
  /** When this session was created (epoch ms). */
  createdAt: number;
}

/** Wire format for a session announcement (what's sent to the server on join). */
export interface SessionAnnouncement {
  signingPublicKey: string;
  boxPublicKey: string;
  displayName: string;
}

/** A roster entry for another participant in a channel or DM. */
export interface RosterEntry {
  signingPublicKey: string;
  boxPublicKey: string;
  displayName: string;
  joinedAt: number;
}
