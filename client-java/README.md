# Void Chat Client — Pure Java

The client side of the JVM migration: a headless protocol/crypto engine
(`VoidClient`) plus a Swing UI (`VoidChatApp`). Zero third-party deps —
the engine is pure `java.base` (`jdeps`-verified; the hand-rolled transport
replaced `java.net.http`), the UI adds `java.desktop` (Swing). Builds on the
relay (`../relay-java`) and crypto (`../seal-java`) modules.

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
| `Transport.java` | TCP dialer: direct or hand-rolled **SOCKS5 client (RFC 1928)** for Tor — always domain-ATYP, so .onion names go to the proxy verbatim (no local DNS, no leaks) |
| `WsClientConnection.java` | hand-rolled **RFC 6455 client** (upgrade handshake, masked frames, auto-pong) — the mirror of relay-java's server `WebSocket.java`; same code path direct and over SOCKS |
| `RelayHttpClient.java` | community/channel CRUD — hand-rolled HTTP/1.1 over `Transport` |
| `VoidChatApp.java` | Swing desktop UI (`VOIDCHAT_SOCKS=host:port` routes via Tor) |
| `ClientE2ETest.java` | two clients exchange E2E messages through a live relay (11 checks) |
| `ClientFeatureTest.java` | identity persistence + reconnect-across-relay-restart (16 checks) |
| `TorTransportTest.java` | full client flow through an in-process SOCKS5 server with a fake .onion name only the proxy can resolve (11 checks) |
| `LiveOnionTest.java` | **real Tor network round-trip**: relay published as a v3 onion (relay-java `Tor.java`), client dials back through tor's SOCKS, E2E message + DM across mixed transports — run before shipping, needs internet + tor |

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

## Tor transport (client side)

`Transport.socks5(host, port)` (UI: `VOIDCHAT_SOCKS=127.0.0.1:9050`) routes
every connection — HTTP CRUD and the websocket — through a SOCKS5 proxy
using domain addressing, which is how Tor resolves `.onion` services. The
JDK's `java.net.http` can't speak SOCKS, so the whole client transport is
hand-rolled (and `java.net.http` is gone entirely). It's one code path: the
direct tests exercise the same framing/handshake code the Tor route uses.

`TorTransportTest` proves the SOCKS layer offline: a fake `.onion` hostname
that only the embedded proxy can resolve, so any local-DNS shortcut would
fail every assertion. The remaining (user-only) step is the same one the TS
stack has: a live two-machine test against a real Tor onion.

Not yet on the Tor side: *hosting* — publishing the relay as a hidden
service needs a managed `tor` process (torrc `HiddenServiceDir` or
control-port `ADD_ONION`), the Java counterpart of the Tauri sidecar.

## Status / gaps

Done: announce, channel + DM messaging (E2E), roster + DM signature
verification, identity persistence, heartbeat, reconnect, **msgId dedup**,
**SOCKS5/Tor client transport**, GUI roster-callback timing fix (the
active-channel filter now runs on the EDT where `activeChannelId` is
mutated).

Not yet (see project notes): message history, local stores
(password/host/pinned), Tor *hosting* (onion publication / tor process
management), identity-file passphrase encryption.
