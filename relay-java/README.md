# Void Chat Relay — Pure Java

A zero-dependency rewrite of the Rust relay (`../relay/`) in plain Java
(`java.base` only — no jars, no Maven/Gradle, nothing beyond the JDK). The
wire contract is identical to the Rust relay's, so the existing TypeScript
client works unchanged.

## Build & run

```sh
javac -d out *.java
java -cp out Main          # listens on 127.0.0.1:3001
```

Requires JDK 21+ (virtual threads, `EdECPublicKeySpec`). Config via env:
`SOCKET_PORT` (default 3001), `VOIDCHAT_DATA_DIR` (default `./data`),
`CORS_ORIGIN` (comma list, or `*`), `VOIDCHAT_RELAY_LOG` (error/warn/info/debug).

## Test

```sh
java -cp out CryptoUtilTest   # 251 vector/hostile-input assertions
java -cp out RelayTest        # 50 integration assertions (boots a live relay)
```

## What's hand-rolled vs. JDK

| Concern | Implementation |
|---|---|
| HTTP/1.1 + RFC 6455 WebSocket | `HttpServer.java`, `WebSocket.java` (hand-rolled, virtual-thread-per-conn) |
| JSON | `Json.java` (strict, depth-capped) |
| Base58 | `Base58.java` (bs58-compatible) |
| Argon2id + Blake2b | `Argon2.java`, `Blake2b.java` (RFC 9106 / 7693) |
| scrypt legacy verify | `Scrypt.java` (RFC 7914; PBKDF2 on JDK Mac, Salsa20/8 hand-rolled) |
| Ed25519 verify | `Ed25519Verify.java` (JDK EdEC, raw-key decode) |
| SHA-1/Base64/SecureRandom/Instant | JDK built-ins |
| Storage | `Store.java` — atomic JSON file (replaces SQLite) |
| API / realtime | `Api.java`, `Realtime.java` (faithful ports of http.rs / realtime.rs) |

## Verification status

- **Crypto vectors**: Blake2b (RFC 7693), Argon2 d/i/id (RFC 9106 §5),
  scrypt (RFC 7914 §12), Ed25519 (RFC 8032 §7.1) — all pass.
- **Cross-implementation**: Argon2id PHC strings are interchangeable with the
  Rust relay's `argon2` crate, verified both directions (Rust verifies
  Java-minted hashes and vice versa). Existing community passwords keep working.
- **Integration**: full HTTP CRUD, password gates, rate limits, avatar
  magic-byte sniffing, oversized-body rejection, CORS; WebSocket announce with
  real Ed25519 keypairs, roster, channel fan-out between two identities, DM,
  member-left, and the bad-nonce / bad-signature / stale-timestamp bouncers.

## Storage note

This relay starts with an empty `voidchat.json`; it does **not** read the
Rust relay's `voidchat.db`. Communities are re-created on first use. The old
SQLite file is left untouched on disk.

## Differences from the Rust relay (intentional)

- SQLite → atomic JSON file (friend-group scale; zero-dep requirement).
- Thread-per-connection on virtual threads instead of tokio tasks.
- The Rust relay remains in-tree as the reference implementation during the
  migration (same role compress.js plays for the compression codec).
