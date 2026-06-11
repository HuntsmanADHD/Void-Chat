/**
 * Base64 / UTF-8 byte<->string helpers.
 *
 * Drop-in replacement for `tweetnacl-util`, inlined to remove the runtime
 * dependency. Behavior is byte-for-byte identical to the upstream package,
 * including the two contracts callers rely on:
 *
 *   - `decodeBase64` THROWS `TypeError` on malformed input. `encryption.ts`
 *     wraps it in try/catch to reject tampered ciphertext — silently
 *     returning empty/partial bytes instead would weaken that check.
 *   - `decodeUTF8`/`encodeUTF8` round-trip arbitrary Unicode via the
 *     `escape(encodeURIComponent(...))` trick, matching upstream exactly.
 *
 * Runs in the Tauri webview, so `btoa`/`atob` are always present.
 */

const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeUTF8(s: string): Uint8Array {
  if (typeof s !== 'string') throw new TypeError('expected string');
  const d = unescape(encodeURIComponent(s));
  const b = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) b[i] = d.charCodeAt(i);
  return b;
}

export function encodeUTF8(arr: Uint8Array): string {
  const s: string[] = [];
  for (let i = 0; i < arr.length; i++) s.push(String.fromCharCode(arr[i]));
  return decodeURIComponent(escape(s.join('')));
}

export function encodeBase64(arr: Uint8Array): string {
  const s: string[] = [];
  for (let i = 0; i < arr.length; i++) s.push(String.fromCharCode(arr[i]));
  return btoa(s.join(''));
}

export function decodeBase64(s: string): Uint8Array {
  if (!BASE64_RE.test(s)) throw new TypeError('invalid encoding');
  const d = atob(s);
  const b = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) b[i] = d.charCodeAt(i);
  return b;
}

export default { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 };
