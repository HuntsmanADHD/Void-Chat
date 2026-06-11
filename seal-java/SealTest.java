/*
 * SealTest.java — vectors + libsodium cross-verification for the seal module.
 *
 * Self-contained checks (RFC/draft fixed vectors) run always. The libsodium
 * cross-checks run when fed oracle data on stdin / via files written by
 * oracle.py; the harness script runseal.sh wires them together.
 *
 * Run standalone: java -cp out SealTest            (fixed vectors only)
 * Full:           ./runseal.sh                       (adds libsodium oracle)
 */
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

public final class SealTest {
    static int passed = 0, failed = 0;

    static void check(boolean cond, String name) {
        if (cond) passed++;
        else { failed++; System.err.println("FAIL: " + name); }
    }

    static byte[] hex(String s) {
        byte[] b = new byte[s.length() / 2];
        for (int i = 0; i < b.length; i++)
            b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        return b;
    }

    static String hx(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }

    public static void main(String[] args) throws Exception {
        fixedVectors();
        if (args.length > 0 && args[0].equals("oracle"))
            oracleChecks();
        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }

    static void fixedVectors() {
        // ── ChaCha20 keystream — RFC 8439 §2.4.2 ──────────────────────
        {
            byte[] key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
            byte[] nonce = hex("000000000000004a00000000");
            byte[] zero = new byte[114];
            byte[] ks = Seal.chacha20(key, nonce, 1, zero);
            String expect = "224f51f3401bd9e12fde276fb8631ded8c131f823d2c06"
                + "e27e4fcaec9ef3cf788a3b0aa372600a92b57974cded2b9334794cb"
                + "a40c63e34cdea212c4cf07d41b769a6749f3f630f4122cafe28ec4dc47e26d4346d70b98c73f3e9c53ac40c5945398b6eda1a832c89c167eacd901d7e2bf363";
            check(hx(ks).equals(expect), "ChaCha20 RFC 8439 §2.4.2 keystream");
        }
        // ── Poly1305 — RFC 8439 §2.5.2 ────────────────────────────────
        {
            byte[] key = hex("85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b");
            byte[] msg = "Cryptographic Forum Research Group".getBytes(StandardCharsets.UTF_8);
            check(hx(Seal.poly1305(msg, key)).equals("a8061dc1305136c6c22b8baf0c0127a9"),
                "Poly1305 RFC 8439 §2.5.2 tag");
        }
        // ── ChaCha20-Poly1305 AEAD — RFC 8439 §2.8.2 ──────────────────
        {
            byte[] key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
            byte[] nonce = hex("070000004041424344454647");
            byte[] aad = hex("50515253c0c1c2c3c4c5c6c7");
            byte[] pt = "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.".getBytes(StandardCharsets.UTF_8);
            byte[] sealed = Seal.aeadSeal(key, nonce, pt, aad);
            String expectCt = "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6"
                + "3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116";
            String expectTag = "1ae10b594f09e26a7e902ecbd0600691";
            check(hx(sealed).equals(expectCt + expectTag), "ChaCha20-Poly1305 RFC 8439 §2.8.2 seal");
            byte[] opened = Seal.aeadOpen(key, nonce, sealed, aad);
            check(opened != null && Arrays.equals(opened, pt), "ChaCha20-Poly1305 open round-trip");
            // tamper
            byte[] bad = sealed.clone();
            bad[0] ^= 1;
            check(Seal.aeadOpen(key, nonce, bad, aad) == null, "AEAD rejects tampered ciphertext");
        }
        // ── HChaCha20 — draft-irtf-cfrg-xchacha §2.2.1 ────────────────
        {
            byte[] key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
            byte[] in16 = hex("000000090000004a0000000031415927");
            check(hx(Seal.hchacha20(key, in16)).equals(
                "82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc"),
                "HChaCha20 draft vector");
        }
        // ── XChaCha20-Poly1305 round-trip + tamper ────────────────────
        {
            byte[] key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
            byte[] nonce24 = hex("404142434445464748494a4b4c4d4e4f5051525354555657");
            byte[] pt = "the quick brown fox".getBytes(StandardCharsets.UTF_8);
            byte[] sealed = Seal.xaeadSeal(key, nonce24, pt, new byte[0]);
            byte[] opened = Seal.xaeadOpen(key, nonce24, sealed, new byte[0]);
            check(opened != null && Arrays.equals(opened, pt), "XChaCha20-Poly1305 round-trip");
            byte[] bad = sealed.clone(); bad[bad.length - 1] ^= 1;
            check(Seal.xaeadOpen(key, nonce24, bad, new byte[0]) == null, "XChaCha tamper rejected");
        }
        // ── Box round-trip (Java↔Java) ────────────────────────────────
        {
            Object[] alice = Box.generateKeyPair();
            Object[] bob = Box.generateKeyPair();
            byte[] aliceSec = (byte[]) alice[0]; String alicePub = (String) alice[1];
            byte[] bobSec = (byte[]) bob[0]; String bobPub = (String) bob[1];
            Box.Sealed s = Box.sealForRecipient("hello bob 😀", bobPub, aliceSec);
            check(s != null, "box seal succeeds");
            String opened = Box.openFromSender(s.ciphertext, s.nonce, alicePub, bobSec);
            check("hello bob 😀".equals(opened), "box round-trip (emoji)");
            // wrong recipient fails
            Object[] eve = Box.generateKeyPair();
            check(Box.openFromSender(s.ciphertext, s.nonce, alicePub, (byte[]) eve[0]) == null,
                "box rejects wrong recipient");
            // tampered ciphertext fails
            String tampered = flipB64(s.ciphertext);
            check(Box.openFromSender(tampered, s.nonce, alicePub, bobSec) == null,
                "box rejects tampered ciphertext");
            // oversized plaintext rejected
            check(Box.sealForRecipient("x".repeat(70000), bobPub, aliceSec) == null,
                "box rejects oversized plaintext");
            // malformed recipient key rejected
            check(Box.sealForRecipient("hi", "not-base58-!!!", aliceSec) == null,
                "box rejects malformed recipient key");
        }
    }

    static String flipB64(String b64) {
        byte[] raw = java.util.Base64.getDecoder().decode(b64);
        raw[0] ^= 1;
        return java.util.Base64.getEncoder().encodeToString(raw);
    }

    // ── libsodium cross-checks (driven by oracle.py via runseal.sh) ───

    static void oracleChecks() throws Exception {
        // 1. primitive vectors from libsodium
        if (Files.exists(Path.of("/tmp/seal_prims.json"))) {
            String j = Files.readString(Path.of("/tmp/seal_prims.json"));
            // crude field extraction (avoid depending on a JSON parser here)
            String hKey = field(j, "hchacha20", "key");
            String hIn = field(j, "hchacha20", "in");
            String hOut = field(j, "hchacha20", "out");
            check(hx(Seal.hchacha20(hex(hKey), hex(hIn))).equals(hOut), "HChaCha20 vs libsodium");

            String xk = field(j, "xaead", "key"), xn = field(j, "xaead", "nonce"),
                   xa = field(j, "xaead", "aad"), xm = field(j, "xaead", "m"), xc = field(j, "xaead", "ct");
            check(hx(Seal.xaeadSeal(hex(xk), hex(xn), hex(xm), hex(xa))).equals(xc),
                "XChaCha20-Poly1305 seal vs libsodium");
            check(Arrays.equals(Seal.xaeadOpen(hex(xk), hex(xn), hex(xc), hex(xa)), hex(xm)),
                "XChaCha20-Poly1305 open vs libsodium");

            String ssk = field(j, "scalarmult", "sk"), spk = field(j, "scalarmult", "pk"),
                   sh = field(j, "scalarmult", "shared");
            check(hx(Box.x25519(hex(ssk), hex(spk))).equals(sh), "X25519 scalarmult vs libsodium");
            String bsk = field(j, "scalarmult_base", "sk"), bpub = field(j, "scalarmult_base", "pub");
            check(Box.publicKeyFromSecret(hex(bsk)).equals(Base58.encode(hex(bpub))),
                "X25519 base mult vs libsodium");
        }
        // 2. full box: libsodium sealed N cases, Java opens them
        if (Files.exists(Path.of("/tmp/seal_selfgen.jsonl"))) {
            List<String> lines = Files.readAllLines(Path.of("/tmp/seal_selfgen.jsonl"));
            int ok = 0;
            for (String line : lines) {
                if (line.isBlank()) continue;
                String senderPub = jstr(line, "senderPub");
                String recSec = jstr(line, "recipientSecret");
                String nonce = jstr(line, "nonce");
                String ct = jstr(line, "ct");
                String plain = jstr(line, "plain");
                String ctB64 = java.util.Base64.getEncoder().encodeToString(hex(ct));
                String nB64 = java.util.Base64.getEncoder().encodeToString(hex(nonce));
                String got = Box.openFromSender(ctB64, nB64, Base58.encode(hex(senderPub)), hex(recSec));
                String wantUtf8 = new String(hex(plain), StandardCharsets.UTF_8);
                if (got != null && got.equals(wantUtf8)) ok++;
            }
            check(ok == lines.stream().filter(l -> !l.isBlank()).count(),
                "Java opens all libsodium-sealed boxes (" + ok + "/" + lines.size() + ")");
        }
        // 3. reverse direction (Java seals → libsodium opens) is checked in
        //    runseal.sh by piping Java output to oracle.py 'open'.
    }

    // minimal hex-field extractors for the oracle JSON (values are hex strings)
    static String field(String json, String obj, String key) {
        int o = json.indexOf("\"" + obj + "\"");
        int k = json.indexOf("\"" + key + "\"", o);
        int c = json.indexOf(':', k);
        int q1 = json.indexOf('"', c);
        int q2 = json.indexOf('"', q1 + 1);
        return json.substring(q1 + 1, q2);
    }

    static String jstr(String line, String key) {
        int k = line.indexOf("\"" + key + "\"");
        int c = line.indexOf(':', k);
        int q1 = line.indexOf('"', c);
        int q2 = line.indexOf('"', q1 + 1);
        return line.substring(q1 + 1, q2);
    }
}
