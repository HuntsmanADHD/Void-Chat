/*
 * Identity.java — the client's long-lived cryptographic identity: an
 * Ed25519 signing keypair (announces, message/join sigs) and an X25519 box
 * keypair (message seal). Persisted to a JSON file so a restart is the same
 * person, not a new one.
 *
 * At-rest format is plaintext JSON with owner-only (0600) permissions —
 * parity with the TS client's localStorage. Passphrase-encrypting this file
 * (we already have Argon2 + XChaCha20-Poly1305 in the stack) is a noted
 * future hardening, not done here.
 */
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Map;

public final class Identity {
    public final byte[] signSecret;   // 64 bytes (seed‖pub), tweetnacl format
    public final byte[] boxSecret;    // 32 bytes (X25519 scalar)
    public final String signPubB58;
    public final String boxPubB58;
    public volatile String displayName;

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
     * verified bindings and message history).
     */
    public static Identity loadOrCreate(Path file, String defaultName) throws IOException {
        if (Files.exists(file))
            return load(file);
        Identity id = generate(defaultName);
        id.save(file);
        return id;
    }

    static Identity load(Path file) throws IOException {
        Map<String, Object> root = Json.asObj(Json.parse(Files.readString(file, StandardCharsets.UTF_8)));
        if (root == null)
            throw new IOException("identity file is not a JSON object");
        byte[] signSecret = Base58.decode(reqStr(root, "signSecret"));
        byte[] boxSecret = Base58.decode(reqStr(root, "boxSecret"));
        if (signSecret == null || boxSecret == null)
            throw new IOException("identity file has malformed keys");
        return new Identity(signSecret, boxSecret, Json.str(root, "displayName"));
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
