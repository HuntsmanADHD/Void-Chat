# Void Chat

Self-hosted ephemeral messaging. You run it on your own machine, your friends connect to it, and what's said in the void stays in the void.

No accounts. No email. No password. No history. Every browser tab generates a fresh cryptographic identity that disappears when you close it.

## What it is

- **A small server you host yourself.** Designed for a trusted group — a friend circle, a household, a band of collaborators. Not Twitter-scale.
- **End-to-end encrypted by design.** Every message is `nacl.box`-sealed from the sender's device to one specific recipient's device. The relay sees only ciphertext.
- **Stateless by design.** The server keeps a list of communities and channels. It does not store messages. It does not store users. Restart it and every roster, every in-flight message, every connected identity is gone.
- **Ephemeral by design.** Close your tab — your identity is gone. Reload — fresh keypair. There is no account to recover because there was never an account.

## What's stored where

| What | Where | When it's gone |
|---|---|---|
| Your private keys | Browser sessionStorage | Tab closes |
| Your display name | Browser localStorage | You clear it |
| Messages — in flight | Server RAM, only while routing | Microseconds later |
| Messages — your view | Browser memory | Page reload (until IndexedDB store ships) |
| Community + channel directory | SQLite file on the host | You delete it |

The relay decrypts nothing. The SQLite file holds only the names of communities and channels you and your friends create — no messages, no users.

## Running it

### With Docker (recommended)

```bash
git clone https://github.com/HuntsmanADHD/Void-Chat.git
cd Void-Chat
cp .env.example .env       # defaults work for localhost
docker compose up -d
```

Open <http://localhost:3000>. That's it.

The web app is on `:3000`, the relay on `:3001`. Your data lives in a Docker named volume (`voidchat_data`).

**Back up your server:**
```bash
docker run --rm -v voidchat_data:/data -v "$(pwd)":/backup alpine \
  cp /data/voidchat.db /backup/voidchat-backup.db
```

**Restore from backup:**
```bash
docker compose down
docker run --rm -v voidchat_data:/data -v "$(pwd)":/backup alpine \
  cp /backup/voidchat-backup.db /data/voidchat.db
docker compose up -d
```

### Without Docker

```bash
git clone https://github.com/HuntsmanADHD/Void-Chat.git
cd Void-Chat
cp .env.example .env
yarn install
yarn prisma generate
yarn prisma db push
yarn dev:all              # starts Next on :3000 and the relay on :3001
```

You need Node 18+ and yarn. SQLite is included via Prisma — no separate database to install.

## Inviting friends

Once your server is running, friends join by visiting the URL your machine is reachable at.

**LAN / Tailscale / local network:**
```
http://your-hostname.local:3000
http://192.168.x.y:3000
http://your-tailnet-name:3000
```

**Internet-exposed:**
You're responsible for the TLS termination layer (Caddy with LetsEncrypt, Cloudflare Tunnel, ngrok, etc.). Make sure both ports `3000` (web) and `3001` (relay) reach your container. Update `CORS_ORIGIN` in `.env` to your public URL.

Their browser tab generates an identity on first load. They pick a display name and they're in. Anyone with the URL can join, so share the URL like you'd share a Discord invite — through a channel you trust.

## Joining someone else's server

Open their server's URL in your browser. The app served from their machine talks to their relay. You're now in their void.

You can be in someone else's server without ever running your own — being a host and being a guest are separate concerns.

## Configuration

`.env` — most setups only touch the first two:

```bash
# Where the SQLite file lives. Inside the Docker container the path resolves
# to /app/data/voidchat.db (mapped to the `voidchat_data` named volume).
DATABASE_URL="file:../data/voidchat.db"

# Origins the relay accepts WebSocket connections from. Comma-separated.
# Use "*" for LAN-only setups; never use "*" on the public internet.
CORS_ORIGIN="http://localhost:3000"

# If you reverse-proxy the relay through a different host or path,
# override the URL clients connect to.
NEXT_PUBLIC_VOID_RELAY_URL=""
```

`docker-compose.yml` reads `WEB_PORT` and `RELAY_PORT` for port mapping if you need non-default ports.

## Honest limitations

- **Display names are not authenticated.** Anyone can pick "alice." Your friends recognize you by context, not by name.
- **No message history for new joiners.** When you join a channel, you see messages from that moment forward. Nothing in the past, ever.
- **No offline DMs.** If your recipient isn't connected when you hit send, the message is dropped. You'll be told.
- **Channel bandwidth scales with channel size.** A 50-person channel = 50 encrypted copies per message. This is what zero-knowledge fan-out costs.
- **Spam-resistance is your firewall.** Public hosting without any access control will get spammed. Run it behind a friend-trust boundary.

These are design choices, not bugs to fix later.

## Tech stack

| Layer | Technology |
|---|---|
| Web | Next.js 14 (App Router), TypeScript, Tailwind |
| Relay | Socket.io, Node 20+ |
| Crypto | TweetNaCl (ed25519 signing, Curve25519 boxes) |
| Directory DB | SQLite via Prisma |
| Identifiers | base58 |

## License

MIT — see [LICENSE](LICENSE).
