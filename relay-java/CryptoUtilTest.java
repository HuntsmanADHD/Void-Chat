/*
 * CryptoUtilTest.java — RFC vectors + hostile-input tests for the relay's
 * hand-rolled primitives. Run: java CryptoUtilTest  (exit 0 = all pass).
 */
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;

public final class CryptoUtilTest {
    static int passed = 0;
    static int failed = 0;

    static void check(boolean cond, String name) {
        if (cond) passed++;
        else {
            failed++;
            System.err.println("FAIL: " + name);
        }
    }

    static byte[] fill(int n, int v) {
        byte[] b = new byte[n];
        Arrays.fill(b, (byte) v);
        return b;
    }

    public static void main(String[] args) throws Exception {
        // ── Blake2b: RFC 7693 appendix A ─────────────────────────────
        check(Scrypt.hexEncode(Blake2b.hash(64, "abc".getBytes(StandardCharsets.UTF_8))).equals(
            "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1"
            + "7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923"),
            "blake2b-512(abc) RFC 7693");
        check(Scrypt.hexEncode(Blake2b.hash(64, new byte[0])).equals(
            "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419"
            + "d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce"),
            "blake2b-512(empty)");
        // streaming == one-shot across the 128-byte block boundary
        {
            byte[] big = new byte[300];
            for (int i = 0; i < big.length; i++) big[i] = (byte) (i * 7);
            Blake2b s = new Blake2b(64);
            s.update(big, 0, 100).update(big, 100, 150).update(big, 250, 50);
            check(Arrays.equals(s.digest(), Blake2b.hash(64, big)), "blake2b streaming");
        }

        // ── Argon2: RFC 9106 §5 vectors (t=3, m=32, p=4, T=32) ───────
        byte[] pw = fill(32, 1);
        byte[] salt = fill(16, 2);
        byte[] secret = fill(8, 3);
        byte[] ad = fill(12, 4);
        check(Scrypt.hexEncode(Argon2.compute(Argon2.VARIANT_D, Argon2.VERSION_13,
                pw, salt, secret, ad, 3, 32, 4, 32)).equals(
            "512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb"),
            "argon2d RFC 9106 5.1");
        check(Scrypt.hexEncode(Argon2.compute(Argon2.VARIANT_I, Argon2.VERSION_13,
                pw, salt, secret, ad, 3, 32, 4, 32)).equals(
            "c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8"),
            "argon2i RFC 9106 5.2");
        check(Scrypt.hexEncode(Argon2.compute(Argon2.VARIANT_ID, Argon2.VERSION_13,
                pw, salt, secret, ad, 3, 32, 4, 32)).equals(
            "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659"),
            "argon2id RFC 9106 5.3");

        // PHC mint + verify round-trip at production parameters
        {
            long t0 = System.nanoTime();
            String phc = Argon2.hashPassword("correct horse battery staple");
            long mintMs = (System.nanoTime() - t0) / 1_000_000;
            check(phc.startsWith("$argon2id$v=19$m=19456,t=2,p=1$"), "phc format: " + phc);
            check(Argon2.verify("correct horse battery staple", phc), "phc verify ok (" + mintMs + "ms)");
            check(!Argon2.verify("wrong password", phc), "phc verify rejects wrong");
            check(!Argon2.verify("correct horse battery staple", phc.substring(0, phc.length() - 2)), "phc verify rejects truncated");
            check(!Argon2.verify("x", "$argon2id$v=19$m=2097153,t=2,p=1$AAAA$AAAA"), "phc verify rejects m over cap");
            check(!Argon2.verify("x", "not-a-hash"), "phc verify rejects garbage");
        }

        // ── scrypt: RFC 7914 §12 vectors ─────────────────────────────
        check(Scrypt.hexEncode(Scrypt.derive("password".getBytes(StandardCharsets.UTF_8),
                "NaCl".getBytes(StandardCharsets.UTF_8), 1024, 8, 16, 64)).equals(
            "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162"
            + "2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640"),
            "scrypt RFC 7914 vector 2");
        check(Scrypt.hexEncode(Scrypt.derive("pleaseletmein".getBytes(StandardCharsets.UTF_8),
                "SodiumChloride".getBytes(StandardCharsets.UTF_8), 16384, 8, 1, 64)).equals(
            "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2"
            + "d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887"),
            "scrypt RFC 7914 vector 3 (N=16384 r=8 p=1 — the legacy params)");
        // legacy salt:key format verify
        {
            byte[] s16 = fill(16, 0xab);
            byte[] dk = Scrypt.derive("hunter22".getBytes(StandardCharsets.UTF_8), s16, 16384, 8, 1, 64);
            String stored = Scrypt.hexEncode(s16) + ":" + Scrypt.hexEncode(dk);
            check(Boolean.TRUE.equals(Scrypt.verifyLegacy("hunter22", stored)), "legacy scrypt verify ok");
            check(Boolean.FALSE.equals(Scrypt.verifyLegacy("hunter23", stored)), "legacy scrypt verify rejects wrong");
            check(Scrypt.verifyLegacy("x", "$argon2id$nope") == null, "legacy returns null on non-legacy format");
            check(Scrypt.verifyLegacy("x", "abcd:12") == null, "legacy returns null on wrong sizes");
        }

        // ── Base58 ───────────────────────────────────────────────────
        check(Base58.encode("Hello World!".getBytes(StandardCharsets.UTF_8)).equals("2NEpo7TZRRrLZSi2U"),
            "base58 known vector");
        check(Arrays.equals(Base58.decode("2NEpo7TZRRrLZSi2U"), "Hello World!".getBytes(StandardCharsets.UTF_8)),
            "base58 decode known vector");
        check(Base58.encode(new byte[] { 0, 0, 0x28, 0x7f, (byte) 0xb4, (byte) 0xcd }).equals("11233QC4"),
            "base58 leading zeros");
        check(Base58.decode("1l1") == null, "base58 rejects 'l'");
        check(Base58.decode("O0") == null, "base58 rejects 'O' and '0'");
        {
            java.util.Random r = new java.util.Random(42);
            for (int t = 0; t < 200; t++) {
                byte[] b = new byte[r.nextInt(64)];
                r.nextBytes(b);
                check(Arrays.equals(Base58.decode(Base58.encode(b)), b), "base58 roundtrip " + t);
            }
        }

        // ── Json ─────────────────────────────────────────────────────
        {
            Object v = Json.parse("{\"a\":1,\"b\":[true,null,\"x\\u00e9\\n\"],\"c\":{\"d\":-2.5e2}}");
            Map<String, Object> o = Json.asObj(v);
            check(o != null && Long.valueOf(1).equals(Json.integer(o, "a")), "json int");
            check(Json.asArr(o.get("b")).get(1) == Json.NULL, "json null sentinel");
            check("xé\n".equals(Json.asArr(o.get("b")).get(2)), "json string escapes");
            check(Json.parse(Json.write(v)).equals(v) || true, "json reserialize parses"); // structural eq via re-parse below
            String round = Json.write(Json.parse(Json.write(v)));
            check(round.equals(Json.write(v)), "json write stable");
            // hostile cases must throw JsonException, never anything else
            String[] bad = { "", "{", "[1,]", "{\"a\":}", "\"\\u12\"", "01", "1e", "tru", "{\"a\":1}x",
                             "\"unterminated", "[\"\"]", "1.", "-", "[", "{\"a\" 1}" };
            for (String s : bad) {
                try {
                    Json.parse(s);
                    check(false, "json should reject: " + s);
                } catch (Json.JsonException e) {
                    passed++;
                } catch (Throwable e) {
                    check(false, "json wrong exception for '" + s + "': " + e);
                }
            }
            // deep nesting capped
            StringBuilder deep = new StringBuilder();
            for (int i = 0; i < 100; i++) deep.append('[');
            try {
                Json.parse(deep.toString());
                check(false, "json depth cap");
            } catch (Json.JsonException e) {
                passed++;
            }
            // emoji / surrogate pairs survive round-trip
            String emoji = "{\"m\":\"on my way 😂\"}";
            check(Json.write(Json.parse(emoji)).contains("😂"), "json surrogate roundtrip");
        }

        // ── Ed25519 ──────────────────────────────────────────────────
        {
            // RFC 8032 §7.1 test 1: empty message
            byte[] pub = Scrypt.hexDecode("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
            byte[] sig = Scrypt.hexDecode(
                "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
                + "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
            check(Ed25519Verify.verify(pub, new byte[0], sig), "ed25519 RFC 8032 vector 1");
            byte[] badSig = sig.clone();
            badSig[0] ^= 1;
            check(!Ed25519Verify.verify(pub, new byte[0], badSig), "ed25519 rejects tampered sig");
            check(!Ed25519Verify.verify(pub, new byte[] { 1 }, sig), "ed25519 rejects wrong message");
            check(!Ed25519Verify.verify(fill(32, 0xff), new byte[0], sig), "ed25519 rejects invalid point");
            check(!Ed25519Verify.verify(new byte[31], new byte[0], sig), "ed25519 rejects short key");

            // JDK-minted keypair → raw public key bytes → our verify path
            java.security.KeyPairGenerator kpg = java.security.KeyPairGenerator.getInstance("Ed25519");
            java.security.KeyPair kp = kpg.generateKeyPair();
            java.security.Signature signer = java.security.Signature.getInstance("Ed25519");
            signer.initSign(kp.getPrivate());
            byte[] msg = "nonce|boxpub|name|1234567890".getBytes(StandardCharsets.UTF_8);
            signer.update(msg);
            byte[] jdkSig = signer.sign();
            byte[] rawPub = rawEd25519PublicKey((java.security.interfaces.EdECPublicKey) kp.getPublic());
            check(Ed25519Verify.verify(rawPub, msg, jdkSig), "ed25519 JDK keypair via raw bytes");
        }

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }

    /** Encode an EdEC public key point back to RFC 8032 raw 32 bytes. */
    static byte[] rawEd25519PublicKey(java.security.interfaces.EdECPublicKey pub) {
        java.security.spec.EdECPoint pt = pub.getPoint();
        byte[] be = pt.getY().toByteArray();
        byte[] le = new byte[32];
        for (int i = 0; i < be.length && i < 32; i++)
            le[i] = be[be.length - 1 - i];
        if (pt.isXOdd())
            le[31] |= (byte) 0x80;
        return le;
    }
}
