/*
 * SignInterop.java — bridge for the Ed25519 TS↔Java cross-impl proof
 * (scripts/ed25519-compat.mjs). Test-only.
 *
 *   sign     : stdin JSONL {secretKey(hex64), msg(hex)} → sig hex per line
 *   verify   : stdin JSONL {pub(hex32), sig(hex64), msg(hex)} → "1"/"0" per line
 *   keygen N : emit JSONL {secretKey(hex64), pub(hex32)} for the TS side
 */
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class SignInterop {
    public static void main(String[] args) throws Exception {
        switch (args.length >= 1 ? args[0] : "") {
            case "sign" -> sign();
            case "verify" -> verify();
            case "keygen" -> keygen(Integer.parseInt(args[1]));
            default -> { System.err.println("usage: SignInterop sign|verify|keygen N"); System.exit(2); }
        }
    }

    static void sign() throws Exception {
        BufferedReader br = reader();
        StringBuilder out = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            if (line.isBlank()) continue;
            byte[] sk = unhex(jstr(line, "secretKey"));
            byte[] msg = unhex(jstr(line, "msg"));
            out.append(hx(Ed25519Sign.signDetached(msg, sk))).append('\n');
        }
        System.out.print(out);
    }

    static void verify() throws Exception {
        BufferedReader br = reader();
        StringBuilder out = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            if (line.isBlank()) continue;
            byte[] pub = unhex(jstr(line, "pub"));
            byte[] sig = unhex(jstr(line, "sig"));
            byte[] msg = unhex(jstr(line, "msg"));
            out.append(Ed25519Sign.verifyDetached(msg, sig, pub) ? "1" : "0").append('\n');
        }
        System.out.print(out);
    }

    static void keygen(int n) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < n; i++) {
            byte[][] kp = Ed25519Sign.keyPair();
            out.append("{\"secretKey\":\"").append(hx(kp[0]))
               .append("\",\"pub\":\"").append(hx(kp[1])).append("\"}\n");
        }
        System.out.print(out);
    }

    static BufferedReader reader() {
        return new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
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
