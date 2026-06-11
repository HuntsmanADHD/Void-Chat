/**
 * Drop-in replacement for the `bs58` package, backed by Paul Millr's audited
 * `@scure/base`. Same API (`encode(Uint8Array) → string`,
 * `decode(string) → Uint8Array`) and same semantics, including throwing on
 * invalid input — call sites rely on `decode` throwing to reject malformed
 * base58 (e.g. relay-supplied keys/sigs). Byte-for-byte equivalence to `bs58`
 * (incl. leading-zero handling) is verified in `scripts/nacl-compat.mjs`.
 */

import { base58 } from '@scure/base';

export function encode(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

export function decode(str: string): Uint8Array {
  return base58.decode(str);
}

export default { encode, decode };
