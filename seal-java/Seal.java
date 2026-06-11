/*
 * Seal.java — ChaCha20, Poly1305, ChaCha20-Poly1305 (RFC 8439), and the
 * XChaCha20-Poly1305 extension (24-byte nonce via HChaCha20). Zero
 * dependencies (java.base only). A Java port of VoidSeal (the verified
 * pure-JS ChaCha20-Poly1305 at ~/Desktop/VoidSeal-Final), plus the HChaCha20
 * / XChaCha20 layer needed so the message seal can use random 24-byte
 * nonces safely.
 *
 * Verified in SealTest against: RFC 8439 §2.4/§2.5.2/§2.8.2 vectors, the
 * draft-irtf-cfrg-xchacha HChaCha20 vector, and libsodium (random inputs).
 *
 * This file is the symmetric core; Box.java composes it with X25519 into the
 * public-key message seal that replaces nacl.box.
 */
public final class Seal {
    private Seal() {}

    // "expand 32-byte k"
    private static final int C0 = 0x61707865, C1 = 0x3320646e, C2 = 0x79622d32, C3 = 0x6b206574;

    private static int le32(byte[] b, int o) {
        return (b[o] & 0xff) | (b[o + 1] & 0xff) << 8 | (b[o + 2] & 0xff) << 16 | (b[o + 3] & 0xff) << 24;
    }

    // ── ChaCha20 (RFC 8439) ───────────────────────────────────────────

    /** XOR `data` with the ChaCha20 keystream for (key, 12-byte nonce, counter). */
    public static byte[] chacha20(byte[] key, byte[] nonce, int counter, byte[] data) {
        int k0 = le32(key, 0), k1 = le32(key, 4), k2 = le32(key, 8), k3 = le32(key, 12),
            k4 = le32(key, 16), k5 = le32(key, 20), k6 = le32(key, 24), k7 = le32(key, 28);
        int n0 = le32(nonce, 0), n1 = le32(nonce, 4), n2 = le32(nonce, 8);
        byte[] out = new byte[data.length];
        byte[] ks = new byte[64];
        int ctr = counter;
        for (int off = 0; off < data.length; off += 64, ctr++) {
            int s0 = C0, s1 = C1, s2 = C2, s3 = C3,
                s4 = k0, s5 = k1, s6 = k2, s7 = k3,
                s8 = k4, s9 = k5, s10 = k6, s11 = k7,
                s12 = ctr, s13 = n0, s14 = n1, s15 = n2;
            for (int r = 0; r < 10; r++) {
                // column round
                s0 += s4; s12 = Integer.rotateLeft(s12 ^ s0, 16);
                s8 += s12; s4 = Integer.rotateLeft(s4 ^ s8, 12);
                s0 += s4; s12 = Integer.rotateLeft(s12 ^ s0, 8);
                s8 += s12; s4 = Integer.rotateLeft(s4 ^ s8, 7);
                s1 += s5; s13 = Integer.rotateLeft(s13 ^ s1, 16);
                s9 += s13; s5 = Integer.rotateLeft(s5 ^ s9, 12);
                s1 += s5; s13 = Integer.rotateLeft(s13 ^ s1, 8);
                s9 += s13; s5 = Integer.rotateLeft(s5 ^ s9, 7);
                s2 += s6; s14 = Integer.rotateLeft(s14 ^ s2, 16);
                s10 += s14; s6 = Integer.rotateLeft(s6 ^ s10, 12);
                s2 += s6; s14 = Integer.rotateLeft(s14 ^ s2, 8);
                s10 += s14; s6 = Integer.rotateLeft(s6 ^ s10, 7);
                s3 += s7; s15 = Integer.rotateLeft(s15 ^ s3, 16);
                s11 += s15; s7 = Integer.rotateLeft(s7 ^ s11, 12);
                s3 += s7; s15 = Integer.rotateLeft(s15 ^ s3, 8);
                s11 += s15; s7 = Integer.rotateLeft(s7 ^ s11, 7);
                // diagonal round
                s0 += s5; s15 = Integer.rotateLeft(s15 ^ s0, 16);
                s10 += s15; s5 = Integer.rotateLeft(s5 ^ s10, 12);
                s0 += s5; s15 = Integer.rotateLeft(s15 ^ s0, 8);
                s10 += s15; s5 = Integer.rotateLeft(s5 ^ s10, 7);
                s1 += s6; s12 = Integer.rotateLeft(s12 ^ s1, 16);
                s11 += s12; s6 = Integer.rotateLeft(s6 ^ s11, 12);
                s1 += s6; s12 = Integer.rotateLeft(s12 ^ s1, 8);
                s11 += s12; s6 = Integer.rotateLeft(s6 ^ s11, 7);
                s2 += s7; s13 = Integer.rotateLeft(s13 ^ s2, 16);
                s8 += s13; s7 = Integer.rotateLeft(s7 ^ s8, 12);
                s2 += s7; s13 = Integer.rotateLeft(s13 ^ s2, 8);
                s8 += s13; s7 = Integer.rotateLeft(s7 ^ s8, 7);
                s3 += s4; s14 = Integer.rotateLeft(s14 ^ s3, 16);
                s9 += s14; s4 = Integer.rotateLeft(s4 ^ s9, 12);
                s3 += s4; s14 = Integer.rotateLeft(s14 ^ s3, 8);
                s9 += s14; s4 = Integer.rotateLeft(s4 ^ s9, 7);
            }
            putLE(ks, 0, s0 + C0); putLE(ks, 4, s1 + C1); putLE(ks, 8, s2 + C2); putLE(ks, 12, s3 + C3);
            putLE(ks, 16, s4 + k0); putLE(ks, 20, s5 + k1); putLE(ks, 24, s6 + k2); putLE(ks, 28, s7 + k3);
            putLE(ks, 32, s8 + k4); putLE(ks, 36, s9 + k5); putLE(ks, 40, s10 + k6); putLE(ks, 44, s11 + k7);
            putLE(ks, 48, s12 + ctr); putLE(ks, 52, s13 + n0); putLE(ks, 56, s14 + n1); putLE(ks, 60, s15 + n2);
            int m = Math.min(64, data.length - off);
            for (int i = 0; i < m; i++)
                out[off + i] = (byte) (data[off + i] ^ ks[i]);
        }
        return out;
    }

    private static void putLE(byte[] b, int o, int v) {
        b[o] = (byte) v; b[o + 1] = (byte) (v >>> 8); b[o + 2] = (byte) (v >>> 16); b[o + 3] = (byte) (v >>> 24);
    }

    /** HChaCha20 (draft-irtf-cfrg-xchacha §2.2): key32 + in16 → subkey32. */
    public static byte[] hchacha20(byte[] key, byte[] in16) {
        int s0 = C0, s1 = C1, s2 = C2, s3 = C3,
            s4 = le32(key, 0), s5 = le32(key, 4), s6 = le32(key, 8), s7 = le32(key, 12),
            s8 = le32(key, 16), s9 = le32(key, 20), s10 = le32(key, 24), s11 = le32(key, 28),
            s12 = le32(in16, 0), s13 = le32(in16, 4), s14 = le32(in16, 8), s15 = le32(in16, 12);
        for (int r = 0; r < 10; r++) {
            s0 += s4; s12 = Integer.rotateLeft(s12 ^ s0, 16);
            s8 += s12; s4 = Integer.rotateLeft(s4 ^ s8, 12);
            s0 += s4; s12 = Integer.rotateLeft(s12 ^ s0, 8);
            s8 += s12; s4 = Integer.rotateLeft(s4 ^ s8, 7);
            s1 += s5; s13 = Integer.rotateLeft(s13 ^ s1, 16);
            s9 += s13; s5 = Integer.rotateLeft(s5 ^ s9, 12);
            s1 += s5; s13 = Integer.rotateLeft(s13 ^ s1, 8);
            s9 += s13; s5 = Integer.rotateLeft(s5 ^ s9, 7);
            s2 += s6; s14 = Integer.rotateLeft(s14 ^ s2, 16);
            s10 += s14; s6 = Integer.rotateLeft(s6 ^ s10, 12);
            s2 += s6; s14 = Integer.rotateLeft(s14 ^ s2, 8);
            s10 += s14; s6 = Integer.rotateLeft(s6 ^ s10, 7);
            s3 += s7; s15 = Integer.rotateLeft(s15 ^ s3, 16);
            s11 += s15; s7 = Integer.rotateLeft(s7 ^ s11, 12);
            s3 += s7; s15 = Integer.rotateLeft(s15 ^ s3, 8);
            s11 += s15; s7 = Integer.rotateLeft(s7 ^ s11, 7);
            s0 += s5; s15 = Integer.rotateLeft(s15 ^ s0, 16);
            s10 += s15; s5 = Integer.rotateLeft(s5 ^ s10, 12);
            s0 += s5; s15 = Integer.rotateLeft(s15 ^ s0, 8);
            s10 += s15; s5 = Integer.rotateLeft(s5 ^ s10, 7);
            s1 += s6; s12 = Integer.rotateLeft(s12 ^ s1, 16);
            s11 += s12; s6 = Integer.rotateLeft(s6 ^ s11, 12);
            s1 += s6; s12 = Integer.rotateLeft(s12 ^ s1, 8);
            s11 += s12; s6 = Integer.rotateLeft(s6 ^ s11, 7);
            s2 += s7; s13 = Integer.rotateLeft(s13 ^ s2, 16);
            s8 += s13; s7 = Integer.rotateLeft(s7 ^ s8, 12);
            s2 += s7; s13 = Integer.rotateLeft(s13 ^ s2, 8);
            s8 += s13; s7 = Integer.rotateLeft(s7 ^ s8, 7);
            s3 += s4; s14 = Integer.rotateLeft(s14 ^ s3, 16);
            s9 += s14; s4 = Integer.rotateLeft(s4 ^ s9, 12);
            s3 += s4; s14 = Integer.rotateLeft(s14 ^ s3, 8);
            s9 += s14; s4 = Integer.rotateLeft(s4 ^ s9, 7);
        }
        byte[] out = new byte[32];
        putLE(out, 0, s0); putLE(out, 4, s1); putLE(out, 8, s2); putLE(out, 12, s3);
        putLE(out, 16, s12); putLE(out, 20, s13); putLE(out, 24, s14); putLE(out, 28, s15);
        return out;
    }

    // ── Poly1305 (RFC 8439 §2.5) — poly1305-donna 5×26-bit limbs ──────

    public static byte[] poly1305(byte[] msg, byte[] key) {
        // r &= 0xffffffc0ffffffc0ffffffc0fffffff (clamp), split into 5×26-bit
        long t0 = le32(key, 0) & 0xffffffffL;
        long t1 = le32(key, 4) & 0xffffffffL;
        long t2 = le32(key, 8) & 0xffffffffL;
        long t3 = le32(key, 12) & 0xffffffffL;
        long r0 = t0 & 0x3ffffffL;
        long r1 = ((t0 >>> 26) | (t1 << 6)) & 0x3ffff03L;
        long r2 = ((t1 >>> 20) | (t2 << 12)) & 0x3ffc0ffL;
        long r3 = ((t2 >>> 14) | (t3 << 18)) & 0x3f03fffL;
        long r4 = (t3 >>> 8) & 0x00fffffL;
        long s1 = r1 * 5, s2 = r2 * 5, s3 = r3 * 5, s4 = r4 * 5;

        long h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0;
        int off = 0, len = msg.length;
        byte[] block = new byte[16];
        while (len > 0) {
            int n = Math.min(16, len);
            long hibit;
            byte[] m;
            int mo;
            if (n == 16) {
                m = msg; mo = off; hibit = 1L << 24;
            } else {
                for (int i = 0; i < 16; i++) block[i] = 0;
                for (int i = 0; i < n; i++) block[i] = msg[off + i];
                block[n] = 1;
                m = block; mo = 0; hibit = 0;
            }
            long u0 = le32(m, mo) & 0xffffffffL;
            long u1 = le32(m, mo + 4) & 0xffffffffL;
            long u2 = le32(m, mo + 8) & 0xffffffffL;
            long u3 = le32(m, mo + 12) & 0xffffffffL;
            h0 += u0 & 0x3ffffffL;
            h1 += ((u0 >>> 26) | (u1 << 6)) & 0x3ffffffL;
            h2 += ((u1 >>> 20) | (u2 << 12)) & 0x3ffffffL;
            h3 += ((u2 >>> 14) | (u3 << 18)) & 0x3ffffffL;
            h4 += (u3 >>> 8) | hibit;

            // d = h * r mod 2^130-5
            long d0 = h0 * r0 + h1 * s4 + h2 * s3 + h3 * s2 + h4 * s1;
            long d1 = h0 * r1 + h1 * r0 + h2 * s4 + h3 * s3 + h4 * s2;
            long d2 = h0 * r2 + h1 * r1 + h2 * r0 + h3 * s4 + h4 * s3;
            long d3 = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * s4;
            long d4 = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;

            long c;
            c = d0 >>> 26; h0 = d0 & 0x3ffffffL; d1 += c;
            c = d1 >>> 26; h1 = d1 & 0x3ffffffL; d2 += c;
            c = d2 >>> 26; h2 = d2 & 0x3ffffffL; d3 += c;
            c = d3 >>> 26; h3 = d3 & 0x3ffffffL; d4 += c;
            c = d4 >>> 26; h4 = d4 & 0x3ffffffL; h0 += c * 5;
            c = h0 >>> 26; h0 = h0 & 0x3ffffffL; h1 += c;

            off += n; len -= n;
        }

        // fully carry h
        long c;
        c = h1 >>> 26; h1 &= 0x3ffffffL; h2 += c;
        c = h2 >>> 26; h2 &= 0x3ffffffL; h3 += c;
        c = h3 >>> 26; h3 &= 0x3ffffffL; h4 += c;
        c = h4 >>> 26; h4 &= 0x3ffffffL; h0 += c * 5;
        c = h0 >>> 26; h0 &= 0x3ffffffL; h1 += c;

        // compute h - p
        long g0 = h0 + 5; c = g0 >>> 26; g0 &= 0x3ffffffL;
        long g1 = h1 + c; c = g1 >>> 26; g1 &= 0x3ffffffL;
        long g2 = h2 + c; c = g2 >>> 26; g2 &= 0x3ffffffL;
        long g3 = h3 + c; c = g3 >>> 26; g3 &= 0x3ffffffL;
        long g4 = h4 + c - (1L << 26);

        // select h if h < p, else h - p (constant-time mask)
        long mask = (g4 >>> 63) - 1; // 0 if g4 negative (h<p) → use h; all-ones if h>=p
        g0 &= mask; g1 &= mask; g2 &= mask; g3 &= mask; g4 &= mask;
        long nmask = ~mask;
        h0 = (h0 & nmask) | g0;
        h1 = (h1 & nmask) | g1;
        h2 = (h2 & nmask) | g2;
        h3 = (h3 & nmask) | g3;
        h4 = (h4 & nmask) | g4;

        // h = h % 2^128, then + s (the high 16 key bytes), little-endian
        long f0 = (h0 | (h1 << 26)) & 0xffffffffL;
        long f1 = ((h1 >>> 6) | (h2 << 20)) & 0xffffffffL;
        long f2 = ((h2 >>> 12) | (h3 << 14)) & 0xffffffffL;
        long f3 = ((h3 >>> 18) | (h4 << 8)) & 0xffffffffL;

        long acc = f0 + (le32(key, 16) & 0xffffffffL); f0 = acc & 0xffffffffL;
        acc = f1 + (le32(key, 20) & 0xffffffffL) + (acc >>> 32); f1 = acc & 0xffffffffL;
        acc = f2 + (le32(key, 24) & 0xffffffffL) + (acc >>> 32); f2 = acc & 0xffffffffL;
        acc = f3 + (le32(key, 28) & 0xffffffffL) + (acc >>> 32); f3 = acc & 0xffffffffL;

        byte[] tag = new byte[16];
        putLE(tag, 0, (int) f0); putLE(tag, 4, (int) f1); putLE(tag, 8, (int) f2); putLE(tag, 12, (int) f3);
        return tag;
    }

    // ── ChaCha20-Poly1305 AEAD (RFC 8439 §2.8) ────────────────────────

    private static byte[] poly1305KeyGen(byte[] key, byte[] nonce) {
        byte[] block = chacha20(key, nonce, 0, new byte[64]);
        byte[] otk = new byte[32];
        System.arraycopy(block, 0, otk, 0, 32);
        return otk;
    }

    private static byte[] macData(byte[] aad, byte[] ct) {
        int aadPad = (16 - (aad.length % 16)) % 16;
        int ctPad = (16 - (ct.length % 16)) % 16;
        byte[] d = new byte[aad.length + aadPad + ct.length + ctPad + 16];
        int o = 0;
        System.arraycopy(aad, 0, d, o, aad.length); o += aad.length + aadPad;
        System.arraycopy(ct, 0, d, o, ct.length); o += ct.length + ctPad;
        writeLE64(d, o, aad.length); o += 8;
        writeLE64(d, o, ct.length);
        return d;
    }

    private static void writeLE64(byte[] b, int o, long v) {
        for (int i = 0; i < 8; i++) b[o + i] = (byte) (v >>> (8 * i));
    }

    /** AEAD seal (RFC 8439). Returns ciphertext||tag (tag appended). */
    public static byte[] aeadSeal(byte[] key, byte[] nonce12, byte[] plaintext, byte[] aad) {
        byte[] otk = poly1305KeyGen(key, nonce12);
        byte[] ct = chacha20(key, nonce12, 1, plaintext);
        byte[] tag = poly1305(macData(aad, ct), otk);
        byte[] out = new byte[ct.length + 16];
        System.arraycopy(ct, 0, out, 0, ct.length);
        System.arraycopy(tag, 0, out, ct.length, 16);
        return out;
    }

    /** AEAD open. Input is ciphertext||tag. Returns plaintext, or null if auth fails. */
    public static byte[] aeadOpen(byte[] key, byte[] nonce12, byte[] ctWithTag, byte[] aad) {
        if (ctWithTag.length < 16)
            return null;
        int ctLen = ctWithTag.length - 16;
        byte[] ct = new byte[ctLen];
        byte[] tag = new byte[16];
        System.arraycopy(ctWithTag, 0, ct, 0, ctLen);
        System.arraycopy(ctWithTag, ctLen, tag, 0, 16);
        byte[] otk = poly1305KeyGen(key, nonce12);
        byte[] expect = poly1305(macData(aad, ct), otk);
        if (!ctEqual(expect, tag))
            return null;
        return chacha20(key, nonce12, 1, ct);
    }

    // ── XChaCha20-Poly1305 IETF (24-byte nonce) ───────────────────────

    /** Derive the (subkey, 12-byte nonce) pair for an XChaCha 24-byte nonce. */
    private static byte[] xNonce(byte[] nonce24, byte[] out12) {
        // 12-byte nonce = 0x00000000 || nonce24[16:24]
        out12[0] = 0; out12[1] = 0; out12[2] = 0; out12[3] = 0;
        System.arraycopy(nonce24, 16, out12, 4, 8);
        return out12;
    }

    public static byte[] xaeadSeal(byte[] key, byte[] nonce24, byte[] plaintext, byte[] aad) {
        byte[] in16 = new byte[16];
        System.arraycopy(nonce24, 0, in16, 0, 16);
        byte[] subkey = hchacha20(key, in16);
        byte[] n12 = xNonce(nonce24, new byte[12]);
        return aeadSeal(subkey, n12, plaintext, aad);
    }

    public static byte[] xaeadOpen(byte[] key, byte[] nonce24, byte[] ctWithTag, byte[] aad) {
        byte[] in16 = new byte[16];
        System.arraycopy(nonce24, 0, in16, 0, 16);
        byte[] subkey = hchacha20(key, in16);
        byte[] n12 = xNonce(nonce24, new byte[12]);
        return aeadOpen(subkey, n12, ctWithTag, aad);
    }

    /** Constant-time equality. */
    public static boolean ctEqual(byte[] a, byte[] b) {
        if (a.length != b.length)
            return false;
        int d = 0;
        for (int i = 0; i < a.length; i++)
            d |= a[i] ^ b[i];
        return d == 0;
    }
}
