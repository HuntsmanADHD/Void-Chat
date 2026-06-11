/*
 * Ed25519Sign.java — detached Ed25519 signatures for the client's
 * announce/message/channel-join signing, replacing nacl.sign.detached.
 * Pure JDK (Signature/KeyFactory "Ed25519") — zero third-party deps.
 *
 * tweetnacl key format (preserved so existing identities keep working):
 *   secretKey = 64 bytes = seed(32) ‖ publicKey(32)
 *   publicKey = 32 bytes
 *   signature = 64 bytes, deterministic (RFC 8032)
 *
 * Ed25519 is deterministic, so a given (seed, message) yields a byte-identical
 * signature in every conforming implementation — cross-verified against the
 * client's noble-backed nacl.sign in scripts/ed25519-compat.mjs.
 */
import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.EdECPrivateKey;
import java.security.interfaces.EdECPublicKey;
import java.security.spec.EdECPoint;
import java.security.spec.EdECPrivateKeySpec;
import java.security.spec.EdECPublicKeySpec;
import java.security.spec.NamedParameterSpec;

public final class Ed25519Sign {
    private Ed25519Sign() {}

    public static final int SEED_LEN = 32;
    public static final int SECRET_KEY_LEN = 64; // seed ‖ pub
    public static final int PUBLIC_KEY_LEN = 32;
    public static final int SIGNATURE_LEN = 64;

    /**
     * Detached signature over `message` using a 64-byte tweetnacl secret key
     * (seed ‖ pub). Only the seed is used to sign; the JDK derives the rest.
     */
    public static byte[] signDetached(byte[] message, byte[] secretKey) {
        if (secretKey == null || secretKey.length != SECRET_KEY_LEN)
            throw new IllegalArgumentException("secretKey must be 64 bytes (seed‖pub)");
        try {
            byte[] seed = new byte[SEED_LEN];
            System.arraycopy(secretKey, 0, seed, 0, SEED_LEN);
            PrivateKey priv = KeyFactory.getInstance("Ed25519")
                    .generatePrivate(new EdECPrivateKeySpec(NamedParameterSpec.ED25519, seed));
            Signature s = Signature.getInstance("Ed25519");
            s.initSign(priv);
            s.update(message);
            return s.sign();
        } catch (Exception e) {
            throw new IllegalStateException("Ed25519 sign failed", e);
        }
    }

    /**
     * Verify a detached signature. Returns false on any malformed input —
     * never throws, matching tweetnacl/the client's verify.
     */
    public static boolean verifyDetached(byte[] message, byte[] signature, byte[] publicKey) {
        if (publicKey == null || publicKey.length != PUBLIC_KEY_LEN)
            return false;
        if (signature == null || signature.length != SIGNATURE_LEN)
            return false;
        try {
            byte[] le = publicKey.clone();
            boolean xOdd = (le[31] & 0x80) != 0;
            le[31] &= 0x7f;
            byte[] be = new byte[32];
            for (int i = 0; i < 32; i++)
                be[i] = le[31 - i];
            BigInteger y = new BigInteger(1, be);
            PublicKey pub = KeyFactory.getInstance("Ed25519")
                    .generatePublic(new EdECPublicKeySpec(NamedParameterSpec.ED25519, new EdECPoint(xOdd, y)));
            Signature s = Signature.getInstance("Ed25519");
            s.initVerify(pub);
            s.update(message);
            return s.verify(signature);
        } catch (Exception e) {
            return false;
        }
    }

    /** Fresh signing keypair: [secretKey64 (seed‖pub), publicKey32]. */
    public static byte[][] keyPair() {
        try {
            KeyPairGenerator kpg = KeyPairGenerator.getInstance("Ed25519");
            KeyPair kp = kpg.generateKeyPair();
            byte[] seed = ((EdECPrivateKey) kp.getPrivate()).getBytes()
                    .orElseThrow(() -> new IllegalStateException("no raw seed"));
            byte[] pub = encodePublic((EdECPublicKey) kp.getPublic());
            byte[] secretKey = new byte[SECRET_KEY_LEN];
            System.arraycopy(seed, 0, secretKey, 0, SEED_LEN);
            System.arraycopy(pub, 0, secretKey, SEED_LEN, PUBLIC_KEY_LEN);
            return new byte[][] { secretKey, pub };
        } catch (Exception e) {
            throw new IllegalStateException("Ed25519 keygen failed", e);
        }
    }

    /** The public key carried in a tweetnacl 64-byte secret key. */
    public static byte[] publicKeyFromSecret(byte[] secretKey) {
        if (secretKey == null || secretKey.length != SECRET_KEY_LEN)
            throw new IllegalArgumentException("secretKey must be 64 bytes");
        byte[] pub = new byte[PUBLIC_KEY_LEN];
        System.arraycopy(secretKey, SEED_LEN, pub, 0, PUBLIC_KEY_LEN);
        return pub;
    }

    /** EdEC point → RFC 8032 raw 32-byte little-endian encoding (y ‖ x-odd bit). */
    private static byte[] encodePublic(EdECPublicKey pub) {
        EdECPoint pt = pub.getPoint();
        byte[] be = pt.getY().toByteArray();
        byte[] le = new byte[32];
        for (int i = 0; i < be.length && i < 32; i++)
            le[i] = be[be.length - 1 - i];
        if (pt.isXOdd())
            le[31] |= (byte) 0x80;
        return le;
    }
}
