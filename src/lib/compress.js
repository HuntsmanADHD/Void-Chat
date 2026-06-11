/**
 * compress.js — zero-dependency, 100% pure-JavaScript DEFLATE/gzip codec.
 *
 * Every byte of compression logic lives in this one file. No imports, no
 * native bindings, no WASM, no platform CompressionStream — the entire
 * codec is auditable source. Type information appears only as JSDoc
 * comments; the file is plain ES2022 JavaScript.
 *
 * Wire format is standard gzip (RFC 1952) wrapping DEFLATE (RFC 1951),
 * chosen deliberately: the format is publicly specified, and our output
 * can be cross-verified bit-for-bit against independent implementations
 * (node:zlib, system gzip) in the test suite. Interop is a free bonus —
 * any future client (mobile, web, relay-side) can decode with a stock
 * inflater while this implementation remains the audited reference.
 *
 * Security properties (this module assumes hostile input on decompress):
 *  - gzipDecompress enforces maxOutputBytes (default 256 MiB) — a
 *    malicious peer cannot zip-bomb the client into OOM.
 *  - All header fields, Huffman trees, and back-references are validated;
 *    corrupt input throws CorruptDataError, never reads out of bounds,
 *    never loops forever.
 *  - CRC32 + length verified after inflate; trailing garbage rejected.
 *
 * Integration note for Void Chat: compress BEFORE sealForRecipient() —
 * encrypted bytes are indistinguishable from random and do not compress.
 * Use compressSmart() so already-compressed media (JPEG/PNG/WebP/MP4…)
 * is sent as-is instead of burning CPU for zero gain.
 */
// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class CorruptDataError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CorruptDataError';
    }
}
function corrupt(message) {
    throw new CorruptDataError(message);
}
// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) — the gzip checksum.
// ---------------------------------------------------------------------------
// Slicing-by-8: tables[k][b] = CRC of byte b followed by k zero bytes,
// letting the main loop fold 8 input bytes per iteration. Table 0 is the
// classic byte-at-a-time table (used for the tail and to derive the rest).
const CRC_TABLES = (() => {
    const t = new Int32Array(256 * 8);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
        t[n] = c;
    }
    for (let n = 0; n < 256; n++) {
        let c = t[n];
        for (let k = 1; k < 8; k++) {
            c = (c >>> 8) ^ t[c & 0xff];
            t[k * 256 + n] = c;
        }
    }
    return t;
})();
/**
 * @param {Uint8Array} data
 * @returns {number} unsigned 32-bit CRC
 */
export function crc32(data) {
    const T = CRC_TABLES;
    const n = data.length;
    let c = -1;
    let i = 0;
    const end8 = n & ~7;
    for (; i < end8; i += 8) {
        c ^= data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
        const hi = data[i + 4] | (data[i + 5] << 8) | (data[i + 6] << 16) | (data[i + 7] << 24);
        c =
            T[1792 + (c & 0xff)] ^
                T[1536 + ((c >>> 8) & 0xff)] ^
                T[1280 + ((c >>> 16) & 0xff)] ^
                T[1024 + (c >>> 24)] ^
                T[768 + (hi & 0xff)] ^
                T[512 + ((hi >>> 8) & 0xff)] ^
                T[256 + ((hi >>> 16) & 0xff)] ^
                T[hi >>> 24];
    }
    for (; i < n; i++) {
        c = T[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ -1) >>> 0;
}
// ---------------------------------------------------------------------------
// DEFLATE constant tables (RFC 1951 §3.2.5)
// ---------------------------------------------------------------------------
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const WINDOW = 32768;
const WMASK = WINDOW - 1;
// Length codes 257..285 → base length and extra bits.
const LEN_BASE = new Int32Array([
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
    83, 99, 115, 131, 163, 195, 227, 258,
]);
const LEN_EXTRA = new Int32Array([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0,
]);
// Distance codes 0..29 → base distance and extra bits.
const DIST_BASE = new Int32Array([
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
    769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
]);
const DIST_EXTRA = new Int32Array([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13,
]);
// match length (3..258) → length code index (0..28), via [len - 3].
const LEN_TO_CODE = (() => {
    const t = new Uint8Array(256);
    for (let c = 0; c < 28; c++) {
        for (let l = LEN_BASE[c]; l < LEN_BASE[c + 1]; l++)
            t[l - 3] = c;
    }
    t[258 - 3] = 28; // length 258 has its own dedicated code
    return t;
})();
// Multiplicative hashes (Knuth/Fibonacci). Two widths, libdeflate-style:
// the chain table hashes 4 bytes (selective — candidates share a 4-byte
// prefix, so chain budgets are spent on good candidates), while a
// single-entry 3-byte table catches length-3 matches with one probe.
function hash3At(d, i) {
    return (Math.imul(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16), 0x9e3779b1) >>>
        (32 - HASH_BITS));
}
function hash4At(d, i) {
    return (Math.imul(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24), 0x9e3779b1) >>> (32 - HASH4_BITS));
}
// distance (1..32768) → distance code index (0..29).
function distToCode(d) {
    if (d <= 4)
        return d - 1;
    const bits = 31 - Math.clz32(d - 1);
    return (bits << 1) + (((d - 1) >>> (bits - 1)) & 1);
}
// Order in which code-length-code lengths appear in a dynamic header.
const CL_ORDER = new Uint8Array([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
]);
// Fixed (static) Huffman code lengths, RFC 1951 §3.2.6.
const STATIC_LLENS = (() => {
    const t = new Uint8Array(288);
    t.fill(8, 0, 144);
    t.fill(9, 144, 256);
    t.fill(7, 256, 280);
    t.fill(8, 280, 288);
    return t;
})();
const STATIC_DLENS = (() => {
    const t = new Uint8Array(30);
    t.fill(5);
    return t;
})();
// ---------------------------------------------------------------------------
// Bit I/O. DEFLATE packs bits LSB-first; Huffman codes are written with
// their bits reversed (most-significant code bit arrives first).
// ---------------------------------------------------------------------------
function reverseBits(v, n) {
    let r = 0;
    for (let i = 0; i < n; i++) {
        r = (r << 1) | (v & 1);
        v >>>= 1;
    }
    return r;
}
// Reused output scratch (same single-threaded reasoning as the compressor
// scratch below); finish() hands the caller a private copy.
let S_WBUF = new Uint8Array(1 << 16);
class BitWriter {
    buf = S_WBUF;
    len = 0;
    // Invariant: bitCnt <= 7 between calls, so v << bitCnt never exceeds
    // 23 bits for v up to 16 bits — safe within JS 32-bit bitwise ops.
    bitBuf = 0;
    bitCnt = 0;
    ensure(extra) {
        if (this.len + extra <= this.buf.length)
            return;
        let cap = this.buf.length * 2;
        while (cap < this.len + extra)
            cap *= 2;
        const nb = new Uint8Array(cap);
        nb.set(this.buf.subarray(0, this.len));
        this.buf = nb;
        S_WBUF = nb; // keep the grown buffer for future calls
    }
    writeBits(v, n) {
        this.bitBuf |= v << this.bitCnt;
        this.bitCnt += n;
        while (this.bitCnt >= 8) {
            this.ensure(1);
            this.buf[this.len++] = this.bitBuf & 0xff;
            this.bitBuf >>>= 8;
            this.bitCnt -= 8;
        }
    }
    alignToByte() {
        if (this.bitCnt > 0) {
            this.ensure(1);
            this.buf[this.len++] = this.bitBuf & 0xff;
            this.bitBuf = 0;
            this.bitCnt = 0;
        }
    }
    // Byte-aligned writes only (stored blocks, gzip header/trailer).
    writeByte(b) {
        this.ensure(1);
        this.buf[this.len++] = b & 0xff;
    }
    writeBytes(src, off, n) {
        this.ensure(n);
        this.buf.set(src.subarray(off, off + n), this.len);
        this.len += n;
    }
    finish() {
        this.alignToByte();
        return this.buf.slice(0, this.len);
    }
}
class BitReader {
    // Fields are non-private so Inflater's hot loop can hoist them into
    // locals (and write them back) — the single biggest inflate speedup.
    buf;
    pos;
    end;
    // Invariant: bitBuf holds bitCnt valid bits (LSB-first); bits above
    // bitCnt are zero. bitCnt <= 31.
    bitBuf = 0;
    bitCnt = 0;
    constructor(buf, off, end) {
        this.buf = buf;
        this.pos = off;
        this.end = end;
    }
    refill() {
        while (this.bitCnt <= 23 && this.pos < this.end) {
            this.bitBuf |= this.buf[this.pos++] << this.bitCnt;
            this.bitCnt += 8;
        }
    }
    readBits(n) {
        if (this.bitCnt < n) {
            this.refill();
            if (this.bitCnt < n)
                corrupt('unexpected end of compressed data');
        }
        const v = this.bitBuf & ((1 << n) - 1);
        this.bitBuf >>>= n;
        this.bitCnt -= n;
        return v;
    }
    alignToByte() {
        const drop = this.bitCnt & 7;
        this.bitBuf >>>= drop;
        this.bitCnt -= drop;
    }
    /** Bulk byte copy; caller must be byte-aligned (stored blocks). */
    readBytes(dst, off, n) {
        let k = 0;
        while (this.bitCnt >= 8 && k < n) {
            dst[off + k++] = this.bitBuf & 0xff;
            this.bitBuf >>>= 8;
            this.bitCnt -= 8;
        }
        const rest = n - k;
        if (rest > 0) {
            if (this.end - this.pos < rest)
                corrupt('unexpected end of compressed data');
            dst.set(this.buf.subarray(this.pos, this.pos + rest), off + k);
            this.pos += rest;
        }
    }
    bitsRemaining() {
        return this.bitCnt + 8 * (this.end - this.pos);
    }
    /** Decode one Huffman symbol (canonical decode, fast-table assisted). */
    decodeSym(d) {
        this.refill();
        let e = d.fast[this.bitBuf & FAST_MASK];
        if (e <= 0)
            e = decodeSlowWalk(d, this.bitBuf);
        const l = e & 0xf;
        if (l > this.bitCnt)
            corrupt('unexpected end of compressed data');
        this.bitBuf >>>= l;
        this.bitCnt -= l;
        return e >>> 4;
    }
}
/**
 * Canonical bit-at-a-time decode for codes the 9-bit fast table misses.
 * Pure function of (tree, peeked bits): returns (symbol << 4) | length;
 * the caller verifies length against the bits actually available.
 */
function decodeSlowWalk(d, v) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
        code |= (v >>> (len - 1)) & 1;
        const count = d.counts[len];
        if (code - first < count) {
            return (d.symbols[index + (code - first)] << 4) | len;
        }
        index += count;
        first = (first + count) << 1;
        code <<= 1;
    }
    corrupt('invalid Huffman code');
}
// ---------------------------------------------------------------------------
// Canonical Huffman: building code lengths from frequencies (encoder) and
// decode tables from code lengths (decoder).
// ---------------------------------------------------------------------------
/**
 * Plain Huffman over an array-backed min-heap, then depth extraction.
 * Returns code length per symbol (0 = unused). Lengths are limited to
 * maxLen by halving frequencies and retrying — converges because with
 * all frequencies equal the tree depth is ceil(log2(n)) <= 9 < maxLen.
 */
function buildCodeLengths(freq, n, maxLen) {
    const f = freq.slice(0, n);
    for (;;) {
        const lens = huffmanLengths(f, n);
        let max = 0;
        for (let i = 0; i < n; i++)
            if (lens[i] > max)
                max = lens[i];
        if (max <= maxLen)
            return lens;
        for (let i = 0; i < n; i++)
            if (f[i] !== 0)
                f[i] = (f[i] >> 1) | 1;
    }
}
function huffmanLengths(f, n) {
    const lens = new Uint8Array(n);
    // Heap entries pack (frequency, nodeIndex) into one float-safe number;
    // index in the low bits keeps ties deterministic.
    const PACK = 1024; // > 2*288 node indices
    const heap = [];
    const push = (key) => {
        heap.push(key);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p] <= heap[i])
                break;
            const t = heap[p];
            heap[p] = heap[i];
            heap[i] = t;
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < heap.length && heap[l] < heap[m])
                    m = l;
                if (r < heap.length && heap[r] < heap[m])
                    m = r;
                if (m === i)
                    break;
                const t = heap[m];
                heap[m] = heap[i];
                heap[i] = t;
                i = m;
            }
        }
        return top;
    };
    const parent = new Int32Array(2 * n).fill(-1);
    let leaves = 0;
    let lastLeaf = -1;
    for (let i = 0; i < n; i++) {
        if (f[i] > 0) {
            leaves++;
            lastLeaf = i;
            push(f[i] * PACK + i);
        }
    }
    if (leaves === 0)
        return lens;
    if (leaves === 1) {
        lens[lastLeaf] = 1; // a lone symbol still needs one bit on the wire
        return lens;
    }
    let next = n;
    while (heap.length > 1) {
        const a = pop();
        const b = pop();
        const fa = Math.floor(a / PACK);
        const fb = Math.floor(b / PACK);
        parent[a % PACK] = next;
        parent[b % PACK] = next;
        push((fa + fb) * PACK + next);
        next++;
    }
    for (let i = 0; i < n; i++) {
        if (f[i] <= 0)
            continue;
        let d = 0;
        let p = parent[i];
        while (p !== -1) {
            d++;
            p = parent[p];
        }
        lens[i] = d;
    }
    return lens;
}
/**
 * Code lengths → canonical codes, pre-reversed for LSB-first writing.
 * Canonical rule (RFC 1951 §3.2.2): shorter codes first, ties broken by
 * symbol order — both encoder and decoder derive identical codes.
 */
function lengthsToWriteCodes(lens, n) {
    const counts = new Int32Array(16);
    for (let i = 0; i < n; i++)
        counts[lens[i]]++;
    counts[0] = 0;
    const nextCode = new Int32Array(16);
    let code = 0;
    for (let len = 1; len <= 15; len++) {
        code = (code + counts[len - 1]) << 1;
        nextCode[len] = code;
    }
    const codes = new Int32Array(n);
    for (let sym = 0; sym < n; sym++) {
        const l = lens[sym];
        if (l !== 0)
            codes[sym] = reverseBits(nextCode[l]++, l);
    }
    return codes;
}
// Fast decode table width: codes up to this many bits resolve in one
// indexed lookup; longer codes (rare) fall back to the canonical walk.
// Measured: widening to 12 bits buys nothing — 9 covers the bulk of
// real symbol mass while keeping per-block table build cost trivial.
const FAST_BITS = 9;
const FAST_SIZE = 1 << FAST_BITS;
const FAST_MASK = FAST_SIZE - 1;
// Fast-table entry layouts (one Int32 per table slot, 0 = miss):
//
// MODE_GENERIC (code-length tree): (symbol << 4) | codeLen
// MODE_LITLEN (libdeflate-style packed — the decode loop reads everything
// it needs from the entry, no further table lookups or range checks):
//   bits 0-3  codeLen, bits 4-5 kind (1=literal, 2=length, 3=end-of-block)
//   literal: bits 8-15 = byte value
//   length:  bits 8-16 = base length (3..258), bits 17-19 = extra bit count
// MODE_DIST:
//   bits 0-3 codeLen, bits 8-22 = base distance (1..24577),
//   bits 23-26 = extra bit count (0..13)
// Invalid symbols (286/287 literal, 30/31 distance) are left as misses and
// rejected by the cold path.
const MODE_GENERIC = 0;
const MODE_LITLEN = 1;
const MODE_DIST = 2;
const KIND_LITERAL = 1 << 4;
const KIND_LENGTH = 2 << 4;
const KIND_EOB = 3 << 4;
class HuffDecoder {
    /** counts[len] = number of codes of that bit length */
    counts = new Int32Array(16);
    /** symbols sorted by (code length, symbol) — canonical order */
    symbols;
    /**
     * One-level fast table over the next 9 bits (layout per mode, above).
     * Covers every symbol of the fixed trees and the vast majority of
     * dynamic-tree hits; longer codes fall back to the canonical walk.
     */
    fast = new Int32Array(1 << FAST_BITS);
    constructor(lens, n, mode) {
        for (let i = 0; i < n; i++)
            this.counts[lens[i]]++;
        this.counts[0] = 0;
        // Reject over-subscribed trees (more codes than the prefix space has
        // room for) — required for memory safety of the decode walk.
        let left = 1;
        let total = 0;
        for (let len = 1; len <= 15; len++) {
            left <<= 1;
            left -= this.counts[len];
            if (left < 0)
                corrupt('over-subscribed Huffman tree');
            total += this.counts[len];
        }
        // Incomplete trees are tolerated here; using a missing code is caught
        // at decode time. (DEFLATE explicitly allows the one-code distance
        // tree, which is incomplete by definition.)
        const offs = new Int32Array(17);
        for (let len = 1; len <= 15; len++)
            offs[len + 1] = offs[len] + this.counts[len];
        this.symbols = new Int32Array(total);
        const fill = offs.slice(0, 16);
        const nextCode = new Int32Array(16);
        let code = 0;
        for (let len = 1; len <= 15; len++) {
            code = (code + this.counts[len - 1]) << 1;
            nextCode[len] = code;
        }
        for (let sym = 0; sym < n; sym++) {
            const l = lens[sym];
            if (l === 0)
                continue;
            this.symbols[fill[l]++] = sym;
            const c = nextCode[l]++;
            if (l <= FAST_BITS) {
                const entry = packEntry(mode, sym, l);
                if (entry !== 0) {
                    for (let j = reverseBits(c, l); j < FAST_SIZE; j += 1 << l) {
                        this.fast[j] = entry;
                    }
                }
            }
        }
    }
}
function packEntry(mode, sym, l) {
    if (mode === MODE_GENERIC)
        return (sym << 4) | l;
    if (mode === MODE_LITLEN) {
        if (sym < 256)
            return l | KIND_LITERAL | (sym << 8);
        if (sym === 256)
            return l | KIND_EOB;
        if (sym <= 285) {
            const lc = sym - 257;
            return l | KIND_LENGTH | (LEN_BASE[lc] << 8) | (LEN_EXTRA[lc] << 17);
        }
        return 0; // 286/287: invalid, stays a miss
    }
    if (sym <= 29)
        return l | (DIST_BASE[sym] << 8) | (DIST_EXTRA[sym] << 23);
    return 0; // 30/31: invalid, stays a miss
}
/**
 * Cold path shared by the inflate hot loop: canonical walk for codes the
 * fast table misses (longer than FAST_BITS or invalid), returned in the
 * same packed-entry format so the hot loop continues uniformly. Validates
 * symbol range and that the code fits in the bits actually available.
 */
function coldEntry(d, mode, bitBuf, bitCnt) {
    const w = decodeSlowWalk(d, bitBuf);
    const l = w & 0xf;
    if (l > bitCnt)
        corrupt('unexpected end of compressed data');
    const sym = w >>> 4;
    const e = packEntry(mode, sym, l);
    if (e === 0)
        corrupt(mode === MODE_DIST ? 'invalid distance symbol' : 'invalid length symbol');
    return e;
}
// Fixed-tree decoders, built once. The fixed distance tree has 32 codes;
// symbols 30/31 are invalid if they ever appear (checked at use site).
let fixedLitDec = null;
let fixedDistDec = null;
function getFixedDecoders() {
    if (fixedLitDec === null) {
        fixedLitDec = new HuffDecoder(STATIC_LLENS, 288, MODE_LITLEN);
        const d = new Uint8Array(32);
        d.fill(5);
        fixedDistDec = new HuffDecoder(d, 32, MODE_DIST);
    }
    return [fixedLitDec, fixedDistDec];
}
// Fixed-tree encoder codes, built once.
const STATIC_LCODES = lengthsToWriteCodes(STATIC_LLENS, 288);
const STATIC_DCODES = lengthsToWriteCodes(STATIC_DLENS, 30);
// ---------------------------------------------------------------------------
// Compressor: LZ77 tokenizer (hash chains + lazy matching, zlib-style)
// feeding per-block stored/static/dynamic selection by exact bit cost.
// ---------------------------------------------------------------------------
const HASH_BITS = 15; // 3-byte single-entry table
const HASH_SIZE = 1 << HASH_BITS;
const HASH4_BITS = 16; // 4-byte chain table
const HASH4_SIZE = 1 << HASH4_BITS;
// Tokens per block before forcing a flush. 16K matches zlib's lit_bufsize
// at its default memLevel: smaller blocks let the Huffman tables re-adapt
// to local statistics, which measurably wins on structured/binary data
// and costs ~nothing on text (header overhead is amortized by cost-based
// block-type selection).
const TOKENS_MAX = 1 << 14;
// Tuning values mirror zlib's configuration_table — decades of empirical
// tuning on the same algorithm, no reason to relitigate them.
const LEVELS = [
    { good: 4, maxLazy: 4, nice: 8, chain: 4, lazy: false }, // 1
    { good: 4, maxLazy: 5, nice: 16, chain: 8, lazy: false }, // 2
    { good: 4, maxLazy: 6, nice: 32, chain: 32, lazy: false }, // 3
    { good: 4, maxLazy: 4, nice: 16, chain: 16, lazy: true }, // 4
    { good: 8, maxLazy: 16, nice: 32, chain: 32, lazy: true }, // 5
    { good: 8, maxLazy: 16, nice: 128, chain: 128, lazy: true }, // 6
    { good: 8, maxLazy: 32, nice: 128, chain: 256, lazy: true }, // 7
    { good: 32, maxLazy: 128, nice: 258, chain: 1024, lazy: true }, // 8
    { good: 32, maxLazy: 258, nice: 258, chain: 4096, lazy: true }, // 9
];
// Compressor scratch state, reused across calls to avoid allocating and
// zero-filling ~0.5 MiB per gzipCompress() — that fixed cost dominated
// small (chat-message-sized) payloads. Safe because JS is single-threaded
// and compression is synchronous (no reentrancy); workers each get their
// own module instance.
//
// The hash/chain tables are never cleared between calls. Instead every
// stored position is stamped with a per-call base offset (stamp =
// base + i, base >= 1, slot value 0 = empty): entries from earlier calls
// decode to a negative position and are treated as dead. Even if a stale
// entry were followed, candidates are byte-verified, so the worst case is
// wasted search time, never wrong output.
const S_HEAD4 = new Int32Array(HASH4_SIZE);
const S_HEAD3 = new Int32Array(HASH_SIZE);
const S_PREV = new Int32Array(WINDOW);
const S_TOKENS = new Int32Array(TOKENS_MAX);
const S_FREQ_LIT = new Int32Array(286);
const S_FREQ_DIST = new Int32Array(30);
let S_BASE = 1;
class Deflater {
    head4 = S_HEAD4;
    head3 = S_HEAD3;
    prev = S_PREV;
    // Token packing: literals are the byte value (>= 0); matches are
    // (1 << 31) | (dist << 9) | (len - 3), i.e. always negative.
    tokens = S_TOKENS;
    nTok = 0;
    freqLit = S_FREQ_LIT;
    freqDist = S_FREQ_DIST;
    extraBitsTotal = 0;
    blockStart = 0; // input offset where the current block begins
    emittedTo = 0; // input offset covered by emitted tokens
    matchDist = 0;
    base; // stamp offset for this call's hash table entries
    cfg;
    data;
    bw;
    optimal;
    dictLen;
    constructor(data, level, bw, dictLen = 0) {
        this.data = data;
        this.bw = bw;
        // When dictLen > 0, data is (preset dictionary ++ payload): the
        // first dictLen bytes are never emitted, but matches may reach
        // into them (their hash chains live in the prebuilt DICT tables).
        this.dictLen = dictLen;
        this.blockStart = dictLen;
        this.emittedTo = dictLen;
        const lv = Math.min(10, Math.max(1, level));
        // Level 10 = optimal parse (see runOptimal). Capped to 8 MiB of
        // input — its scratch is ~20 bytes/input byte — above which it
        // degrades gracefully to level 9.
        this.optimal = lv >= 10 && data.length <= 1 << 23;
        this.cfg = this.optimal
            ? { good: 258, maxLazy: 258, nice: 258, chain: 8192, lazy: false }
            : LEVELS[Math.min(9, lv) - 1];
        // Reset stamps before they could overflow Int32 within this call.
        if (S_BASE > 0x7fffffff - data.length - 16) {
            S_HEAD4.fill(0);
            S_HEAD3.fill(0);
            S_PREV.fill(0);
            S_BASE = 1;
        }
        this.base = S_BASE;
        S_BASE += data.length + 1;
        this.freqLit.fill(0);
        this.freqDist.fill(0);
    }
    insert(i) {
        const d = this.data;
        const n = d.length;
        if (i + 3 > n)
            return;
        const stamp = this.base + i;
        this.head3[hash3At(d, i)] = stamp;
        if (i + 4 <= n) {
            const h4 = hash4At(d, i);
            this.prev[i & WMASK] = this.head4[h4];
            this.head4[h4] = stamp;
        }
    }
    /**
     * Longest match at position i among hash-chain candidates. Candidates
     * are verified byte-by-byte, so stale/colliding chain entries can only
     * cost time, never correctness. Returns 0 if nothing >= MIN_MATCH.
     */
    findMatch(i, prevLen) {
        const d = this.data;
        const maxLen = Math.min(MAX_MATCH, d.length - i);
        if (maxLen < MIN_MATCH)
            return 0;
        const limit = i - WINDOW;
        const nice = Math.min(this.cfg.nice, maxLen);
        let chain = this.cfg.chain;
        // Only matches longer than the pending one matter, and a good match
        // in hand justifies a shallower search (zlib's good_length).
        let best = prevLen >= MIN_MATCH ? prevLen : MIN_MATCH - 1;
        if (best >= maxLen)
            return 0;
        if (prevLen >= this.cfg.good)
            chain >>= 2;
        let bestDist = 0;
        const base = this.base;
        // Stored values are stamps (base + pos); stamps below this call's
        // base are stale entries from previous calls and decode negative.
        //
        // Tier 1: single-entry 3-byte probe — the only finder of length-3
        // matches (the chain table hashes 4 bytes). One candidate, no chain.
        {
            const c3 = this.head3[hash3At(d, i)] - base;
            if (c3 >= limit && c3 >= 0 &&
                d[c3] === d[i] && d[c3 + 1] === d[i + 1] && d[c3 + 2] === d[i + 2]) {
                let l = 3;
                while (l < maxLen && d[c3 + l] === d[i + l])
                    l++;
                if (l > best) {
                    best = l;
                    bestDist = i - c3;
                }
            }
        }
        // Tier 2: 4-byte hash chain walk.
        if (maxLen >= 4 && best < nice) {
            let cand = this.head4[hash4At(d, i)] - base;
            while (cand >= limit && cand >= 0 && chain-- > 0) {
                if (d[cand + best] === d[i + best] && d[cand] === d[i]) {
                    let l = 1;
                    while (l < maxLen && d[cand + l] === d[i + l])
                        l++;
                    if (l > best) {
                        best = l;
                        bestDist = i - cand;
                        if (best >= nice)
                            break;
                    }
                }
                cand = this.prev[cand & WMASK] - base;
            }
        }
        // Preset-dictionary tiers (prebuilt once, position+1 stored,
        // 0 = empty). Entered only if the window still reaches the
        // dictionary region and the in-payload search didn't already hit
        // its quality targets.
        if (this.dictLen > 0 && best < nice && best < maxLen && limit < this.dictLen) {
            const lo = limit > 0 ? limit : 0;
            const c3 = DICT_HEAD3[hash3At(d, i)] - 1;
            if (c3 >= lo &&
                d[c3] === d[i] && d[c3 + 1] === d[i + 1] && d[c3 + 2] === d[i + 2]) {
                let l = 3;
                while (l < maxLen && d[c3 + l] === d[i + l])
                    l++;
                if (l > best) {
                    best = l;
                    bestDist = i - c3;
                }
            }
            if (maxLen >= 4 && best < nice && chain > 0) {
                const dp = DICT_PREV;
                let c2 = DICT_HEAD4[hash4At(d, i)] - 1;
                while (c2 >= lo && chain-- > 0) {
                    if (d[c2 + best] === d[i + best] && d[c2] === d[i]) {
                        let l = 1;
                        while (l < maxLen && d[c2 + l] === d[i + l])
                            l++;
                        if (l > best) {
                            best = l;
                            bestDist = i - c2;
                            if (best >= nice)
                                break;
                        }
                    }
                    c2 = dp[c2] - 1;
                }
            }
        }
        if (best < MIN_MATCH)
            return 0;
        this.matchDist = bestDist;
        return best;
    }
    emitLit(b) {
        this.tokens[this.nTok++] = b;
        this.freqLit[b]++;
        this.emittedTo++;
        if (this.nTok === TOKENS_MAX)
            this.flushBlock(false);
    }
    emitMatch(len, dist) {
        this.tokens[this.nTok++] = (1 << 31) | (dist << 9) | (len - 3);
        const lc = LEN_TO_CODE[len - 3];
        this.freqLit[257 + lc]++;
        this.extraBitsTotal += LEN_EXTRA[lc];
        const dc = distToCode(dist);
        this.freqDist[dc]++;
        this.extraBitsTotal += DIST_EXTRA[dc];
        this.emittedTo += len;
        if (this.nTok === TOKENS_MAX)
            this.flushBlock(false);
    }
    run() {
        const d = this.data;
        const n = d.length;
        if (this.optimal) {
            this.runOptimal();
            this.flushBlock(true);
            return;
        }
        // Incompressible-input acceleration: after a long run of positions
        // where no match was found, searching every position is wasted work
        // (random/encrypted data never matches). Suppress search+insert for
        // a stretch that grows with the run length, capped so that when the
        // data turns compressible again at most ~32 bytes of matches are
        // missed. Skipped bytes are still emitted as literals — only the
        // *search* is skipped, so output is always valid DEFLATE.
        let litRun = 0;
        let skipUntil = 0;
        if (this.cfg.lazy) {
            let i = this.dictLen;
            let prevLen = 0;
            let prevDist = 0;
            let avail = false; // a literal at i-1 is pending a lazy decision
            while (i < n) {
                let mLen = 0;
                let mDist = 0;
                if (n - i >= MIN_MATCH && i >= skipUntil) {
                    if (prevLen < this.cfg.maxLazy) {
                        mLen = this.findMatch(i, prevLen);
                        mDist = this.matchDist;
                        // A minimal match far away costs more bits than 3 literals.
                        if (mLen === MIN_MATCH && mDist > 4096)
                            mLen = 0;
                    }
                    this.insert(i);
                }
                if (prevLen >= MIN_MATCH && prevLen >= mLen) {
                    // The match found at i-1 wins; the byte at i is inside it.
                    this.emitMatch(prevLen, prevDist);
                    const end = i - 1 + prevLen;
                    for (let j = i + 1; j < end; j++)
                        this.insert(j);
                    i = end;
                    prevLen = 0;
                    avail = false;
                    litRun = 0;
                }
                else {
                    if (avail)
                        this.emitLit(d[i - 1]);
                    prevLen = mLen;
                    prevDist = mDist;
                    avail = true;
                    i++;
                    if (mLen === 0 && ++litRun >= 96)
                        skipUntil = i + Math.min(litRun >> 5, 32);
                }
            }
            if (avail)
                this.emitLit(d[n - 1]);
        }
        else {
            let i = this.dictLen;
            while (i < n) {
                let mLen = 0;
                if (n - i >= MIN_MATCH && i >= skipUntil) {
                    mLen = this.findMatch(i, 0);
                    this.insert(i);
                    if (mLen === MIN_MATCH && this.matchDist > 4096)
                        mLen = 0;
                }
                if (mLen >= MIN_MATCH) {
                    this.emitMatch(mLen, this.matchDist);
                    for (let j = i + 1; j < i + mLen; j++)
                        this.insert(j);
                    i += mLen;
                    litRun = 0;
                }
                else {
                    this.emitLit(d[i]);
                    i++;
                    if (++litRun >= 96)
                        skipUntil = i + Math.min(litRun >> 5, 32);
                }
            }
        }
        this.flushBlock(true);
    }
    /**
     * Level 10: optimal parse (zopfli-style, simplified).
     *
     * Levels 1-9 choose matches greedily (with one position of lazy
     * lookahead). The optimal parse instead records the longest match at
     * every position, then solves a shortest-path problem over the file
     * where edge weights are real Huffman bit costs: cost[i] = cheapest
     * way to encode the suffix starting at i. Because actual code lengths
     * depend on the parse and vice versa, the cost model and the parse
     * are alternated for three rounds (statics -> parse -> recount ->
     * reparse), which captures nearly all of the achievable gain.
     *
     * Candidate lengths are restricted to length-code bucket ends (the
     * longest length of each code, which reaches farthest for the same
     * bit cost) plus the full match length — lengths 3..10 each form
     * their own bucket, so short matches are still considered exactly.
     */
    runOptimal() {
        const d = this.data;
        const n = d.length;
        if (n === 0)
            return;
        // Pass 1: longest match (and its distance) at every position.
        const dictLen = this.dictLen;
        const mlen = new Int32Array(n);
        const mdist = new Int32Array(n);
        for (let i = dictLen; i < n; i++) {
            if (n - i >= MIN_MATCH) {
                const l = this.findMatch(i, 0);
                if (l >= MIN_MATCH) {
                    mlen[i] = l;
                    mdist[i] = this.matchDist;
                }
                this.insert(i);
            }
        }
        // Candidate lengths: end of every length-code bucket.
        const bucketEnd = new Int32Array(29);
        for (let c = 0; c < 28; c++)
            bucketEnd[c] = LEN_BASE[c] + (1 << LEN_EXTRA[c]) - 1;
        bucketEnd[28] = 258;
        // Bit-cost tables, seeded from the fixed Huffman code and refined
        // from the parse's own statistics on later rounds. Unused symbols
        // get a finite-but-high cost so the parse can still explore them.
        const litBits = new Float64Array(256);
        const lenSymBits = new Float64Array(29);
        const distSymBits = new Float64Array(30);
        for (let b = 0; b < 256; b++)
            litBits[b] = STATIC_LLENS[b];
        for (let c = 0; c < 29; c++)
            lenSymBits[c] = STATIC_LLENS[257 + c];
        distSymBits.fill(5);
        const cost = new Float64Array(n + 1);
        const take = new Int32Array(n); // bytes consumed at i (1 = literal)
        const freqL = new Int32Array(286);
        const freqD = new Int32Array(30);
        for (let round = 0; round < 3; round++) {
            cost[n] = 0;
            for (let i = n - 1; i >= dictLen; i--) {
                let best = cost[i + 1] + litBits[d[i]];
                let bestTake = 1;
                const ml = Math.min(mlen[i], n - i);
                if (ml >= MIN_MATCH) {
                    const dc = distToCode(mdist[i]);
                    const dBits = distSymBits[dc] + DIST_EXTRA[dc];
                    for (let c = 0; c < 29; c++) {
                        const l = bucketEnd[c] < ml ? bucketEnd[c] : ml;
                        const lc = LEN_TO_CODE[l - 3];
                        const v = cost[i + l] + lenSymBits[lc] + LEN_EXTRA[lc] + dBits;
                        if (v < best) {
                            best = v;
                            bestTake = l;
                        }
                        if (bucketEnd[c] >= ml)
                            break;
                    }
                }
                cost[i] = best;
                take[i] = bestTake;
            }
            if (round === 2)
                break;
            // Re-derive the cost model from this parse's real statistics.
            freqL.fill(0);
            freqD.fill(0);
            for (let i = dictLen; i < n;) {
                const t = take[i];
                if (t === 1) {
                    freqL[d[i]]++;
                }
                else {
                    freqL[257 + LEN_TO_CODE[t - 3]]++;
                    freqD[distToCode(mdist[i])]++;
                }
                i += t;
            }
            freqL[256]++;
            const ll = buildCodeLengths(freqL, 286, 15);
            const dl = buildCodeLengths(freqD, 30, 15);
            for (let b = 0; b < 256; b++)
                litBits[b] = ll[b] || 14;
            for (let c = 0; c < 29; c++)
                lenSymBits[c] = ll[257 + c] || 14;
            for (let c = 0; c < 30; c++)
                distSymBits[c] = dl[c] || 14;
        }
        // Emit the chosen parse through the normal block pipeline.
        for (let i = dictLen; i < n;) {
            const t = take[i];
            if (t === 1) {
                this.emitLit(d[i]);
            }
            else {
                this.emitMatch(t, mdist[i]);
            }
            i += t;
        }
    }
    /** Emit the buffered tokens as the cheapest of stored/static/dynamic. */
    flushBlock(last) {
        const bw = this.bw;
        this.freqLit[256]++; // end-of-block symbol
        // Exact bit costs for each block representation.
        let staticBits = 3 + this.extraBitsTotal;
        for (let s = 0; s < 286; s++)
            staticBits += this.freqLit[s] * STATIC_LLENS[s];
        for (let dnum = 0; dnum < 30; dnum++)
            staticBits += this.freqDist[dnum] * 5;
        const litLens = buildCodeLengths(this.freqLit, 286, 15);
        const distLens = buildCodeLengths(this.freqDist, 30, 15);
        const hdr = buildDynHeader(litLens, distLens);
        let dynBits = Infinity;
        // zlib's inflater rejects an incomplete literal tree, which can only
        // arise for a near-empty block — where static wins anyway. Guard it.
        let usedLit = 0;
        for (let s = 0; s < 286; s++)
            if (litLens[s] !== 0)
                usedLit++;
        if (usedLit >= 2 && hdr !== null) {
            dynBits = 3 + hdr.bits + this.extraBitsTotal;
            for (let s = 0; s < 286; s++)
                dynBits += this.freqLit[s] * litLens[s];
            for (let dnum = 0; dnum < 30; dnum++)
                dynBits += this.freqDist[dnum] * distLens[dnum];
        }
        const rawLen = this.emittedTo - this.blockStart;
        const chunks = Math.max(1, Math.ceil(rawLen / 65535));
        const storedBits = chunks * 42 + rawLen * 8; // 42 = 3 + pad(<=7) + LEN/NLEN
        if (storedBits <= staticBits && storedBits <= dynBits) {
            this.writeStored(last, rawLen);
        }
        else if (dynBits < staticBits) {
            bw.writeBits(last ? 1 : 0, 1);
            bw.writeBits(2, 2);
            writeDynHeader(bw, hdr, litLens, distLens);
            this.writeTokens(lengthsToWriteCodes(litLens, 286), litLens, lengthsToWriteCodes(distLens, 30), distLens);
        }
        else {
            bw.writeBits(last ? 1 : 0, 1);
            bw.writeBits(1, 2);
            this.writeTokens(STATIC_LCODES, STATIC_LLENS, STATIC_DCODES, STATIC_DLENS);
        }
        this.freqLit.fill(0);
        this.freqDist.fill(0);
        this.extraBitsTotal = 0;
        this.nTok = 0;
        this.blockStart = this.emittedTo;
    }
    writeStored(last, rawLen) {
        const bw = this.bw;
        let off = this.blockStart;
        let remaining = rawLen;
        do {
            const n = Math.min(remaining, 65535);
            const final = last && n === remaining;
            bw.writeBits(final ? 1 : 0, 1);
            bw.writeBits(0, 2);
            bw.alignToByte();
            bw.writeByte(n & 0xff);
            bw.writeByte(n >>> 8);
            bw.writeByte(~n & 0xff);
            bw.writeByte((~n >>> 8) & 0xff);
            bw.writeBytes(this.data, off, n);
            off += n;
            remaining -= n;
        } while (remaining > 0);
    }
    writeTokens(lCodes, lLens, dCodes, dLens) {
        const bw = this.bw;
        const tokens = this.tokens;
        const nTok = this.nTok;
        for (let t = 0; t < nTok; t++) {
            const tok = tokens[t];
            if (tok >= 0) {
                bw.writeBits(lCodes[tok], lLens[tok]);
            }
            else {
                const len = (tok & 0xff) + 3;
                const dist = (tok >>> 9) & 0xffff;
                const lc = LEN_TO_CODE[len - 3];
                const sym = 257 + lc;
                bw.writeBits(lCodes[sym], lLens[sym]);
                bw.writeBits(len - LEN_BASE[lc], LEN_EXTRA[lc]);
                const dc = distToCode(dist);
                bw.writeBits(dCodes[dc], dLens[dc]);
                bw.writeBits(dist - DIST_BASE[dc], DIST_EXTRA[dc]);
            }
        }
        bw.writeBits(lCodes[256], lLens[256]); // end of block
    }
}
function buildDynHeader(litLens, distLens) {
    let hlit = 286;
    while (hlit > 257 && litLens[hlit - 1] === 0)
        hlit--;
    let hdist = 30;
    while (hdist > 1 && distLens[hdist - 1] === 0)
        hdist--;
    const m = hlit + hdist;
    const combined = new Uint8Array(m);
    combined.set(litLens.subarray(0, hlit), 0);
    combined.set(distLens.subarray(0, hdist), hlit);
    // Run-length encode the code lengths into the 0..18 alphabet:
    // 16 = repeat previous 3-6, 17 = zeros 3-10, 18 = zeros 11-138.
    const rleSym = new Int32Array(m);
    const rleVal = new Int32Array(m);
    const rleBits = new Int32Array(m);
    let r = 0;
    let i = 0;
    while (i < m) {
        const v = combined[i];
        let run = 1;
        while (i + run < m && combined[i + run] === v)
            run++;
        i += run;
        if (v === 0) {
            while (run >= 11) {
                const t = Math.min(run, 138);
                rleSym[r] = 18;
                rleVal[r] = t - 11;
                rleBits[r] = 7;
                r++;
                run -= t;
            }
            if (run >= 3) {
                rleSym[r] = 17;
                rleVal[r] = run - 3;
                rleBits[r] = 3;
                r++;
                run = 0;
            }
            while (run-- > 0) {
                rleSym[r] = 0;
                rleVal[r] = 0;
                rleBits[r] = 0;
                r++;
            }
        }
        else {
            rleSym[r] = v;
            rleVal[r] = 0;
            rleBits[r] = 0;
            r++;
            run--;
            while (run >= 3) {
                const t = Math.min(run, 6);
                rleSym[r] = 16;
                rleVal[r] = t - 3;
                rleBits[r] = 2;
                r++;
                run -= t;
            }
            while (run-- > 0) {
                rleSym[r] = v;
                rleVal[r] = 0;
                rleBits[r] = 0;
                r++;
            }
        }
    }
    const clFreq = new Int32Array(19);
    for (let k = 0; k < r; k++)
        clFreq[rleSym[k]]++;
    const clLens = buildCodeLengths(clFreq, 19, 7);
    // zlib rejects an incomplete code-length tree; a single-symbol tree is
    // incomplete. Bail out to static/stored in that (pathological) case.
    let usedCl = 0;
    for (let k = 0; k < 19; k++)
        if (clLens[k] !== 0)
            usedCl++;
    if (usedCl < 2)
        return null;
    const clCodes = lengthsToWriteCodes(clLens, 19);
    let hclen = 19;
    while (hclen > 4 && clLens[CL_ORDER[hclen - 1]] === 0)
        hclen--;
    let bits = 14 + hclen * 3;
    for (let k = 0; k < r; k++)
        bits += clLens[rleSym[k]] + rleBits[k];
    return {
        hlit,
        hdist,
        hclen,
        clLens,
        clCodes,
        rleSym,
        rleVal,
        rleBits,
        rleCount: r,
        bits,
    };
}
function writeDynHeader(bw, h, litLens, distLens) {
    bw.writeBits(h.hlit - 257, 5);
    bw.writeBits(h.hdist - 1, 5);
    bw.writeBits(h.hclen - 4, 4);
    for (let k = 0; k < h.hclen; k++)
        bw.writeBits(h.clLens[CL_ORDER[k]], 3);
    for (let k = 0; k < h.rleCount; k++) {
        const sym = h.rleSym[k];
        bw.writeBits(h.clCodes[sym], h.clLens[sym]);
        if (h.rleBits[k] > 0)
            bw.writeBits(h.rleVal[k], h.rleBits[k]);
    }
}
// ---------------------------------------------------------------------------
// Decompressor (inflate). Treats input as hostile: every field validated,
// output capped, all back-references bounds-checked.
// ---------------------------------------------------------------------------
class Inflater {
    out;
    outLen = 0;
    outStart = 0;
    br;
    maxOut;
    constructor(br, maxOut, sizeHint, dict = null) {
        this.br = br;
        this.maxOut = maxOut;
        // Physical capacity may exceed the logical limit by up to MAX_MATCH
        // so the hot loop can write one token without bounds checks; the
        // logical limit is enforced in reserve() and again after the final
        // block. sizeHint sizes the buffer up front to skip grow-and-copy
        // cycles; it is only a hint — never trusted beyond maxOut, and the
        // caller caps it at the maximum possible DEFLATE expansion of the
        // input.
        const dlen = dict === null ? 0 : dict.length;
        this.out = new Uint8Array(dlen +
            Math.min(Math.max(256, sizeHint) + MAX_MATCH, Math.max(256, maxOut) + MAX_MATCH));
        if (dict !== null) {
            // A preset dictionary primes the back-reference window; it is
            // not part of the output (run() slices it off) and does not
            // count against maxOut.
            this.out.set(dict);
            this.outStart = dlen;
            this.outLen = dlen;
        }
    }
    /**
     * Guarantee room for `extra` more bytes. Capacity invariant: while
     * produced output (outLen - outStart) <= maxOut, the buffer can
     * absorb a full token (MAX_MATCH).
     */
    reserve(extra) {
        const limit = this.maxOut + this.outStart;
        if (this.outLen > limit)
            corrupt(`decompressed size exceeds limit (${this.maxOut} bytes)`);
        const needed = this.outLen + extra;
        if (needed > limit + MAX_MATCH || needed < 0)
            corrupt(`decompressed size exceeds limit (${this.maxOut} bytes)`);
        if (needed <= this.out.length)
            return;
        let cap = this.out.length * 2;
        while (cap < needed)
            cap *= 2;
        if (cap > limit + MAX_MATCH)
            cap = limit + MAX_MATCH;
        const nb = new Uint8Array(cap);
        nb.set(this.out.subarray(0, this.outLen));
        this.out = nb;
    }
    run() {
        const br = this.br;
        let last = 0;
        do {
            last = br.readBits(1);
            const type = br.readBits(2);
            if (type === 0)
                this.storedBlock();
            else if (type === 1) {
                const [lit, dist] = getFixedDecoders();
                this.huffmanBlock(lit, dist);
            }
            else if (type === 2) {
                const [lit, dist] = this.readDynHeader();
                this.huffmanBlock(lit, dist);
            }
            else
                corrupt('invalid block type 3');
        } while (last === 0);
        if (this.outLen - this.outStart > this.maxOut)
            corrupt(`decompressed size exceeds limit (${this.maxOut} bytes)`);
        return this.out.slice(this.outStart, this.outLen);
    }
    storedBlock() {
        const br = this.br;
        br.alignToByte();
        const len = br.readBits(16);
        const nlen = br.readBits(16);
        if ((len ^ 0xffff) !== nlen)
            corrupt('stored block LEN/NLEN mismatch');
        this.reserve(len);
        br.readBytes(this.out, this.outLen, len);
        this.outLen += len;
    }
    readDynHeader() {
        const br = this.br;
        const hlit = br.readBits(5) + 257;
        const hdist = br.readBits(5) + 1;
        const hclen = br.readBits(4) + 4;
        if (hlit > 286)
            corrupt('invalid HLIT');
        if (hdist > 30)
            corrupt('invalid HDIST');
        const clLens = new Uint8Array(19);
        for (let k = 0; k < hclen; k++)
            clLens[CL_ORDER[k]] = br.readBits(3);
        const clDec = new HuffDecoder(clLens, 19, MODE_GENERIC);
        const lens = new Uint8Array(hlit + hdist);
        let i = 0;
        while (i < hlit + hdist) {
            const sym = br.decodeSym(clDec);
            if (sym < 16) {
                lens[i++] = sym;
            }
            else {
                let rep;
                let val = 0;
                if (sym === 16) {
                    if (i === 0)
                        corrupt('code-length repeat with no previous length');
                    val = lens[i - 1];
                    rep = 3 + br.readBits(2);
                }
                else if (sym === 17) {
                    rep = 3 + br.readBits(3);
                }
                else {
                    rep = 11 + br.readBits(7);
                }
                if (i + rep > hlit + hdist)
                    corrupt('code-length repeat overflows');
                while (rep-- > 0)
                    lens[i++] = val;
            }
        }
        if (lens[256] === 0)
            corrupt('dynamic block has no end-of-block code');
        const lit = new HuffDecoder(lens.subarray(0, hlit), hlit, MODE_LITLEN);
        const dist = new HuffDecoder(lens.subarray(hlit), hdist, MODE_DIST);
        return [lit, dist];
    }
    /**
     * Decode one Huffman-coded block. The bit-reader and output state live
     * in locals for the duration of the loop (written back on exit and
     * around reserve() calls) — this is the inflate hot path, and avoiding
     * per-symbol field/method traffic roughly doubles throughput.
     */
    huffmanBlock(lit, distDec) {
        const br = this.br;
        const buf = br.buf;
        const end = br.end;
        // Away from the input tail, refills can skip per-byte bounds checks
        // (a refill consumes at most 3 bytes; 8 leaves margin for both
        // refill sites in one iteration).
        const safeEnd = end - 8;
        let pos = br.pos;
        let bitBuf = br.bitBuf;
        let bitCnt = br.bitCnt;
        const litFast = lit.fast;
        const distFast = distDec.fast;
        let out = this.out;
        let outLen = this.outLen;
        for (;;) {
            // One token writes at most MAX_MATCH bytes; top up capacity once
            // per iteration so the writes below need no per-byte checks.
            if (outLen + MAX_MATCH > out.length) {
                this.outLen = outLen;
                this.reserve(MAX_MATCH);
                out = this.out;
            }
            // Refill to >= 24 bits when input remains: enough for one
            // literal/length symbol (<= 15) plus its extra bits (<= 5).
            if (pos < safeEnd) {
                while (bitCnt <= 23) {
                    bitBuf |= buf[pos++] << bitCnt;
                    bitCnt += 8;
                }
            }
            else {
                while (bitCnt <= 23 && pos < end) {
                    bitBuf |= buf[pos++] << bitCnt;
                    bitCnt += 8;
                }
            }
            // Packed-entry decode: the table entry carries kind, base, and
            // extra-bit count, so the common path below is lookup + shifts
            // with no secondary table lookups or symbol-range branches.
            let e = litFast[bitBuf & FAST_MASK];
            let l = e & 0xf;
            if (l === 0 || l > bitCnt) {
                e = coldEntry(lit, MODE_LITLEN, bitBuf, bitCnt);
                l = e & 0xf;
            }
            bitBuf >>>= l;
            bitCnt -= l;
            const kind = e & 0x30;
            if (kind === KIND_LITERAL) {
                out[outLen++] = (e >>> 8) & 0xff;
                continue;
            }
            if (kind === KIND_EOB) {
                br.pos = pos;
                br.bitBuf = bitBuf;
                br.bitCnt = bitCnt;
                this.outLen = outLen;
                return;
            }
            let nx = (e >>> 17) & 0x7;
            if (nx > bitCnt)
                corrupt('unexpected end of compressed data');
            const len = ((e >>> 8) & 0x1ff) + (bitBuf & ((1 << nx) - 1));
            bitBuf >>>= nx;
            bitCnt -= nx;
            // Distance symbol (<= 15 bits) + distance extra (<= 13 bits) can
            // exceed what's buffered; refill before each.
            while (bitCnt <= 23 && pos < end) {
                bitBuf |= buf[pos++] << bitCnt;
                bitCnt += 8;
            }
            e = distFast[bitBuf & FAST_MASK];
            l = e & 0xf;
            if (l === 0 || l > bitCnt) {
                e = coldEntry(distDec, MODE_DIST, bitBuf, bitCnt);
                l = e & 0xf;
            }
            bitBuf >>>= l;
            bitCnt -= l;
            nx = (e >>> 23) & 0xf;
            if (nx > bitCnt) {
                while (bitCnt <= 23 && pos < end) {
                    bitBuf |= buf[pos++] << bitCnt;
                    bitCnt += 8;
                }
                if (nx > bitCnt)
                    corrupt('unexpected end of compressed data');
            }
            const dist = ((e >>> 8) & 0x7fff) + (bitBuf & ((1 << nx) - 1));
            bitBuf >>>= nx;
            bitCnt -= nx;
            if (dist > outLen)
                corrupt('back-reference before output start');
            const src = outLen - dist;
            if (len <= 24) {
                // Short copies: a plain loop beats any bulk-call overhead.
                for (let k = 0; k < len; k++)
                    out[outLen + k] = out[src + k];
                outLen += len;
            }
            else if (dist >= len) {
                // Non-overlapping: single bulk copy.
                out.copyWithin(outLen, src, src + len);
                outLen += len;
            }
            else if (dist === 1) {
                // Run of one byte — memset-speed fill.
                out.fill(out[src], outLen, outLen + len);
                outLen += len;
            }
            else {
                // Overlapping reference replicates a dist-byte period
                // (RFC 1951). Copy one period, then repeatedly copy from the
                // pattern start with a chunk that doubles each step. The
                // destination offset stays a multiple of dist (except the
                // final partial chunk), so phase is preserved, and source
                // [src, src+c) never overlaps destination [outLen+done, +c):
                // O(log(len/dist)) bulk moves instead of len byte writes.
                out.copyWithin(outLen, src, src + dist);
                let done = dist;
                while (done < len) {
                    const c = done < len - done ? done : len - done;
                    out.copyWithin(outLen + done, src, src + c);
                    done += c;
                }
                outLen += len;
            }
        }
    }
}
// ---------------------------------------------------------------------------
// gzip framing (RFC 1952)
// ---------------------------------------------------------------------------
const DEFAULT_MAX_OUTPUT = 256 * 1024 * 1024; // 256 MiB
/**
 * Compress to a standard gzip stream. level 1 = fastest, 9 = smallest
 * greedy, 6 = balanced default (mirrors zlib's convention). Level 10 is
 * an optimal parse (zopfli-style): typically 2-3% smaller than level 9
 * and smaller than native zlib -9, at file-transfer speeds (~1-7 MB/s) —
 * use it for attachments, not per-keystroke messages.
 *
 * @param {Uint8Array} data
 * @param {number} [level=6] 1..10
 * @returns {Uint8Array} gzip stream
 */
export function gzipCompress(data, level = 6) {
    const bw = new BitWriter();
    // 10-byte header: magic, deflate, no flags, zero mtime (no metadata
    // leaks — timestamps are a fingerprinting surface), XFL 0, OS 255.
    bw.writeByte(0x1f);
    bw.writeByte(0x8b);
    bw.writeByte(8);
    bw.writeByte(0);
    bw.writeByte(0);
    bw.writeByte(0);
    bw.writeByte(0);
    bw.writeByte(0);
    bw.writeByte(0);
    bw.writeByte(0xff);
    new Deflater(data, level, bw).run();
    bw.alignToByte();
    const crc = crc32(data);
    bw.writeByte(crc);
    bw.writeByte(crc >>> 8);
    bw.writeByte(crc >>> 16);
    bw.writeByte(crc >>> 24);
    const isize = data.length >>> 0;
    bw.writeByte(isize);
    bw.writeByte(isize >>> 8);
    bw.writeByte(isize >>> 16);
    bw.writeByte(isize >>> 24);
    return bw.finish();
}
/**
 * Decompress a gzip stream produced by any conforming compressor.
 * Throws CorruptDataError on malformed/truncated/oversized input.
 * maxOutputBytes is the zip-bomb guard — set it to the largest file
 * your application is willing to materialize.
 *
 * @param {Uint8Array} data gzip stream (treated as hostile)
 * @param {number} [maxOutputBytes=268435456]
 * @returns {Uint8Array} original bytes
 */
export function gzipDecompress(data, maxOutputBytes = DEFAULT_MAX_OUTPUT) {
    const off = parseGzipHeader(data);
    const br = new BitReader(data, off, data.length);
    // ISIZE from the trailer as an allocation hint, capped by the maximum
    // expansion DEFLATE permits (1032:1) so a forged value cannot force a
    // large allocation from a tiny input.
    const n = data.length;
    const claimed = (data[n - 4] | (data[n - 3] << 8) | (data[n - 2] << 16) | (data[n - 1] << 24)) >>> 0;
    const sizeHint = Math.min(claimed, (n - off) * 1032 + 64);
    const out = new Inflater(br, maxOutputBytes, sizeHint).run();
    br.alignToByte();
    const crc = (br.readBits(16) + br.readBits(16) * 65536) >>> 0;
    const isize = (br.readBits(16) + br.readBits(16) * 65536) >>> 0;
    if (crc !== crc32(out))
        corrupt('CRC32 mismatch');
    if (isize !== out.length % 4294967296)
        corrupt('length mismatch');
    if (br.bitsRemaining() !== 0)
        corrupt('trailing data after gzip stream');
    return out;
}
function parseGzipHeader(b) {
    // 10-byte header + 8-byte trailer + at least one block bit.
    if (b.length < 19)
        corrupt('input too short to be gzip');
    if (b[0] !== 0x1f || b[1] !== 0x8b)
        corrupt('not a gzip stream');
    if (b[2] !== 8)
        corrupt('unsupported compression method');
    const flg = b[3];
    if ((flg & 0xe0) !== 0)
        corrupt('reserved gzip flag bits set');
    let p = 10;
    if (flg & 4) {
        // FEXTRA
        if (p + 2 > b.length)
            corrupt('truncated gzip FEXTRA');
        const xlen = b[p] | (b[p + 1] << 8);
        p += 2 + xlen;
        if (p > b.length)
            corrupt('truncated gzip FEXTRA');
    }
    if (flg & 8) {
        // FNAME, zero-terminated
        while (p < b.length && b[p] !== 0)
            p++;
        if (p >= b.length)
            corrupt('truncated gzip FNAME');
        p++;
    }
    if (flg & 16) {
        // FCOMMENT
        while (p < b.length && b[p] !== 0)
            p++;
        if (p >= b.length)
            corrupt('truncated gzip FCOMMENT');
        p++;
    }
    if (flg & 2) {
        // FHCRC
        p += 2;
        if (p > b.length)
            corrupt('truncated gzip FHCRC');
    }
    if (p + 8 >= b.length)
        corrupt('gzip stream has no deflate payload');
    return p;
}
// ---------------------------------------------------------------------------
// Application-level helpers
// ---------------------------------------------------------------------------
/**
 * Magic-byte sniff for formats that are already entropy-coded — JPEG,
 * PNG, WebP, GIF, AVIF/HEIC/MP4, MKV/WebM, Ogg, FLAC, MP3, and common
 * archive formats. Recompressing these wastes CPU for ~0% gain.
 *
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function isLikelyPrecompressed(b) {
    if (b.length < 12)
        return false;
    // image
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
        return true; // JPEG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
        return true; // PNG
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
        return true; // GIF8
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
        return true; // RIFF....WEBP (plain RIFF/WAVE is NOT precompressed)
    // ISO-BMFF: MP4/MOV/HEIC/AVIF — "ftyp" at offset 4
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)
        return true;
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
        return true; // Matroska/WebM
    if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53)
        return true; // OggS
    if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43)
        return true; // fLaC
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)
        return true; // MP3 ID3
    // archives / compressed streams
    if (b[0] === 0x1f && b[1] === 0x8b)
        return true; // gzip
    if (b[0] === 0x50 && b[1] === 0x4b)
        return true; // zip/jar/docx/apk
    if (b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd)
        return true; // zstd
    if (b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58 &&
        b[4] === 0x5a)
        return true; // xz
    if (b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68)
        return true; // bzip2
    if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf)
        return true; // 7z
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21)
        return true; // rar
    return false;
}
/**
 * @typedef {Object} SmartCompressResult
 * @property {boolean} compressed true if `data` is gzip and the receiver
 *   should decompress it
 * @property {Uint8Array} data
 */

/**
 * Compress unless it isn't worth it: skips known-precompressed formats
 * outright and falls back to the original bytes when gzip doesn't win.
 * Carry the `compressed` flag in your message envelope.
 *
 * @param {Uint8Array} data
 * @param {number} [level=6] 1..10 (10 = optimal parse, for files)
 * @returns {SmartCompressResult}
 */
export function compressSmart(data, level = 6) {
    if (isLikelyPrecompressed(data))
        return { compressed: false, data };
    const gz = gzipCompress(data, level);
    if (gz.length >= data.length)
        return { compressed: false, data };
    return { compressed: true, data: gz };
}
// ---------------------------------------------------------------------------
// Chat-message compression with a preset dictionary.
//
// A bare gzip stream starts cold: 18 bytes of framing, empty match window,
// fresh Huffman statistics. Typical chat messages (50-500 bytes) barely
// compress that way. DEFLATE's preset-dictionary mechanism fixes this: both
// sides pre-load the 32 KiB window with shared, frequency-ordered sample
// text, so the very first byte of a message can back-reference common
// phrases, JSON envelope keys, URLs, and emoji.
//
// The dictionary is a versioned protocol artifact: byte 1 of the frame is
// its id. Changing CHAT_DICT_TEXT in any way is a wire-format break — add
// a new id instead. Most-frequent strings go LAST (closest to the data =
// shortest distances = fewest bits, per the zlib setDictionary guidance).
//
// Frame layout (6 bytes overhead vs gzip's 18):
//   byte 0      0xC4 magic
//   byte 1      dictionary id (0 = none, 1 = chat dictionary v1)
//   bytes 2..   raw DEFLATE stream (RFC 1951)
//   last 4      CRC32 of the plaintext, little-endian
// ---------------------------------------------------------------------------
const MSG_MAGIC = 0xc4;
const DICT_ID_NONE = 0;
const DICT_ID_CHAT_V1 = 1;
const DICT_ID_RAW = 2; // payload is plaintext, not deflate (incompressible)
const CHAT_DICT_TEXT = '{"v":1,"type":"message","channelId":"' +
    '","communityId":"","signingPublicKey":"","boxPublicKey":"' +
    '","displayName":"","announceNonce":"","nonce":"","sig":"' +
    '","joinSig":"","joinTs":,"ts":,"kind":"","body":"","text":"' +
    '","reply":{"id":"","edit":true,"reaction":"","attachment":' +
    '{"name":"","size":,"mime":"image/png","compressed":true},' +
    '"members":[],"ok":true,false,null}\n' +
    'https://www.youtube.com/watch?v= https://github.com/ ' +
    'https://imgur.com/ http://localhost: .onion/ .com/ .org/ .net/ ' +
    '😂😂😂🤣💀😭❤️🔥👍✨🙏😊🎉😍🥲🫠👀💯🤔😅\n' +
    '```\n``` **bold** _italic_ ~~strike~~ > quote\n- list\n* item\n' +
    "I'll we'll you'll he's she's it's that's there's what's let's " +
    "I've you've we've they've isn't aren't wasn't doesn't didn't " +
    "couldn't wouldn't shouldn't can't won't don't I'm you're we're " +
    'good morning good night see you later talk to you later ' +
    'be right back on my way no worries no problem of course ' +
    'sounds good to me let me know what do you think how are you ' +
    'are you there did you see I just wanted to say thank you so much ' +
    'I think that I would like to do you want to going to have to ' +
    'is there a way to can you send me the file the image the link ' +
    'should because people really little never always still being ' +
    'before after right where which while these those them then than ' +
    'tonight tomorrow yesterday today here when over only also very ' +
    'about there would could other into just like some time know good ' +
    'work make want need going great think yeah okay sure haha lol ' +
    'thanks please right will your what have from they this been said ' +
    'who oil its now find long down day did get has see way him two ' +
    'how its out use her can had his one our man new old all but not ' +
    'ent ion tio ati ing ed er ly es re in on at en nd ti es or te ' +
    'and the you that was for are with his they this have from one ' +
    'had word but what some can out other were all there when up use ' +
    'and a to in is you that it he was for on are as with his they I ' +
    'at be this have from or one had by word but not what all were ' +
    'we when your can said there use an each which she do how their ' +
    'if will up other about out many then them these so some her ' +
    'would make like him into time has look two more write go see ' +
    'number no way could people my than first water been call who ' +
    'its now find long down day did get come made may part ' +
    '?!... :) :D ;) <3 ok\n. , ! ? " \' ( ) [ ] { } : ; ' +
    ' the  and  you  to  a  of  is  in  it  I  that  for  on  with ';
/**
 * Minimal UTF-8 encoder — a language-built-ins-only replacement for
 * TextEncoder so the module stays runnable on any ECMAScript engine.
 * @param {string} s
 * @returns {Uint8Array}
 */
function utf8Encode(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        const c = s.codePointAt(i);
        if (c > 0xffff)
            i++; // surrogate pair consumed
        if (c < 0x80)
            out.push(c);
        else if (c < 0x800)
            out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000)
            out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else
            out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
}
/** The chat dictionary, exported for interop tests and other clients. */
export const CHAT_DICTIONARY = utf8Encode(CHAT_DICT_TEXT);
// Dictionary hash chains, built once on first use (position+1 stored,
// 0 = empty; DICT_PREV is indexed by position directly). Because the
// dictionary is immutable, priming costs nothing per message — findMatch
// consults these as a second phase when the window reaches the region.
let DICT_HEAD3 = null;
let DICT_HEAD4 = null;
let DICT_PREV = null;
function ensureDictTables() {
    if (DICT_HEAD3 !== null)
        return;
    const d = CHAT_DICTIONARY;
    DICT_HEAD3 = new Int32Array(HASH_SIZE);
    DICT_HEAD4 = new Int32Array(HASH4_SIZE);
    DICT_PREV = new Int32Array(d.length);
    for (let i = 0; i + 3 <= d.length; i++) {
        DICT_HEAD3[hash3At(d, i)] = i + 1;
        if (i + 4 <= d.length) {
            const h = hash4At(d, i);
            DICT_PREV[i] = DICT_HEAD4[h];
            DICT_HEAD4[h] = i + 1;
        }
    }
}
/**
 * Compress a chat message with the shared preset dictionary. Default
 * level 9: messages are small, so the extra search effort costs
 * microseconds and the bytes saved ride every hop of the network.
 *
 * @param {Uint8Array} data plaintext message bytes (compress BEFORE seal)
 * @param {number} [level=9] 1..10
 * @returns {Uint8Array} framed message (see header comment)
 */
export function compressMessage(data, level = 9) {
    ensureDictTables();
    const dlen = CHAT_DICTIONARY.length;
    const combined = new Uint8Array(dlen + data.length);
    combined.set(CHAT_DICTIONARY);
    combined.set(data, dlen);
    const bw = new BitWriter();
    bw.writeByte(MSG_MAGIC);
    bw.writeByte(DICT_ID_CHAT_V1);
    new Deflater(combined, level, bw, dlen).run();
    bw.alignToByte();
    const crc = crc32(data);
    bw.writeByte(crc);
    bw.writeByte(crc >>> 8);
    bw.writeByte(crc >>> 16);
    bw.writeByte(crc >>> 24);
    const framed = bw.finish();
    if (framed.length < data.length + 6)
        return framed;
    // Incompressible (emoji-free gibberish, foreign scripts, key material):
    // ship the plaintext in a raw frame so the worst case is exactly
    // +6 bytes, never frame-plus-failed-deflate.
    const raw = new Uint8Array(data.length + 6);
    raw[0] = MSG_MAGIC;
    raw[1] = DICT_ID_RAW;
    raw.set(data, 2);
    const p = raw.length - 4;
    raw[p] = crc;
    raw[p + 1] = crc >>> 8;
    raw[p + 2] = crc >>> 16;
    raw[p + 3] = crc >>> 24;
    return raw;
}
/**
 * Decompress a framed chat message (hostile input: validated, capped,
 * CRC-verified like gzipDecompress).
 *
 * @param {Uint8Array} data framed message
 * @param {number} [maxOutputBytes=1048576] zip-bomb guard (1 MiB default —
 *   raise it if your protocol allows larger plaintexts)
 * @returns {Uint8Array} plaintext message bytes
 */
export function decompressMessage(data, maxOutputBytes = 1 << 20) {
    if (data.length < 6)
        corrupt('message frame too short'); // 6 = empty raw frame
    if (data[0] !== MSG_MAGIC)
        corrupt('not a compressed message frame');
    const dictId = data[1];
    let dict = null;
    if (dictId === DICT_ID_CHAT_V1) {
        dict = CHAT_DICTIONARY;
    }
    else if (dictId === DICT_ID_RAW) {
        const out = data.slice(2, data.length - 4);
        if (out.length > maxOutputBytes)
            corrupt(`decompressed size exceeds limit (${maxOutputBytes} bytes)`);
        const e = data.length - 4;
        const c = (data[e] | (data[e + 1] << 8) | (data[e + 2] << 16) | (data[e + 3] << 24)) >>> 0;
        if (c !== crc32(out))
            corrupt('CRC32 mismatch');
        return out;
    }
    else if (dictId !== DICT_ID_NONE) {
        corrupt(`unknown dictionary id ${dictId}`);
    }
    const end = data.length - 4;
    const br = new BitReader(data, 2, end);
    const sizeHint = Math.min(maxOutputBytes, (end - 2) * 1032 + 64);
    const out = new Inflater(br, maxOutputBytes, sizeHint, dict).run();
    br.alignToByte();
    if (br.bitsRemaining() !== 0)
        corrupt('trailing data after message');
    const crc = (data[end] | (data[end + 1] << 8) | (data[end + 2] << 16) | (data[end + 3] << 24)) >>> 0;
    if (crc !== crc32(out))
        corrupt('CRC32 mismatch');
    return out;
}
