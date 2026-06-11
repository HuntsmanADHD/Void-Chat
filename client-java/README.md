# Void Chat Client — Pure Java

The client side of the JVM migration: a headless protocol/crypto engine
(`VoidClient`) plus a Swing UI (`VoidChatApp`). Zero third-party deps —
`java.base` (the engine) + `java.net.http` (HTTP/WebSocket client) +
`java.desktop` (Swing). Builds on the relay (`../relay-java`) and crypto
(`../seal-java`) modules.

## Build & run

```sh
javac -cp ../relay-java/out:../seal-java/out -d out *.java
java  -cp ../relay-java/out:../seal-java/out:out VoidChatApp   # GUI
```

Optional auto-pilot env vars for demos: `VOIDCHAT_NAME`, `VOIDCHAT_AUTOCONNECT=1`,
`VOIDCHAT_AUTOJOIN=1`, `VOIDCHAT_AUTOMSG="..."`, `VOIDCHAT_DEBUG=1`.

## Components

| file | what |
|---|---|
| `VoidClient.java` | protocol + crypto engine: announce, join, channel send/recv, DM, roster verification, peer-binding cache, **heartbeat + auto-reconnect** |
| `Identity.java` | persistent identity (Ed25519 + X25519 keys) saved to `~/.voidchat/identity.json` |
| `RelayHttpClient.java` | community/channel CRUD over the relay HTTP API |
| `VoidChatApp.java` | Swing desktop UI |
| `ClientE2ETest.java` | two clients exchange E2E messages through a live relay (11 checks) |
| `ClientFeatureTest.java` | identity persistence + reconnect-across-relay-restart (14 checks) |

## Identity persistence

`Identity` holds the long-lived signing (Ed25519, 64-byte tweetnacl format)
and box (X25519, 32-byte) keys. `loadOrCreate(path, name)` reads the existing
identity or mints + saves a fresh one; restarts keep the same identity, so
peer bindings and (future) history stay valid. The file is plaintext JSON
with `0600` permissions — parity with the TS client's localStorage.
Passphrase-encrypting it (Argon2 + XChaCha20-Poly1305 are already in the
stack) is a noted future hardening.

## Heartbeat + reconnect

- **Heartbeat:** sends `{"t":"$ping"}` every 20s so the relay's 60s read-idle
  timeout never reaps a live-but-quiet connection.
- **Reconnect:** any mid-session drop triggers reconnect with exponential
  backoff (1s → 30s cap). On reconnect the client re-announces (fresh nonce +
  signature) and re-joins every channel it was in (`joinedChannels` survives
  the drop); the backoff resets on a healthy `session:ack`. Verified by
  `ClientFeatureTest` killing the relay and restarting it on the same port.

## Message dedup

The relay stamps each delivered message with a random 128-bit `msgId`.
`VoidClient` keeps an LRU-bounded set of recently-delivered ids and drops a
repeat (relay re-fan-out, a duplicate frame, or re-receipt around a
reconnect), so a message is shown exactly once. `msgId` + `ts` are now passed
to the message listeners. (Note: the current protocol seals the **raw message
text**, not a JSON envelope — message kinds like edit/reaction/reply aren't
implemented in the TS client either, so there's no envelope gap to close yet.)

## Status / gaps

Done: announce, channel + DM messaging (E2E), roster + DM signature
verification, identity persistence, heartbeat, reconnect, **msgId dedup**.

Not yet (see project notes): message history, local stores
(password/host/pinned), Tor transport, and the GUI roster-callback timing bug.
