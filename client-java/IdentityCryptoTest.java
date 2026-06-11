/*
 * IdentityCryptoTest.java — sealed identity file (v2): round-trip, key
 * stability across the encrypt/decrypt cycle, wrong-passphrase retry,
 * no-plaintext-on-disk, passphrase removal, tamper rejection, and the
 * plaintext-path guard rails.
 *
 * Run (from project root):
 *   javac -cp relay-java/out:seal-java/out -d client-java/out client-java/*.java
 *   java -cp relay-java/out:seal-java/out:client-java/out IdentityCryptoTest
 */
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;

public final class IdentityCryptoTest {
    static int passed = 0, failed = 0;
    static void check(boolean c, String name) {
        if (c) passed++; else { failed++; System.err.println("FAIL: " + name); }
    }

    static Identity.PassphraseProvider fixed(String pw) {
        return retry -> pw.toCharArray();
    }

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("vc-id-crypto");
        Path file = dir.resolve("identity.json");

        // ── Plaintext baseline ─────────────────────────────────────────
        Identity id = Identity.loadOrCreate(file, "Alice");
        check(!Identity.isEncrypted(file), "fresh identity is plaintext");
        String signPub = id.signPubB58, boxPub = id.boxPubB58;

        // ── Encrypt ────────────────────────────────────────────────────
        id.setPassphrase("correct horse".toCharArray(), file);
        check(Identity.isEncrypted(file), "file flips to sealed format");
        String raw = Files.readString(file);
        check(!raw.contains(Base58.encode(id.signSecret)), "sign secret not in file");
        check(!raw.contains(Base58.encode(id.boxSecret)), "box secret not in file");
        check(!raw.contains("Alice"), "display name not in plaintext");
        check(raw.contains("argon2id+xchacha20poly1305"), "scheme + KDF params recorded");

        // ── Decrypt with the right passphrase ─────────────────────────
        Identity back = Identity.loadOrCreate(file, "ignored", fixed("correct horse"));
        check(signPub.equals(back.signPubB58) && boxPub.equals(back.boxPubB58),
            "decrypt restores the same keys");
        check("Alice".equals(back.displayName), "display name survives");
        check(back.hasPassphrase(), "loaded identity remembers it's encrypted");

        // Saving the loaded identity keeps it sealed (no silent downgrade).
        back.displayName = "Alice2";
        back.save(file);
        check(Identity.isEncrypted(file), "re-save stays sealed");

        // ── Wrong passphrase: retried, then succeeds ───────────────────
        AtomicInteger calls = new AtomicInteger();
        Identity retried = Identity.loadOrCreate(file, "ignored", retry -> {
            int n = calls.incrementAndGet();
            check(n == 1 ? !retry : retry, "retry flag correct on attempt " + n);
            return (n == 1 ? "wrong" : "correct horse").toCharArray();
        });
        check(calls.get() == 2, "wrong passphrase triggers exactly one retry");
        check(signPub.equals(retried.signPubB58), "second attempt unlocks");

        // ── Guard rails ────────────────────────────────────────────────
        boolean threw = false;
        try { Identity.loadOrCreate(file, "x"); } catch (Exception e) { threw = true; }
        check(threw, "encrypted file without a provider is a hard error, not a fresh identity");

        // Provider aborting (null) is a hard error too.
        threw = false;
        try { Identity.loadOrCreate(file, "x", retry -> null); } catch (Exception e) { threw = true; }
        check(threw, "aborted unlock is a hard error");

        // ── Tamper: flip a ciphertext byte → unlock must fail ──────────
        Path tampered = dir.resolve("tampered.json");
        String json = Files.readString(file);
        int ctIdx = json.indexOf("\"ct\":\"") + 10;
        char c = json.charAt(ctIdx);
        Files.writeString(tampered, json.substring(0, ctIdx)
                + (c == 'A' ? 'B' : 'A') + json.substring(ctIdx + 1));
        threw = false;
        AtomicInteger tamperCalls = new AtomicInteger();
        try {
            Identity.loadOrCreate(tampered, "x", retry ->
                tamperCalls.incrementAndGet() == 1 ? "correct horse".toCharArray() : null);
        } catch (Exception e) { threw = true; }
        check(threw, "tampered ciphertext never decrypts");

        // ── Remove passphrase → plaintext again ────────────────────────
        retried.setPassphrase(null, file);
        check(!Identity.isEncrypted(file), "passphrase removal restores plaintext");
        Identity plain = Identity.loadOrCreate(file, "x");
        check(signPub.equals(plain.signPubB58), "keys intact after removal");

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
