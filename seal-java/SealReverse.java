/*
 * SealReverse.java — Java seals N random boxes for libsodium to open.
 * Emits one JSON line per case to stdout (consumed by oracle.py 'open') and
 * writes the expected plaintext hex (one per line) to /tmp/seal_java_expect.txt.
 * Test-only.
 */
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

public final class SealReverse {
    public static void main(String[] args) throws Exception {
        SecureRandom rng = new SecureRandom();
        StringBuilder lines = new StringBuilder();
        List<String> expect = new ArrayList<>();
        int n = 300;
        for (int i = 0; i < n; i++) {
            Object[] sender = Box.generateKeyPair();
            Object[] recipient = Box.generateKeyPair();
            byte[] senderSec = (byte[]) sender[0];
            String senderPub = (String) sender[1];
            byte[] recipientSec = (byte[]) recipient[0];
            String recipientPub = (String) recipient[1];

            int mlen = rng.nextInt(4096);
            byte[] m = new byte[mlen];
            rng.nextBytes(m);
            String plaintext = new String(m, StandardCharsets.UTF_8); // round-trips as UTF-8 string
            byte[] mUtf8 = plaintext.getBytes(StandardCharsets.UTF_8);

            Box.Sealed sealed = Box.sealForRecipient(plaintext, recipientPub, senderSec);
            byte[] ct = Base64.getDecoder().decode(sealed.ciphertext);
            byte[] nonce = Base64.getDecoder().decode(sealed.nonce);

            // libsodium opens with recipient secret + sender public.
            lines.append("{\"senderPub\":\"").append(hx(Base58.decode(senderPub)))
                 .append("\",\"recipientSecret\":\"").append(hx(recipientSec))
                 .append("\",\"nonce\":\"").append(hx(nonce))
                 .append("\",\"ct\":\"").append(hx(ct)).append("\"}\n");
            expect.add(hx(mUtf8));
        }
        Files.writeString(Path.of("/tmp/seal_java_expect.txt"), String.join("\n", expect) + "\n");
        System.out.print(lines);
    }

    static String hx(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }
}
