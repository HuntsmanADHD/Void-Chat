/*
 * Scrypt.java — scrypt per RFC 7914, verify-only, for the legacy Node-era
 * `salt_hex:derived_hex` community-password rows (N=16384, r=8, p=1,
 * 16-byte salt, 64-byte key — Node crypto.scrypt defaults). PBKDF2 comes
 * from the JDK; only the Salsa20/8 core + ROMix are hand-rolled.
 * Verified against the RFC 7914 §12 vectors in RelayTest.
 */
import java.security.MessageDigest;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

public final class Scrypt {
    private Scrypt() {}

    static final int LEGACY_SALT_BYTES = 16;
    static final int LEGACY_KEY_BYTES = 64;

    /**
     * Verify a candidate against the legacy `salt:derivedKey` (both hex)
     * format. Returns null when the stored value doesn't parse as that
     * format (caller falls through to "invalid"), Boolean otherwise —
     * mirrors auth.rs::verify_legacy_scrypt.
     */
    public static Boolean verifyLegacy(String candidate, String stored) {
        int colon = stored.indexOf(':');
        if (colon < 0)
            return null;
        byte[] salt = hexDecode(stored.substring(0, colon));
        byte[] expected = hexDecode(stored.substring(colon + 1));
        if (salt == null || expected == null)
            return null;
        if (salt.length != LEGACY_SALT_BYTES || expected.length != LEGACY_KEY_BYTES)
            return null;
        byte[] derived;
        try {
            derived = derive(candidate.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    salt, 16384, 8, 1, LEGACY_KEY_BYTES);
        } catch (RuntimeException e) {
            return Boolean.FALSE;
        }
        return MessageDigest.isEqual(derived, expected);
    }

    /** scrypt(P, S, N, r, p, dkLen) per RFC 7914. */
    static byte[] derive(byte[] password, byte[] salt, int n, int r, int p, int dkLen) {
        if (n < 2 || (n & (n - 1)) != 0)
            throw new IllegalArgumentException("N must be a power of two > 1");
        int mfLen = 128 * r;
        byte[] b = pbkdf2(password, salt, 1, p * mfLen);
        for (int i = 0; i < p; i++) {
            roMix(b, i * mfLen, n, r);
        }
        return pbkdf2(password, b, 1, dkLen);
    }

    /**
     * PBKDF2-HMAC-SHA256 over raw bytes, built on the JDK Mac primitive.
     * The JDK's own PBKDF2 SecretKeyFactory takes char[] and UTF-8-encodes
     * it, which is lossy for arbitrary bytes — scrypt's second PBKDF2 call
     * feeds the binary B buffer as "salt", so we need the raw-bytes form.
     */
    private static byte[] pbkdf2(byte[] password, byte[] salt, int iters, int dkLen) {
        if (password.length == 0)
            throw new IllegalArgumentException("empty password");
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(password, "HmacSHA256"));
            int hLen = 32;
            int blocks = (dkLen + hLen - 1) / hLen;
            byte[] out = new byte[dkLen];
            byte[] block = new byte[salt.length + 4];
            System.arraycopy(salt, 0, block, 0, salt.length);
            for (int i = 1; i <= blocks; i++) {
                block[salt.length] = (byte) (i >>> 24);
                block[salt.length + 1] = (byte) (i >>> 16);
                block[salt.length + 2] = (byte) (i >>> 8);
                block[salt.length + 3] = (byte) i;
                byte[] u = mac.doFinal(block);
                byte[] acc = u.clone();
                for (int it = 1; it < iters; it++) {
                    u = mac.doFinal(u);
                    for (int k = 0; k < hLen; k++)
                        acc[k] ^= u[k];
                }
                int off = (i - 1) * hLen;
                System.arraycopy(acc, 0, out, off, Math.min(hLen, dkLen - off));
            }
            return out;
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    /** ROMix in place over b[off .. off+128r). */
    private static void roMix(byte[] b, int off, int n, int r) {
        int words = 32 * r; // 128r bytes as 32-bit LE words
        int[] x = new int[words];
        for (int i = 0; i < words; i++) {
            int p = off + i * 4;
            x[i] = (b[p] & 0xff) | (b[p + 1] & 0xff) << 8
                    | (b[p + 2] & 0xff) << 16 | (b[p + 3] & 0xff) << 24;
        }
        int[][] v = new int[n][];
        int[] y = new int[words];
        int[] scratch = new int[16];
        for (int i = 0; i < n; i++) {
            v[i] = x.clone();
            blockMix(x, y, scratch, r);
        }
        for (int i = 0; i < n; i++) {
            int j = x[(2 * r - 1) * 16] & (n - 1); // Integerify mod N (N power of 2)
            int[] vj = v[j];
            for (int k = 0; k < words; k++)
                x[k] ^= vj[k];
            blockMix(x, y, scratch, r);
        }
        for (int i = 0; i < words; i++) {
            int p = off + i * 4;
            int w = x[i];
            b[p] = (byte) w;
            b[p + 1] = (byte) (w >>> 8);
            b[p + 2] = (byte) (w >>> 16);
            b[p + 3] = (byte) (w >>> 24);
        }
    }

    /** scryptBlockMix: x (2r 64-byte blocks) → x, using y as scratch. */
    private static void blockMix(int[] x, int[] y, int[] scratch, int r) {
        int[] t = new int[16];
        System.arraycopy(x, (2 * r - 1) * 16, t, 0, 16);
        for (int i = 0; i < 2 * r; i++) {
            for (int k = 0; k < 16; k++)
                t[k] ^= x[i * 16 + k];
            salsa8(t, scratch);
            // Y_i = T; even blocks first, then odd (RFC 7914 step 3)
            int dst = (i % 2 == 0) ? (i / 2) * 16 : (r + i / 2) * 16;
            System.arraycopy(t, 0, y, dst, 16);
        }
        System.arraycopy(y, 0, x, 0, 32 * r);
    }

    /** Salsa20/8 core, in place on 16 LE words. */
    private static void salsa8(int[] b, int[] x) {
        System.arraycopy(b, 0, x, 0, 16);
        for (int round = 0; round < 8; round += 2) {
            // column round
            x[4] ^= Integer.rotateLeft(x[0] + x[12], 7);
            x[8] ^= Integer.rotateLeft(x[4] + x[0], 9);
            x[12] ^= Integer.rotateLeft(x[8] + x[4], 13);
            x[0] ^= Integer.rotateLeft(x[12] + x[8], 18);
            x[9] ^= Integer.rotateLeft(x[5] + x[1], 7);
            x[13] ^= Integer.rotateLeft(x[9] + x[5], 9);
            x[1] ^= Integer.rotateLeft(x[13] + x[9], 13);
            x[5] ^= Integer.rotateLeft(x[1] + x[13], 18);
            x[14] ^= Integer.rotateLeft(x[10] + x[6], 7);
            x[2] ^= Integer.rotateLeft(x[14] + x[10], 9);
            x[6] ^= Integer.rotateLeft(x[2] + x[14], 13);
            x[10] ^= Integer.rotateLeft(x[6] + x[2], 18);
            x[3] ^= Integer.rotateLeft(x[15] + x[11], 7);
            x[7] ^= Integer.rotateLeft(x[3] + x[15], 9);
            x[11] ^= Integer.rotateLeft(x[7] + x[3], 13);
            x[15] ^= Integer.rotateLeft(x[11] + x[7], 18);
            // row round
            x[1] ^= Integer.rotateLeft(x[0] + x[3], 7);
            x[2] ^= Integer.rotateLeft(x[1] + x[0], 9);
            x[3] ^= Integer.rotateLeft(x[2] + x[1], 13);
            x[0] ^= Integer.rotateLeft(x[3] + x[2], 18);
            x[6] ^= Integer.rotateLeft(x[5] + x[4], 7);
            x[7] ^= Integer.rotateLeft(x[6] + x[5], 9);
            x[4] ^= Integer.rotateLeft(x[7] + x[6], 13);
            x[5] ^= Integer.rotateLeft(x[4] + x[7], 18);
            x[11] ^= Integer.rotateLeft(x[10] + x[9], 7);
            x[8] ^= Integer.rotateLeft(x[11] + x[10], 9);
            x[9] ^= Integer.rotateLeft(x[8] + x[11], 13);
            x[10] ^= Integer.rotateLeft(x[9] + x[8], 18);
            x[12] ^= Integer.rotateLeft(x[15] + x[14], 7);
            x[13] ^= Integer.rotateLeft(x[12] + x[15], 9);
            x[14] ^= Integer.rotateLeft(x[13] + x[12], 13);
            x[15] ^= Integer.rotateLeft(x[14] + x[13], 18);
        }
        for (int i = 0; i < 16; i++)
            b[i] += x[i];
    }

    /** Hex decode; null on odd length / bad digit (mirrors auth.rs). */
    static byte[] hexDecode(String s) {
        if (s.length() % 2 != 0)
            return null;
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(s.charAt(2 * i), 16);
            int lo = Character.digit(s.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0)
                return null;
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    static String hexEncode(byte[] bytes) {
        StringBuilder b = new StringBuilder(bytes.length * 2);
        for (byte x : bytes)
            b.append(Character.forDigit((x >> 4) & 0xf, 16))
             .append(Character.forDigit(x & 0xf, 16));
        return b.toString();
    }
}
