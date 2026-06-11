/*
 * LocalStoreTest.java — pins CRUD + MRU order, password cache, recent-hosts
 * LRU cap, 0600 file permissions, corrupt-file tolerance, persistence across
 * instances (restart simulation).
 *
 * Run (from project root):
 *   javac -cp relay-java/out:seal-java/out -d client-java/out client-java/*.java
 *   java -cp relay-java/out:seal-java/out:client-java/out LocalStoreTest
 */
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;

public final class LocalStoreTest {
    static int passed = 0, failed = 0;
    static void check(boolean c, String name) {
        if (c) passed++; else { failed++; System.err.println("FAIL: " + name); }
    }

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("vc-localstore");
        LocalStore s = new LocalStore(dir);

        // ── Pins ───────────────────────────────────────────────────────
        check(s.pins().isEmpty(), "starts with no pins");
        s.pin(new LocalStore.Pin("Friends", "http://aaa.onion", "c1"));
        s.pin(new LocalStore.Pin("Work", "http://bbb.onion", "c2"));
        check(s.pins().size() == 2, "two pins stored");
        check(s.pins().get(0).name.equals("Work"), "most recent pin first");
        check(s.isPinned("http://aaa.onion", "c1"), "isPinned finds entry");
        s.pin(new LocalStore.Pin("Friends2", "http://aaa.onion", "c1")); // re-pin same target
        check(s.pins().size() == 2, "re-pin replaces, not duplicates");
        check(s.pins().get(0).name.equals("Friends2"), "re-pin updates name + moves to front");
        s.unpin("http://aaa.onion", "c1");
        check(s.pins().size() == 1 && !s.isPinned("http://aaa.onion", "c1"), "unpin removes");

        // ── Password cache ─────────────────────────────────────────────
        check(s.password("c9") == null, "no password cached initially");
        s.rememberPassword("c9", "hunter2");
        check("hunter2".equals(s.password("c9")), "password cached");
        s.forgetPassword("c9");
        check(s.password("c9") == null, "password forgotten");

        // ── Recent hosts: MRU + cap 20 ─────────────────────────────────
        for (int i = 0; i < 25; i++) s.rememberHost("http://host" + i + ":3001");
        List<String> hosts = s.hosts();
        check(hosts.size() == 20, "hosts capped at 20, got " + hosts.size());
        check(hosts.get(0).equals("http://host24:3001"), "most recent host first");
        s.rememberHost("http://host10:3001"); // re-visit → moves to front, no dup
        check(s.hosts().get(0).equals("http://host10:3001"), "re-visit moves host to front");
        check(s.hosts().size() == 20, "re-visit does not duplicate");

        // ── Permissions ────────────────────────────────────────────────
        String perms = PosixFilePermissions.toString(
                Files.getPosixFilePermissions(dir.resolve("passwords.json")));
        check("rw-------".equals(perms), "passwords.json is 0600, got " + perms);

        // ── Persistence across instances ───────────────────────────────
        LocalStore s2 = new LocalStore(dir);
        check(s2.pins().size() == 1 && s2.pins().get(0).name.equals("Work"),
            "pins survive restart");
        check(s2.hosts().size() == 20, "hosts survive restart");

        // ── Corrupt file → behave as empty, don't crash ────────────────
        Files.writeString(dir.resolve("pinned.json"), "{not json!!");
        LocalStore s3 = new LocalStore(dir);
        check(s3.pins().isEmpty(), "corrupt pin file reads as empty");
        s3.pin(new LocalStore.Pin("Recovered", "http://ccc.onion", "c3"));
        check(s3.pins().size() == 1, "store recovers by rewriting");

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
