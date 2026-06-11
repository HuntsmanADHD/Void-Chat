/*
 * Bench.java — micro-benchmarks for the paths that scale with message and
 * roster size. Not a test; prints numbers. Run before/after optimization
 * work so changes are justified by measurements, not vibes.
 *
 * Run (from project root):
 *   java -cp relay-java/out:seal-java/out:client-java/out Bench
 */
import java.util.ArrayList;
import java.util.List;

public final class Bench {
    public static void main(String[] args) {
        // identities
        Identity alice = Identity.generate("Alice");
        List<Identity> roster = new ArrayList<>();
        for (int i = 0; i < 50; i++) roster.add(Identity.generate("m" + i));
        String msg = "a 100-byte-ish message body to look like real chat traffic — hello hello hello hello hello!!";

        // warmup
        for (int i = 0; i < 200; i++) {
            Box.Sealed s = Box.sealForRecipient(msg, roster.get(i % 50).boxPubB58, alice.boxSecret);
            Box.openFromSender(s.ciphertext, s.nonce, alice.boxPubB58, roster.get(i % 50).boxSecret);
        }

        // ── seal to ONE recipient (repeated peer — the cacheable case) ──
        int n = 2000;
        String oneRecipient = roster.get(0).boxPubB58;
        long t0 = System.nanoTime();
        for (int i = 0; i < n; i++)
            Box.sealForRecipient(msg, oneRecipient, alice.boxSecret);
        long sealOne = System.nanoTime() - t0;
        System.out.printf("seal, same peer:        %,7.0f ops/s%n", n / (sealOne / 1e9));

        // ── 50-member channel fan-out × 40 messages ─────────────────────
        int rounds = 40;
        t0 = System.nanoTime();
        for (int r = 0; r < rounds; r++)
            for (Identity m : roster)
                Box.sealForRecipient(msg, m.boxPubB58, alice.boxSecret);
        long fanout = System.nanoTime() - t0;
        System.out.printf("channel send, 50 peers: %,7.1f sends/s (%,d seals/s)%n",
                rounds / (fanout / 1e9), (long) (rounds * 50 / (fanout / 1e9)));

        // ── open (receive path) ─────────────────────────────────────────
        Box.Sealed sealed = Box.sealForRecipient(msg, oneRecipient, alice.boxSecret);
        t0 = System.nanoTime();
        for (int i = 0; i < n; i++)
            Box.openFromSender(sealed.ciphertext, sealed.nonce, alice.boxPubB58, roster.get(0).boxSecret);
        long open = System.nanoTime() - t0;
        System.out.printf("open, same peer:        %,7.0f ops/s%n", n / (open / 1e9));

        // ── JSON frame parse+write (wire hot path) ─────────────────────
        String frame = "{\"t\":\"channel:message\",\"d\":{\"channelId\":\"abc123\",\"senderBoxPublicKey\":\""
                + oneRecipient + "\",\"ciphertext\":\"" + sealed.ciphertext
                + "\",\"nonce\":\"" + sealed.nonce + "\",\"msgId\":\"0123456789abcdef\",\"ts\":1760000000000}}";
        int jn = 20000;
        t0 = System.nanoTime();
        for (int i = 0; i < jn; i++)
            Json.write(Json.parse(frame));
        long json = System.nanoTime() - t0;
        System.out.printf("json parse+write:       %,7.0f frames/s%n", jn / (json / 1e9));
    }
}
