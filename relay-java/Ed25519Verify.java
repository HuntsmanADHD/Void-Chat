/*
 * Ed25519Verify.java — signature verification over raw 32-byte public keys
 * and raw 64-byte signatures (the wire format the TS client sends, base58
 * encoded). The JDK's Ed25519 lives behind the EdEC key-spec API, which
 * wants the point decoded from the RFC 8032 little-endian encoding: 255
 * bits of y plus the parity bit of x in the top bit of the last byte.
 * Invalid keys/points/signatures all return false — never throw.
 */
import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.EdECPoint;
import java.security.spec.EdECPublicKeySpec;
import java.security.spec.NamedParameterSpec;

public final class Ed25519Verify {
    private Ed25519Verify() {}

    public static boolean verify(byte[] publicKey32, byte[] message, byte[] signature64) {
        if (publicKey32 == null || publicKey32.length != 32)
            return false;
        if (signature64 == null || signature64.length != 64)
            return false;
        try {
            byte[] le = publicKey32.clone();
            boolean xOdd = (le[31] & 0x80) != 0;
            le[31] &= 0x7f;
            // RFC 8032 is little-endian; BigInteger wants big-endian.
            byte[] be = new byte[32];
            for (int i = 0; i < 32; i++)
                be[i] = le[31 - i];
            BigInteger y = new BigInteger(1, be);
            EdECPublicKeySpec spec = new EdECPublicKeySpec(
                    NamedParameterSpec.ED25519, new EdECPoint(xOdd, y));
            PublicKey pub = KeyFactory.getInstance("Ed25519").generatePublic(spec);
            Signature sig = Signature.getInstance("Ed25519");
            sig.initVerify(pub);
            sig.update(message);
            return sig.verify(signature64);
        } catch (Exception e) {
            // bad point / not on curve / provider rejection — all just "no"
            return false;
        }
    }
}
