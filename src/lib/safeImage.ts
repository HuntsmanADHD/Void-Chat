/**
 * Renderer-side guard against turning user-supplied image strings into
 * clearnet HTTP requests.
 *
 * The renderer in a Tauri app has no SOCKS proxy — every `<img src>`
 * goes directly through the OS network stack. A community owner who can
 * set an avatar to `https://attacker.com/pixel.gif` would unmask every
 * joiner's real IP the moment they load the community list. The whole
 * point of running on Tor is defeated.
 *
 * The server-side gate in `relay/src/http.rs` is the primary defense,
 * but this client-side check is a belt-and-suspenders so the leak
 * can't reopen if any future endpoint forgets to validate.
 *
 * Allowed shapes:
 *   - inline `data:image/(png|jpeg|webp|gif);base64,...`
 *   - relative paths starting with `/` (the bundled `public/images/`
 *     assets are loaded this way; `/images/logo.png`)
 *   - `blob:` URLs (created from a local File via URL.createObjectURL,
 *     used by upload-preview flows)
 *
 * Blocked: `http:`, `https:`, `javascript:`, `data:text/html`, anything
 * else not on the allowlist.
 */

const ALLOWED_DATA_PREFIX = /^data:image\/(png|jpeg|webp|gif);base64,/;

export function isSafeImageSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  const trimmed = src.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('blob:')) return true;
  if (ALLOWED_DATA_PREFIX.test(trimmed)) return true;
  return false;
}
