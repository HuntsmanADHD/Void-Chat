/*
 * Json.java — hand-rolled JSON parser + serializer for the Void Chat relay.
 *
 * Zero dependencies (java.base only). Replaces serde_json from the Rust
 * relay. Strict by default: rejects trailing garbage, caps nesting depth,
 * caps input size at the call site (the HTTP layer enforces body limits
 * before parse). Numbers parse as Long when integral and in range, Double
 * otherwise — the wire protocol only uses integral timestamps and ids.
 *
 * Values are represented as plain Java types:
 *   object → java.util.LinkedHashMap<String,Object>  (insertion-ordered)
 *   array  → java.util.ArrayList<Object>
 *   string → String, number → Long | Double, true/false → Boolean,
 *   null   → Json.NULL sentinel (so map.get distinguishes "absent" from
 *            "present and null", which the DTO validators need).
 */
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Json {
    private Json() {}

    /** Sentinel for a JSON null that is present in the document. */
    public static final Object NULL = new Object() {
        @Override public String toString() { return "null"; }
    };

    public static final class JsonException extends RuntimeException {
        public JsonException(String message) { super(message); }
    }

    private static final int MAX_DEPTH = 64;

    // ── Parsing ───────────────────────────────────────────────────────

    /** Parse a complete JSON document; trailing non-whitespace rejected. */
    public static Object parse(String s) {
        Parser p = new Parser(s);
        Object v = p.parseValue(0);
        p.skipWs();
        if (p.pos != s.length())
            throw new JsonException("trailing characters after JSON value");
        return v;
    }

    private static final class Parser {
        final String s;
        int pos = 0;

        Parser(String s) { this.s = s; }

        void skipWs() {
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++;
                else break;
            }
        }

        JsonException err(String msg) {
            return new JsonException(msg + " at offset " + pos);
        }

        Object parseValue(int depth) {
            if (depth > MAX_DEPTH)
                throw err("nesting too deep");
            skipWs();
            if (pos >= s.length())
                throw err("unexpected end of input");
            char c = s.charAt(pos);
            switch (c) {
                case '{': return parseObject(depth);
                case '[': return parseArray(depth);
                case '"': return parseString();
                case 't': expect("true"); return Boolean.TRUE;
                case 'f': expect("false"); return Boolean.FALSE;
                case 'n': expect("null"); return NULL;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
                    throw err("unexpected character '" + c + "'");
            }
        }

        void expect(String word) {
            if (!s.startsWith(word, pos))
                throw err("invalid literal");
            pos += word.length();
        }

        Map<String, Object> parseObject(int depth) {
            pos++; // '{'
            LinkedHashMap<String, Object> m = new LinkedHashMap<>();
            skipWs();
            if (pos < s.length() && s.charAt(pos) == '}') { pos++; return m; }
            for (;;) {
                skipWs();
                if (pos >= s.length() || s.charAt(pos) != '"')
                    throw err("expected object key");
                String key = parseString();
                skipWs();
                if (pos >= s.length() || s.charAt(pos) != ':')
                    throw err("expected ':'");
                pos++;
                Object val = parseValue(depth + 1);
                m.put(key, val); // duplicate keys: last wins (matches serde_json)
                skipWs();
                if (pos >= s.length())
                    throw err("unterminated object");
                char c = s.charAt(pos);
                if (c == ',') { pos++; continue; }
                if (c == '}') { pos++; return m; }
                throw err("expected ',' or '}'");
            }
        }

        List<Object> parseArray(int depth) {
            pos++; // '['
            ArrayList<Object> a = new ArrayList<>();
            skipWs();
            if (pos < s.length() && s.charAt(pos) == ']') { pos++; return a; }
            for (;;) {
                a.add(parseValue(depth + 1));
                skipWs();
                if (pos >= s.length())
                    throw err("unterminated array");
                char c = s.charAt(pos);
                if (c == ',') { pos++; continue; }
                if (c == ']') { pos++; return a; }
                throw err("expected ',' or ']'");
            }
        }

        String parseString() {
            pos++; // '"'
            StringBuilder b = new StringBuilder();
            for (;;) {
                if (pos >= s.length())
                    throw err("unterminated string");
                char c = s.charAt(pos++);
                if (c == '"')
                    return b.toString();
                if (c == '\\') {
                    if (pos >= s.length())
                        throw err("unterminated escape");
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"': b.append('"'); break;
                        case '\\': b.append('\\'); break;
                        case '/': b.append('/'); break;
                        case 'b': b.append('\b'); break;
                        case 'f': b.append('\f'); break;
                        case 'n': b.append('\n'); break;
                        case 'r': b.append('\r'); break;
                        case 't': b.append('\t'); break;
                        case 'u': b.append(parseHex4()); break;
                        default: throw err("invalid escape '\\" + e + "'");
                    }
                }
                else if (c < 0x20) {
                    throw err("unescaped control character");
                }
                else {
                    b.append(c);
                }
            }
        }

        char parseHex4() {
            if (pos + 4 > s.length())
                throw err("truncated \\u escape");
            int v = 0;
            for (int i = 0; i < 4; i++) {
                char c = s.charAt(pos++);
                int d;
                if (c >= '0' && c <= '9') d = c - '0';
                else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
                else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
                else throw err("invalid \\u escape");
                v = (v << 4) | d;
            }
            return (char) v;
        }

        Object parseNumber() {
            int start = pos;
            if (pos < s.length() && s.charAt(pos) == '-') pos++;
            if (pos >= s.length())
                throw err("invalid number");
            // integer part: 0 | [1-9][0-9]*
            if (s.charAt(pos) == '0') {
                pos++;
            } else if (s.charAt(pos) >= '1' && s.charAt(pos) <= '9') {
                while (pos < s.length() && isDigit(s.charAt(pos))) pos++;
            } else {
                throw err("invalid number");
            }
            boolean integral = true;
            if (pos < s.length() && s.charAt(pos) == '.') {
                integral = false;
                pos++;
                if (pos >= s.length() || !isDigit(s.charAt(pos)))
                    throw err("invalid number");
                while (pos < s.length() && isDigit(s.charAt(pos))) pos++;
            }
            if (pos < s.length() && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                integral = false;
                pos++;
                if (pos < s.length() && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) pos++;
                if (pos >= s.length() || !isDigit(s.charAt(pos)))
                    throw err("invalid number");
                while (pos < s.length() && isDigit(s.charAt(pos))) pos++;
            }
            String tok = s.substring(start, pos);
            if (integral) {
                try {
                    return Long.parseLong(tok);
                } catch (NumberFormatException e) {
                    // out of long range — fall through to double
                }
            }
            double d = Double.parseDouble(tok);
            if (!Double.isFinite(d))
                throw err("number out of range");
            return d;
        }

        static boolean isDigit(char c) { return c >= '0' && c <= '9'; }
    }

    // ── Serialization ─────────────────────────────────────────────────

    /** Serialize a value tree produced by parse() or built with obj()/arr(). */
    public static String write(Object v) {
        StringBuilder b = new StringBuilder();
        writeValue(b, v);
        return b.toString();
    }

    private static void writeValue(StringBuilder b, Object v) {
        if (v == null || v == NULL) {
            b.append("null");
        }
        else if (v instanceof String) {
            writeString(b, (String) v);
        }
        else if (v instanceof Boolean || v instanceof Long || v instanceof Integer) {
            b.append(v);
        }
        else if (v instanceof Double) {
            double d = (Double) v;
            if (!Double.isFinite(d))
                throw new JsonException("non-finite number");
            // integral doubles print without the trailing .0 JSON consumers choke on
            if (d == Math.rint(d) && Math.abs(d) < 1e15)
                b.append((long) d);
            else
                b.append(d);
        }
        else if (v instanceof Map<?, ?>) {
            b.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                if (!first) b.append(',');
                first = false;
                writeString(b, String.valueOf(e.getKey()));
                b.append(':');
                writeValue(b, e.getValue());
            }
            b.append('}');
        }
        else if (v instanceof List<?>) {
            b.append('[');
            boolean first = true;
            for (Object e : (List<?>) v) {
                if (!first) b.append(',');
                first = false;
                writeValue(b, e);
            }
            b.append(']');
        }
        else {
            throw new JsonException("unserializable type: " + v.getClass());
        }
    }

    private static void writeString(StringBuilder b, String s) {
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
            }
        }
        b.append('"');
    }

    // ── Construction + typed access helpers ───────────────────────────

    /** Build an object from alternating key/value varargs. */
    public static Map<String, Object> obj(Object... kv) {
        if (kv.length % 2 != 0)
            throw new IllegalArgumentException("obj() needs key/value pairs");
        LinkedHashMap<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2)
            m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    public static List<Object> arr(Object... items) {
        ArrayList<Object> a = new ArrayList<>(items.length);
        for (Object i : items) a.add(i);
        return a;
    }

    /** v as object map, or null if it isn't one. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> asObj(Object v) {
        return v instanceof Map<?, ?> ? (Map<String, Object>) v : null;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> asArr(Object v) {
        return v instanceof List<?> ? (List<Object>) v : null;
    }

    /** String field, or null if absent / not a string. */
    public static String str(Map<String, Object> o, String key) {
        Object v = o.get(key);
        return v instanceof String ? (String) v : null;
    }

    /** Integral field, or null if absent / not an integral number. */
    public static Long integer(Map<String, Object> o, String key) {
        Object v = o.get(key);
        if (v instanceof Long) return (Long) v;
        return null;
    }
}
