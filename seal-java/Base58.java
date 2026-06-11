/*
 * Base58.java — Bitcoin-alphabet base58, matching the `bs58` crate and the
 * `@scure/base` client. Used for IDs, keys, signatures, delete-tokens.
 * Zero dependencies.
 */
import java.util.Arrays;

public final class Base58 {
    private Base58() {}

    private static final char[] ALPHABET =
            "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".toCharArray();
    private static final int[] INDEXES = new int[128];
    static {
        Arrays.fill(INDEXES, -1);
        for (int i = 0; i < ALPHABET.length; i++)
            INDEXES[ALPHABET[i]] = i;
    }

    public static String encode(byte[] input) {
        if (input.length == 0)
            return "";
        // count leading zero bytes — they encode as leading '1's
        int zeros = 0;
        while (zeros < input.length && input[zeros] == 0)
            zeros++;
        // big-number division in base 256 → base 58
        byte[] num = Arrays.copyOf(input, input.length);
        char[] out = new char[input.length * 2]; // log(256)/log(58) ≈ 1.37, 2 is safe
        int outPos = out.length;
        int start = zeros;
        while (start < num.length) {
            int rem = 0;
            for (int i = start; i < num.length; i++) {
                int digit = (num[i] & 0xff) + (rem << 8);
                num[i] = (byte) (digit / 58);
                rem = digit % 58;
            }
            out[--outPos] = ALPHABET[rem];
            if (num[start] == 0)
                start++;
        }
        StringBuilder b = new StringBuilder(zeros + (out.length - outPos));
        for (int i = 0; i < zeros; i++)
            b.append('1');
        b.append(out, outPos, out.length - outPos);
        return b.toString();
    }

    /** Decode; returns null on any invalid character (no exceptions on hostile input). */
    public static byte[] decode(String input) {
        if (input.isEmpty())
            return new byte[0];
        int zeros = 0;
        while (zeros < input.length() && input.charAt(zeros) == '1')
            zeros++;
        // base 58 → base 256
        byte[] digits = new byte[input.length()];
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            int d = c < 128 ? INDEXES[c] : -1;
            if (d < 0)
                return null;
            digits[i] = (byte) d;
        }
        byte[] out = new byte[input.length()]; // decoded is never longer than input
        int outPos = out.length;
        int start = zeros;
        while (start < digits.length) {
            int rem = 0;
            for (int i = start; i < digits.length; i++) {
                int digit = digits[i] + rem * 58;
                digits[i] = (byte) (digit / 256);
                rem = digit % 256;
            }
            out[--outPos] = (byte) rem;
            if (digits[start] == 0)
                start++;
        }
        // The division can emit extra leading zero bytes; the only zero bytes
        // that belong in the result are the `zeros` leading '1's counted above.
        while (outPos < out.length && out[outPos] == 0)
            outPos++;
        byte[] result = new byte[zeros + (out.length - outPos)];
        System.arraycopy(out, outPos, result, zeros, out.length - outPos);
        return result;
    }
}
