/*
 * SealInterop.java — bridge for the TS↔Java cross-impl proof
 * (scripts/seal-compat.mjs). Test-only.
 *
 *   selfgen N : Java seals N random boxes, emits JSONL the TS side opens
 *               {senderPub(b58), recipientSecret(hex), nonce(b64), ct(b64), plain(hex)}
 *   open      : reads JSONL {senderPub(b58), recipientSecret(hex), nonce(b64), ct(b64)}
 *               from the TS side (which sealed), prints opened plaintext hex per line
 */
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

public final class SealInterop {
    public static void main(String[] args) throws Exception {
        if (args.length >= 1 && args[0].equals("selfgen")) {
            selfgen(Integer.parseInt(args[1]));
        } else if (args.length >= 1 && args[0].equals("open")) {
            open();
        } else {
            System.err.println("usage: SealInterop selfgen N | open");
            System.exit(2);
        }
    }

    static void selfgen(int n) {
        SecureRandom rng = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            Object[] sender = Box.generateKeyPair();
            Object[] recipient = Box.generateKeyPair();
            byte[] senderSec = (byte[]) sender[0];
            String senderPub = (String) sender[1];
            byte[] recipientSec = (byte[]) recipient[0];
            String recipientPub = (String) recipient[1];

            int mlen = rng.nextInt(2048);
            byte[] m = new byte[mlen];
            rng.nextBytes(m);
            String plaintext = new String(m, StandardCharsets.UTF_8);
            byte[] mUtf8 = plaintext.getBytes(StandardCharsets.UTF_8);

            Box.Sealed sealed = Box.sealForRecipient(plaintext, recipientPub, senderSec);
            sb.append("{\"senderPub\":\"").append(senderPub)
              .append("\",\"recipientSecret\":\"").append(hx(recipientSec))
              .append("\",\"nonce\":\"").append(sealed.nonce)
              .append("\",\"ct\":\"").append(sealed.ciphertext)
              .append("\",\"plain\":\"").append(hx(mUtf8)).append("\"}\n");
        }
        System.out.print(sb);
    }

    static void open() throws Exception {
        var br = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            if (line.isBlank()) continue;
            String senderPub = jstr(line, "senderPub");
            String recipientSecret = jstr(line, "recipientSecret");
            String nonce = jstr(line, "nonce");
            String ct = jstr(line, "ct");
            String plain = Box.openFromSender(ct, nonce, senderPub, unhex(recipientSecret));
            if (plain == null) {
                out.append("FAIL\n");
            } else {
                out.append(hx(plain.getBytes(StandardCharsets.UTF_8))).append("\n");
            }
        }
        System.out.print(out);
    }

    static String hx(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }

    static byte[] unhex(String s) {
        byte[] b = new byte[s.length() / 2];
        for (int i = 0; i < b.length; i++)
            b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        return b;
    }

    static String jstr(String line, String key) {
        int k = line.indexOf("\"" + key + "\"");
        int c = line.indexOf(':', k);
        int q1 = line.indexOf('"', c);
        int q2 = line.indexOf('"', q1 + 1);
        return line.substring(q1 + 1, q2);
    }
}
