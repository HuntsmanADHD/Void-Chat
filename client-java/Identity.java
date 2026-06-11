/*
 * Identity.java — the client's long-lived cryptographic identity: an
 * Ed25519 signing keypair (announces, message/join sigs) and an X25519 box
 * keypair (message seal). Persisted to a JSON file so a restart is the same
 * person, not a new one.
 *
 * At rest the file is either plaintext JSON (v1, owner-only 0600 — parity
 * with the TS client's localStorage) or, with an OPT-IN passphrase, sealed
 * (v2): key = Argon2id(passphrase, salt, m=64MiB, t=3, p=1) → 32 bytes,
 * blob = XChaCha20-Poly1305(key, nonce24, v1-JSON). KDF params live in the
 * file so they can be raised later without breaking old files. Both
 * primitives are the stack's own verified implementations (relay-java
 * Argon2, seal-java Seal). Wrong passphrase = AEAD auth failure — reported
 * as such, never as a fresh identity.
 */
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;

public final class Identity {
    public final byte[] signSecret;   // 64 bytes (seed‖pub), tweetnacl format
    public final byte[] boxSecret;    // 32 bytes (X25519 scalar)
    public final String signPubB58;
    public final String boxPubB58;
    public volatile String displayName;

    /** When set, save() writes the sealed (v2) format. */
    private volatile char[] passphrase;

    // KDF profile for new sealed files (stored per-file; raise freely).
    private static final int KDF_M_KIB = 65536; // 64 MiB
    private static final int KDF_T = 3;
    private static final int KDF_P = 1;
    private static final int SALT_LEN = 16;
    private static final String ENC_SCHEME = "argon2id+xchacha20poly1305";
    private static final SecureRandom RNG = new SecureRandom();

    /** Supplies a passphrase when an encrypted identity is loaded. */
    public interface PassphraseProvider {
        /** retry=true means the previous attempt failed to decrypt. Return null to abort. */
        char[] get(boolean retry);
    }

    private Identity(byte[] signSecret, byte[] boxSecret, String displayName) {
        if (signSecret == null || signSecret.length != Ed25519Sign.SECRET_KEY_LEN)
            throw new IllegalArgumentException("signSecret must be 64 bytes");
        if (boxSecret == null || boxSecret.length != Box.SECRET_KEY_LEN)
            throw new IllegalArgumentException("boxSecret must be 32 bytes");
        this.signSecret = signSecret;
        this.boxSecret = boxSecret;
        this.displayName = displayName == null || displayName.isBlank() ? "anon" : displayName;
        this.signPubB58 = Base58.encode(Ed25519Sign.publicKeyFromSecret(signSecret));
        this.boxPubB58 = Box.publicKeyFromSecret(boxSecret);
    }

    /** A fresh random identity (not persisted). */
    public static Identity generate(String displayName) {
        byte[][] sign = Ed25519Sign.keyPair();
        Object[] box = Box.generateKeyPair();
        return new Identity(sign[0], (byte[]) box[0], displayName);
    }

    /**
     * Load the identity from `file`, or create + persist a fresh one if the
     * file doesn't exist. A corrupt/unreadable existing file is a hard error
     * (we never silently discard an identity — that would orphan a peer's
     * verified bindings and message history). An ENCRYPTED file is also a
     * hard error on this path — use the PassphraseProvider overload.
     */
    public static Identity loadOrCreate(Path file, String defaultName) throws IOException {
        return loadOrCreate(file, defaultName, null);
    }

    /**
     * As loadOrCreate, but able to open sealed (v2) files: `provider` is
     * asked for the passphrase only when the file is encrypted, and re-asked
     * (retry=true) after a failed decrypt. Provider returning null aborts.
     * The env var VOIDCHAT_ID_PASSPHRASE is honored first (headless use).
     */
    public static Identity loadOrCreate(Path file, String defaultName,
            PassphraseProvider provider) throws IOException {
        if (!Files.exists(file)) {
            Identity id = generate(defaultName);
            id.save(file);
            return id;
        }
        Map<String, Object> root = Json.asObj(Json.parse(Files.readString(file, StandardCharsets.UTF_8)));
        if (root == null)
            throw new IOException("identity file is not a JSON object");
        if (root.get("enc") == null)
            return fromPlainJson(root);

        // Sealed file.
        String env = System.getenv("VOIDCHAT_ID_PASSPHRASE");
        if (env != null && !env.isEmpty()) {
            Identity id = openSealed(root, env.toCharArray());
            if (id != null) return id;
            // env passphrase wrong → fall through to the provider, if any
        }
        if (provider == null)
            throw new IOException("identity file is passphrase-encrypted"
                    + (env != null ? " (VOIDCHAT_ID_PASSPHRASE did not decrypt it)" : ""));
        boolean retry = env != null && !env.isEmpty();
        for (;;) {
            char[] pw = provider.get(retry);
            if (pw == null)
                throw new IOException("identity unlock aborted");
            Identity id = openSealed(root, pw);
            if (id != null) return id;
            retry = true;
        }
    }

    /** True if the file exists and is in the sealed (v2) format. */
    public static boolean isEncrypted(Path file) {
        try {
            if (!Files.exists(file)) return false;
            Map<String, Object> root = Json.asObj(Json.parse(Files.readString(file, StandardCharsets.UTF_8)));
            return root != null && root.get("enc") != null;
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }

    static Identity load(Path file) throws IOException {
        Map<String, Object> root = Json.asObj(Json.parse(Files.readString(file, StandardCharsets.UTF_8)));
        if (root == null)
            throw new IOException("identity file is not a JSON object");
        if (root.get("enc") != null)
            throw new IOException("identity file is passphrase-encrypted");
        return fromPlainJson(root);
    }

    private static Identity fromPlainJson(Map<String, Object> root) throws IOException {
        byte[] signSecret = Base58.decode(reqStr(root, "signSecret"));
        byte[] boxSecret = Base58.decode(reqStr(root, "boxSecret"));
        if (signSecret == null || boxSecret == null)
            throw new IOException("identity file has malformed keys");
        return new Identity(signSecret, boxSecret, Json.str(root, "displayName"));
    }

    /** Decrypt a sealed root with `pw`. Returns null on wrong passphrase. */
    private static Identity openSealed(Map<String, Object> root, char[] pw) throws IOException {
        if (!ENC_SCHEME.equals(Json.str(root, "enc")))
            throw new IOException("unknown identity encryption scheme: " + Json.str(root, "enc"));
        Map<String, Object> kdf = Json.asObj(root.get("kdf"));
        Long m = kdf == null ? null : Json.integer(kdf, "m");
        Long t = kdf == null ? null : Json.integer(kdf, "t");
        Long p = kdf == null ? null : Json.integer(kdf, "p");
        byte[] salt = b64dec(reqStr(root, "salt"));
        byte[] nonce = b64dec(reqStr(root, "nonce"));
        byte[] ct = b64dec(reqStr(root, "ct"));
        if (m == null || t == null || p == null || salt == null || nonce == null || ct == null)
            throw new IOException("sealed identity file is malformed");
        byte[] key = deriveKey(pw, salt, m.intValue(), t.intValue(), p.intValue());
        try {
            byte[] plain = Seal.xaeadOpen(key, nonce, ct, new byte[0]);
            if (plain == null)
                return null; // AEAD auth failure = wrong passphrase
            Map<String, Object> inner = Json.asObj(Json.parse(new String(plain, StandardCharsets.UTF_8)));
            Arrays.fill(plain, (byte) 0);
            if (inner == null)
                throw new IOException("sealed identity payload is not JSON");
            Identity id = fromPlainJson(inner);
            id.passphrase = pw.clone(); // keep sealed on subsequent saves
            return id;
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(pw, '\0');
        }
    }

    private static byte[] deriveKey(char[] pw, byte[] salt, int mKiB, int tCost, int lanes) {
        byte[] pwBytes = new String(pw).getBytes(StandardCharsets.UTF_8);
        try {
            return Argon2.compute(Argon2.VARIANT_ID, Argon2.VERSION_13,
                    pwBytes, salt, new byte[0], new byte[0], tCost, mKiB, lanes, 32);
        } finally {
            Arrays.fill(pwBytes, (byte) 0);
        }
    }

    /**
     * Turn encryption on (or change the passphrase) and re-save; null turns
     * it off and re-saves plaintext.
     */
    public void setPassphrase(char[] pw, Path file) throws IOException {
        this.passphrase = pw == null ? null : pw.clone();
        save(file);
    }

    public boolean hasPassphrase() {
        return passphrase != null;
    }

    /** Persist atomically (temp + move) with owner-only permissions. */
    public void save(Path file) throws IOException {
        Path parent = file.getParent();
        if (parent != null)
            Files.createDirectories(parent);
        String json = Json.write(Json.obj(
            "version", 1L,
            "displayName", displayName,
            "signSecret", Base58.encode(signSecret),
            "signPublic", signPubB58,
            "boxSecret", Base58.encode(boxSecret),
            "boxPublic", boxPubB58));
        char[] pw = passphrase;
        if (pw != null)
            json = sealJson(json, pw);
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.writeString(tmp, json, StandardCharsets.UTF_8);
        tightenPermissions(tmp);
        try {
            Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        }
        tightenPermissions(file);
    }

    private static void tightenPermissions(Path p) {
        try {
            Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException | IOException ignored) {
            // non-POSIX filesystem (e.g. Windows) — best effort
        }
    }

    /** Wrap the v1 plaintext JSON in the sealed (v2) envelope. */
    private static String sealJson(String plainJson, char[] pw) {
        byte[] salt = new byte[SALT_LEN];
        RNG.nextBytes(salt);
        byte[] nonce = new byte[24];
        RNG.nextBytes(nonce);
        byte[] key = deriveKey(pw, salt, KDF_M_KIB, KDF_T, KDF_P);
        byte[] plain = plainJson.getBytes(StandardCharsets.UTF_8);
        try {
            byte[] ct = Seal.xaeadSeal(key, nonce, plain, new byte[0]);
            return Json.write(Json.obj(
                "version", 2L,
                "enc", ENC_SCHEME,
                "kdf", Json.obj("m", (long) KDF_M_KIB, "t", (long) KDF_T, "p", (long) KDF_P),
                "salt", b64enc(salt),
                "nonce", b64enc(nonce),
                "ct", b64enc(ct)));
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(plain, (byte) 0);
        }
    }

    private static String b64enc(byte[] b) {
        return Base64.getEncoder().encodeToString(b);
    }

    private static byte[] b64dec(String s) {
        try {
            return Base64.getDecoder().decode(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String reqStr(Map<String, Object> o, String key) throws IOException {
        String v = Json.str(o, key);
        if (v == null)
            throw new IOException("identity file missing field: " + key);
        return v;
    }

    /** Default identity file location: ~/.voidchat/identity.json */
    public static Path defaultPath() {
        return Path.of(System.getProperty("user.home"), ".voidchat", "identity.json");
    }
}
