/*
 * Box.java — public-key authenticated message encryption, replacing the
 * client's nacl.box seal. This is libsodium's standard
 * crypto_box_curve25519xchacha20poly1305 construction:
 *
 *   shared = X25519(mySecret, theirPublic)          // ECDH (JDK XDH)
 *   boxKey = HChaCha20(key=shared, in=zeros16)       // beforenm
 *   sealed = XChaCha20-Poly1305(boxKey, nonce24, m)  // afternm
 *
 * Chosen over raw NaCl box (XSalsa20) deliberately: the 24-byte XChaCha
 * nonce makes random per-message nonces safe, and every layer is an
 * independently test-vectored standard. X25519 comes from the JDK (XDH);
 * everything else is Seal.java. Zero third-party dependencies.
 *
 * Wire surface mirrors the TS sealForRecipient/openFromSender: box public
 * keys are base58, ciphertext + nonce are base64. NOTE: this is a NEW wire
 * format, NOT compatible with the old nacl.box — a deliberate flag-day cutover.
 */
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.NamedParameterSpec;
import java.security.spec.XECPrivateKeySpec;
import java.security.spec.XECPublicKeySpec;
import java.util.Base64;
import javax.crypto.KeyAgreement;

public final class Box {
    private Box() {}

    public static final int PUBLIC_KEY_LEN = 32;
    public static final int SECRET_KEY_LEN = 32;
    public static final int NONCE_LEN = 24;
    public static final int MAX_PLAINTEXT_BYTES = 64 * 1024;

    private static final SecureRandom RNG = new SecureRandom();
    private static final byte[] ZERO16 = new byte[16];

    public static final class Sealed {
        public final String ciphertext; // base64(ct || tag)
        public final String nonce;       // base64(24-byte nonce)
        public Sealed(String ciphertext, String nonce) {
            this.ciphertext = ciphertext;
            this.nonce = nonce;
        }
    }

    /**
     * Seal `plaintext` to a recipient box public key (base58) using the
     * sender's box secret (raw 32 bytes). Returns base64 ciphertext+nonce, or
     * null if the recipient key is malformed or plaintext exceeds the cap.
     */
    public static Sealed sealForRecipient(String plaintext, String recipientPubB58, byte[] senderSecret) {
        byte[] plain = plaintext.getBytes(StandardCharsets.UTF_8);
        if (plain.length > MAX_PLAINTEXT_BYTES)
            return null;
        byte[] recipientPub = Base58.decode(recipientPubB58);
        if (recipientPub == null || recipientPub.length != PUBLIC_KEY_LEN)
            return null;
        if (senderSecret == null || senderSecret.length != SECRET_KEY_LEN)
            return null;
        byte[] boxKey = beforenm(recipientPub, senderSecret);
        if (boxKey == null)
            return null;
        byte[] nonce = new byte[NONCE_LEN];
        RNG.nextBytes(nonce);
        byte[] sealed = Seal.xaeadSeal(boxKey, nonce, plain, new byte[0]);
        return new Sealed(b64(sealed), b64(nonce));
    }

    /**
     * Open a sealed message from a sender box public key (base58). Returns
     * plaintext, or null on malformed input / authentication failure.
     */
    public static String openFromSender(String ciphertextB64, String nonceB64,
            String senderPubB58, byte[] recipientSecret) {
        byte[] senderPub = Base58.decode(senderPubB58);
        if (senderPub == null || senderPub.length != PUBLIC_KEY_LEN)
            return null;
        if (recipientSecret == null || recipientSecret.length != SECRET_KEY_LEN)
            return null;
        byte[] sealed, nonce;
        try {
            sealed = Base64.getDecoder().decode(ciphertextB64);
            nonce = Base64.getDecoder().decode(nonceB64);
        } catch (IllegalArgumentException e) {
            return null;
        }
        if (nonce.length != NONCE_LEN)
            return null;
        byte[] boxKey = beforenm(senderPub, recipientSecret);
        if (boxKey == null)
            return null;
        byte[] plain = Seal.xaeadOpen(boxKey, nonce, sealed, new byte[0]);
        if (plain == null)
            return null;
        return new String(plain, StandardCharsets.UTF_8);
    }

    /**
     * crypto_box beforenm: X25519 ECDH → HChaCha20 key derivation, with an
     * LRU cache — this is exactly the precompute split libsodium's
     * beforenm/afternm API exists for. The ECDH dominates a seal (~90 µs),
     * so re-sealing to the same peer (every channel message) skips it. The
     * cache key is a SHA-256 over both inputs, so distinct identities in
     * one process can't collide, and no key material sits in map keys.
     */
    static byte[] beforenm(byte[] theirPublic, byte[] mySecret) {
        String cacheKey = fingerprint(theirPublic, mySecret);
        synchronized (BEFORENM_CACHE) {
            byte[] hit = BEFORENM_CACHE.get(cacheKey);
            if (hit != null)
                return hit.clone();
        }
        byte[] shared = x25519(mySecret, theirPublic);
        if (shared == null)
            return null;
        byte[] boxKey = Seal.hchacha20(shared, ZERO16);
        synchronized (BEFORENM_CACHE) {
            BEFORENM_CACHE.put(cacheKey, boxKey.clone());
        }
        return boxKey;
    }

    private static final int BEFORENM_CACHE_MAX = 512;
    private static final java.util.LinkedHashMap<String, byte[]> BEFORENM_CACHE =
            new java.util.LinkedHashMap<>(64, 0.75f, true) { // access-order LRU
                @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, byte[]> e) {
                    if (size() > BEFORENM_CACHE_MAX) {
                        java.util.Arrays.fill(e.getValue(), (byte) 0); // scrub evicted key
                        return true;
                    }
                    return false;
                }
            };

    private static String fingerprint(byte[] theirPublic, byte[] mySecret) {
        try {
            java.security.MessageDigest d = java.security.MessageDigest.getInstance("SHA-256");
            d.update(mySecret);
            d.update(theirPublic);
            return Base64.getEncoder().encodeToString(d.digest());
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    // ── X25519 via the JDK (XDH) ──────────────────────────────────────

    /**
     * Raw X25519 scalar multiplication. `secret` is a raw 32-byte scalar
     * (clamped internally by the JDK per RFC 7748); `publicU` is the raw
     * 32-byte little-endian u-coordinate. Returns the 32-byte shared secret,
     * or null on an all-zero (small-order) result.
     */
    static byte[] x25519(byte[] secret, byte[] publicU) {
        try {
            KeyFactory kf = KeyFactory.getInstance("X25519");
            PrivateKey priv = kf.generatePrivate(
                    new XECPrivateKeySpec(NamedParameterSpec.X25519, secret.clone()));
            // RFC 7748 decodeUCoordinate: mask bit 255, interpret little-endian.
            byte[] le = publicU.clone();
            le[31] &= 0x7f;
            BigInteger u = new BigInteger(1, reverse(le));
            PublicKey pub = kf.generatePublic(
                    new XECPublicKeySpec(NamedParameterSpec.X25519, u));
            KeyAgreement ka = KeyAgreement.getInstance("X25519");
            ka.init(priv);
            ka.doPhase(pub, true);
            byte[] shared = ka.generateSecret();
            // Reject all-zero shared secret (contributory behaviour: a
            // small-order public key would otherwise force a known key).
            int acc = 0;
            for (byte b : shared) acc |= b;
            if (acc == 0)
                return null;
            return shared;
        } catch (Exception e) {
            return null;
        }
    }

    /** Derive the box public key (base58) from a raw 32-byte secret. */
    public static String publicKeyFromSecret(byte[] secret) {
        byte[] basepoint = new byte[32];
        basepoint[0] = 9;
        byte[] pub = x25519Base(secret, basepoint);
        return Base58.encode(pub);
    }

    /** Like x25519 but without the all-zero rejection (base-point mult never zeroes). */
    private static byte[] x25519Base(byte[] secret, byte[] basepoint) {
        try {
            KeyFactory kf = KeyFactory.getInstance("X25519");
            PrivateKey priv = kf.generatePrivate(
                    new XECPrivateKeySpec(NamedParameterSpec.X25519, secret.clone()));
            BigInteger u = new BigInteger(1, reverse(basepoint));
            PublicKey pub = kf.generatePublic(new XECPublicKeySpec(NamedParameterSpec.X25519, u));
            KeyAgreement ka = KeyAgreement.getInstance("X25519");
            ka.init(priv);
            ka.doPhase(pub, true);
            return ka.generateSecret();
        } catch (Exception e) {
            throw new IllegalStateException("X25519 base mult failed", e);
        }
    }

    /** Generate a fresh box keypair: [secret32, publicKeyB58]. */
    public static Object[] generateKeyPair() {
        byte[] secret = new byte[SECRET_KEY_LEN];
        RNG.nextBytes(secret);
        return new Object[] { secret, publicKeyFromSecret(secret) };
    }

    private static byte[] reverse(byte[] b) {
        byte[] r = new byte[b.length];
        for (int i = 0; i < b.length; i++)
            r[i] = b[b.length - 1 - i];
        return r;
    }

    private static String b64(byte[] b) {
        return Base64.getEncoder().encodeToString(b);
    }
}
