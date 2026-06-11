/**
 * Type declarations for the vendored VoidSeal ChaCha20-Poly1305 core
 * (`voidchacha.js`). The implementation is the user's verified pure-JS
 * VoidSeal (RFC 8439), copied in unchanged; this file just gives it types.
 */
export interface SealResult {
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

interface VoidSealApi {
  seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): SealResult;
  open(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    tag: Uint8Array,
    aad?: Uint8Array,
  ): Uint8Array | null;
  chacha20(key: Uint8Array, nonce: Uint8Array, counter: number, data: Uint8Array): Uint8Array;
  poly1305(msg: Uint8Array, key: Uint8Array): Uint8Array;
  poly1305KeyGen(key: Uint8Array, nonce: Uint8Array): Uint8Array;
  toHex(b: Uint8Array): string;
}

declare const VoidSeal: VoidSealApi;
export default VoidSeal;
