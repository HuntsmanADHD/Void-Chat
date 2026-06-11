/*
 * Argon2.java — Argon2 per RFC 9106 (variants d/i/id), hand-rolled on
 * Blake2b. Zero dependencies. Mints and verifies PHC-format strings
 * compatible with the Rust relay's `argon2` crate:
 *
 *   $argon2id$v=19$m=19456,t=2,p=1$<b64salt>$<b64tag>
 *
 * (standard base64 alphabet, no padding). New hashes use the same OWASP
 * interactive parameters as the Rust relay: m=19456 KiB, t=2, p=1, 16-byte
 * salt, 32-byte tag. Verification recomputes with whatever parameters the
 * stored string declares (capped — see SANITY caps — so a corrupted store
 * can't request gigabytes) and compares in constant time.
 *
 * Verified in RelayTest against the RFC 9106 §5 test vectors (all three
 * variants) and against PHC strings minted by the Rust relay.
 */
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

public final class Argon2 {
    private Argon2() {}

    public static final int VARIANT_D = 0;
    public static final int VARIANT_I = 1;
    public static final int VARIANT_ID = 2;
    public static final int VERSION_13 = 0x13;

    // Parameters for newly minted hashes (match the Rust relay's defaults).
    private static final int M_KIB = 19456;
    private static final int T_COST = 2;
    private static final int LANES = 1;
    private static final int SALT_LEN = 16;
    private static final int TAG_LEN = 32;

    // Verification caps: stored hashes only ever come from our own store,
    // but a corrupted/hostile store line must not OOM the relay.
    private static final int MAX_M_KIB = 1 << 21; // 2 GiB
    private static final int MAX_T = 64;
    private static final int MAX_P = 64;

    public static final int MIN_LEN = 4;   // password length bounds (bytes),
    public static final int MAX_LEN = 128; // mirrors auth.rs

    private static final SecureRandom RNG = new SecureRandom();
    private static final Base64.Encoder B64E = Base64.getEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getDecoder();

    /** Hash a fresh password; returns a PHC string. Throws on bad length. */
    public static String hashPassword(String password) {
        byte[] pw = password.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (pw.length < MIN_LEN)
            throw new IllegalArgumentException("password too short");
        if (pw.length > MAX_LEN)
            throw new IllegalArgumentException("password too long");
        byte[] salt = new byte[SALT_LEN];
        RNG.nextBytes(salt);
        byte[] tag = compute(VARIANT_ID, VERSION_13, pw, salt,
                new byte[0], new byte[0], T_COST, M_KIB, LANES, TAG_LEN);
        return "$argon2id$v=" + VERSION_13 + "$m=" + M_KIB + ",t=" + T_COST
                + ",p=" + LANES + "$" + B64E.encodeToString(salt)
                + "$" + B64E.encodeToString(tag);
    }

    /**
     * Verify a candidate against a stored PHC string. Returns false on any
     * parse failure or mismatch — malformed-store and wrong-password are
     * indistinguishable to the caller, matching auth.rs.
     */
    public static boolean verify(String password, String phc) {
        try {
            // $argon2id$v=19$m=19456,t=2,p=1$salt$tag
            String[] parts = phc.split("\\$");
            // split yields ["", alg, v=.., params, salt, tag]
            if (parts.length != 6 || !parts[0].isEmpty())
                return false;
            int variant;
            switch (parts[1]) {
                case "argon2d": variant = VARIANT_D; break;
                case "argon2i": variant = VARIANT_I; break;
                case "argon2id": variant = VARIANT_ID; break;
                default: return false;
            }
            if (!parts[2].startsWith("v="))
                return false;
            int version = Integer.parseInt(parts[2].substring(2));
            if (version != VERSION_13 && version != 0x10)
                return false;
            int m = -1, t = -1, p = -1;
            for (String kv : parts[3].split(",")) {
                int eq = kv.indexOf('=');
                if (eq < 0)
                    return false;
                String k = kv.substring(0, eq);
                String v = kv.substring(eq + 1);
                switch (k) {
                    case "m": m = Integer.parseInt(v); break;
                    case "t": t = Integer.parseInt(v); break;
                    case "p": p = Integer.parseInt(v); break;
                    case "keyid": case "data": return false; // unsupported
                    default: return false;
                }
            }
            if (m < 8 || m > MAX_M_KIB || t < 1 || t > MAX_T || p < 1 || p > MAX_P)
                return false;
            if (m < 8 * p)
                return false;
            byte[] salt = B64D.decode(parts[4]);
            byte[] expected = B64D.decode(parts[5]);
            if (salt.length < 8 || expected.length < 4)
                return false;
            byte[] pw = password.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            byte[] actual = compute(variant, version, pw, salt,
                    new byte[0], new byte[0], t, m, p, expected.length);
            return MessageDigest.isEqual(actual, expected);
        } catch (RuntimeException e) {
            return false;
        }
    }

    // ── Core (RFC 9106) ───────────────────────────────────────────────

    /**
     * The Argon2 function. P=password, S=salt, K=secret, X=associated data.
     * Exposed package-private so RelayTest can run the RFC vectors (which
     * use non-empty K and X).
     */
    static byte[] compute(int variant, int version, byte[] P, byte[] S,
            byte[] K, byte[] X, int t, int mKiB, int p, int tagLen) {
        // m' = 4*p*floor(m/4p); q = lane length; 4 slices per lane.
        int mPrime = 4 * p * (mKiB / (4 * p));
        int q = mPrime / p;
        int segLen = q / 4;

        // H0 = Blake2b-64(LE32(p) LE32(T) LE32(m) LE32(t) LE32(v) LE32(y)
        //                 LE32(|P|) P LE32(|S|) S LE32(|K|) K LE32(|X|) X)
        Blake2b h0b = new Blake2b(64);
        h0b.updateIntLE(p).updateIntLE(tagLen).updateIntLE(mKiB)
           .updateIntLE(t).updateIntLE(version).updateIntLE(variant);
        h0b.updateIntLE(P.length).update(P);
        h0b.updateIntLE(S.length).update(S);
        h0b.updateIntLE(K.length).update(K);
        h0b.updateIntLE(X.length).update(X);
        byte[] h0 = h0b.digest();

        // B[lane][col] — 1024-byte blocks as 128 longs.
        long[][] B = new long[mPrime][];

        // First two columns of every lane: H'(1024, H0 || LE32(col) || LE32(lane))
        for (int lane = 0; lane < p; lane++) {
            for (int col = 0; col < 2; col++) {
                byte[] in = new byte[72];
                System.arraycopy(h0, 0, in, 0, 64);
                putIntLE(in, 64, col);
                putIntLE(in, 68, lane);
                B[lane * q + col] = bytesToBlock(hPrime(1024, in));
            }
        }

        long[] addrInput = new long[128];
        long[] addrBlock = new long[128];
        long[] tmp1 = new long[128];
        long[] tmp2 = new long[128];
        long[] zeroBlock = new long[128];

        for (int pass = 0; pass < t; pass++) {
            for (int slice = 0; slice < 4; slice++) {
                for (int lane = 0; lane < p; lane++) {
                    boolean dataIndependent =
                            variant == VARIANT_I
                            || (variant == VARIANT_ID && pass == 0 && slice < 2);
                    int addrCounter = 0;
                    if (dataIndependent) {
                        java.util.Arrays.fill(addrInput, 0);
                        addrInput[0] = pass;
                        addrInput[1] = lane;
                        addrInput[2] = slice;
                        addrInput[3] = mPrime;
                        addrInput[4] = t;
                        addrInput[5] = variant;
                    }
                    int start = (pass == 0 && slice == 0) ? 2 : 0;
                    for (int idx = start; idx < segLen; idx++) {
                        int col = slice * segLen + idx;
                        int prevCol = col == 0 ? q - 1 : col - 1;
                        long[] prev = B[lane * q + prevCol];

                        long j;
                        if (dataIndependent) {
                            int within = idx & 127;
                            if (within == 0 || (idx == start && addrCounter == 0)) {
                                // next 128 pseudo-random values:
                                // addr = G(0, G(0, input)) with counter bump
                                addrInput[6] = ++addrCounter;
                                gCompress(zeroBlock, addrInput, tmp1, tmp2, false);
                                System.arraycopy(tmp1, 0, addrBlock, 0, 128);
                                gCompress(zeroBlock, addrBlock, tmp1, tmp2, false);
                                System.arraycopy(tmp1, 0, addrBlock, 0, 128);
                            }
                            j = addrBlock[within];
                        } else {
                            j = prev[0];
                        }
                        long j1 = j & 0xffffffffL;

                        // Reference lane: first slice of first pass stays in
                        // our own lane. (j >>> 32 is unsigned in the long.)
                        int refLane = (pass == 0 && slice == 0)
                                ? lane
                                : (int) ((j >>> 32) % p);

                        // Reference area size |W| (RFC 9106 §3.4.1.3).
                        int w;
                        if (pass == 0) {
                            if (slice == 0) {
                                w = idx - 1;
                            } else if (refLane == lane) {
                                w = slice * segLen + idx - 1;
                            } else {
                                w = slice * segLen - (idx == 0 ? 1 : 0);
                            }
                        } else {
                            if (refLane == lane) {
                                w = q - segLen + idx - 1;
                            } else {
                                w = q - segLen - (idx == 0 ? 1 : 0);
                            }
                        }

                        // zz = |W| - 1 - floor(|W| * (j1^2 / 2^64) )
                        long x = (j1 * j1) >>> 32;
                        long y = ((long) w * x) >>> 32;
                        int zz = (int) (w - 1 - y);

                        int refStart = (pass == 0) ? 0 : ((slice + 1) % 4) * segLen;
                        int refCol = (refStart + zz) % q;
                        long[] ref = B[refLane * q + refCol];

                        long[] cur = B[lane * q + col];
                        boolean xorOld = pass > 0 && version == VERSION_13;
                        if (cur == null) {
                            cur = new long[128];
                            B[lane * q + col] = cur;
                            xorOld = false;
                        } else if (pass > 0 && version != VERSION_13) {
                            // v16 overwrites on later passes
                            xorOld = false;
                        }
                        gCompressInto(prev, ref, cur, tmp1, tmp2, xorOld);
                    }
                }
            }
        }

        // C = XOR of every lane's last column; tag = H'(tagLen, C)
        long[] c = new long[128];
        for (int lane = 0; lane < p; lane++) {
            long[] last = B[lane * q + (q - 1)];
            for (int i = 0; i < 128; i++)
                c[i] ^= last[i];
        }
        return hPrime(tagLen, blockToBytes(c));
    }

    /** H'(T, X) — variable-length hash (RFC 9106 §3.3). */
    static byte[] hPrime(int tagLen, byte[] x) {
        byte[] lenPrefix = new byte[4];
        putIntLE(lenPrefix, 0, tagLen);
        if (tagLen <= 64) {
            return new Blake2b(tagLen).update(lenPrefix).update(x).digest();
        }
        int r = (tagLen + 31) / 32 - 2;
        byte[] out = new byte[tagLen];
        byte[] v = new Blake2b(64).update(lenPrefix).update(x).digest();
        System.arraycopy(v, 0, out, 0, 32);
        for (int i = 1; i < r; i++) {
            v = Blake2b.hash(64, v);
            System.arraycopy(v, 0, out, i * 32, 32);
        }
        int lastLen = tagLen - 32 * r;
        v = Blake2b.hash(lastLen, v);
        System.arraycopy(v, 0, out, r * 32, lastLen);
        return out;
    }

    // ── Compression function G (RFC 9106 §3.5) ────────────────────────

    /** result (into out) = G(x, y) [ ^ out if xorOld]. */
    private static void gCompressInto(long[] x, long[] y, long[] out,
            long[] r, long[] z, boolean xorOld) {
        for (int i = 0; i < 128; i++)
            r[i] = x[i] ^ y[i];
        System.arraycopy(r, 0, z, 0, 128);
        permute(z);
        if (xorOld) {
            for (int i = 0; i < 128; i++)
                out[i] ^= z[i] ^ r[i];
        } else {
            for (int i = 0; i < 128; i++)
                out[i] = z[i] ^ r[i];
        }
    }

    /** result (into out) = G(x, y) — fresh output buffer variant. */
    private static void gCompress(long[] x, long[] y, long[] out, long[] scratch,
            boolean unusedXor) {
        for (int i = 0; i < 128; i++)
            scratch[i] = x[i] ^ y[i];
        System.arraycopy(scratch, 0, out, 0, 128);
        permute(out);
        for (int i = 0; i < 128; i++)
            out[i] ^= scratch[i];
    }

    /** Apply P rowwise then columnwise over the 8x8 grid of 16-byte registers. */
    private static void permute(long[] v) {
        // rows: 8 rows of 16 consecutive longs
        for (int i = 0; i < 8; i++)
            blamkaRound(v,
                    16 * i, 16 * i + 1, 16 * i + 2, 16 * i + 3,
                    16 * i + 4, 16 * i + 5, 16 * i + 6, 16 * i + 7,
                    16 * i + 8, 16 * i + 9, 16 * i + 10, 16 * i + 11,
                    16 * i + 12, 16 * i + 13, 16 * i + 14, 16 * i + 15);
        // columns: 8 columns of 2-long pairs from each row
        for (int i = 0; i < 8; i++)
            blamkaRound(v,
                    2 * i, 2 * i + 1, 2 * i + 16, 2 * i + 17,
                    2 * i + 32, 2 * i + 33, 2 * i + 48, 2 * i + 49,
                    2 * i + 64, 2 * i + 65, 2 * i + 80, 2 * i + 81,
                    2 * i + 96, 2 * i + 97, 2 * i + 112, 2 * i + 113);
    }

    private static void blamkaRound(long[] v,
            int i0, int i1, int i2, int i3, int i4, int i5, int i6, int i7,
            int i8, int i9, int i10, int i11, int i12, int i13, int i14, int i15) {
        gB(v, i0, i4, i8, i12);
        gB(v, i1, i5, i9, i13);
        gB(v, i2, i6, i10, i14);
        gB(v, i3, i7, i11, i15);
        gB(v, i0, i5, i10, i15);
        gB(v, i1, i6, i11, i12);
        gB(v, i2, i7, i8, i13);
        gB(v, i3, i4, i9, i14);
    }

    /** BlaMka G: Blake2b's G with a = a + b + 2 * lo32(a) * lo32(b). */
    private static void gB(long[] v, int a, int b, int c, int d) {
        v[a] = v[a] + v[b] + 2 * ((v[a] & 0xffffffffL) * (v[b] & 0xffffffffL));
        v[d] = Long.rotateRight(v[d] ^ v[a], 32);
        v[c] = v[c] + v[d] + 2 * ((v[c] & 0xffffffffL) * (v[d] & 0xffffffffL));
        v[b] = Long.rotateRight(v[b] ^ v[c], 24);
        v[a] = v[a] + v[b] + 2 * ((v[a] & 0xffffffffL) * (v[b] & 0xffffffffL));
        v[d] = Long.rotateRight(v[d] ^ v[a], 16);
        v[c] = v[c] + v[d] + 2 * ((v[c] & 0xffffffffL) * (v[d] & 0xffffffffL));
        v[b] = Long.rotateRight(v[b] ^ v[c], 63);
    }

    // ── byte/long block plumbing ──────────────────────────────────────

    private static long[] bytesToBlock(byte[] b) {
        long[] v = new long[128];
        for (int i = 0; i < 128; i++) {
            int p = i * 8;
            v[i] = (b[p] & 0xffL)
                    | (b[p + 1] & 0xffL) << 8
                    | (b[p + 2] & 0xffL) << 16
                    | (b[p + 3] & 0xffL) << 24
                    | (b[p + 4] & 0xffL) << 32
                    | (b[p + 5] & 0xffL) << 40
                    | (b[p + 6] & 0xffL) << 48
                    | (b[p + 7] & 0xffL) << 56;
        }
        return v;
    }

    private static byte[] blockToBytes(long[] v) {
        byte[] b = new byte[1024];
        for (int i = 0; i < 128; i++) {
            long x = v[i];
            int p = i * 8;
            b[p] = (byte) x;
            b[p + 1] = (byte) (x >>> 8);
            b[p + 2] = (byte) (x >>> 16);
            b[p + 3] = (byte) (x >>> 24);
            b[p + 4] = (byte) (x >>> 32);
            b[p + 5] = (byte) (x >>> 40);
            b[p + 6] = (byte) (x >>> 48);
            b[p + 7] = (byte) (x >>> 56);
        }
        return b;
    }

    private static void putIntLE(byte[] b, int off, int v) {
        b[off] = (byte) v;
        b[off + 1] = (byte) (v >>> 8);
        b[off + 2] = (byte) (v >>> 16);
        b[off + 3] = (byte) (v >>> 24);
    }
}
