# Void Chat

Self-hosted ephemeral messenger. You run the server on your own machine, your friends connect to it, and what's said in the void stays in the void.

No accounts. No email. No password. No history. Every browser tab generates a fresh cryptographic identity that disappears when you close it.

---

## Table of contents

1. [What you're getting](#what-youre-getting)
2. [Quick start — 60 seconds, with Docker](#quick-start--60-seconds-with-docker)
3. [Step-by-step: from nothing to a running server](#step-by-step-from-nothing-to-a-running-server)
4. [Inviting friends](#inviting-friends)
   - [On the same network (LAN)](#on-the-same-network-lan)
   - [Anywhere in the world (the internet)](#anywhere-in-the-world-the-internet)
5. [Joining someone else's server](#joining-someone-elses-server)
6. [Protecting your server](#protecting-your-server)
7. [Day-to-day use](#day-to-day-use)
8. [Backup, restore, update, stop](#backup-restore-update-stop)
9. [Running without Docker](#running-without-docker)
10. [Honest limitations](#honest-limitations)
11. [Tech stack + license](#tech-stack--license)

---

## What you're getting

| What | Where it lives | When it's gone |
|---|---|---|
| Your private keys | Browser sessionStorage | The tab closes |
| Your display name | Browser localStorage | You clear it |
| Messages — in flight | Server RAM, microseconds | Forwarded and forgotten |
| Messages — your local copy | Browser IndexedDB | You "End Session" or wipe browser data |
| Community + channel directory | A single SQLite file | You delete it |

The relay decrypts nothing. The SQLite file holds only the names of communities and channels — no messages, no users.

You also get **Wash**, a separate off-Void encryption tool (different cipher family from the chat protocol) for sharing invite codes, passwords, or any phrase through channels you don't fully trust.

---

## Quick start — 60 seconds, with Docker

```bash
git clone https://github.com/HuntsmanADHD/Void-Chat.git
cd Void-Chat
cp .env.example .env
docker compose up -d
```

Open <http://localhost:3000>. You're in.

That's the whole local experience. The web app runs on `:3000`, the relay on `:3001`, your data lives in a Docker volume called `voidchat_data`. The first-run onboarding modal walks you through who you are, how encryption works, and how to invite people.

---

## Step-by-step: from nothing to a running server

This is the full walkthrough for someone who's never deployed a self-hosted app before.

### 1. Install Docker

- **macOS / Windows:** download Docker Desktop from <https://www.docker.com/products/docker-desktop>. Install, open it once so the engine is running.
- **Linux:** install Docker Engine + Compose. On Arch: `sudo pacman -S docker docker-compose && sudo systemctl enable --now docker && sudo usermod -aG docker $USER` (log out and back in for the group to take effect).

Verify: `docker compose version` should print a version number.

### 2. Get the code

```bash
git clone https://github.com/HuntsmanADHD/Void-Chat.git
cd Void-Chat
```

### 3. Make a config file

```bash
cp .env.example .env
```

The defaults are fine for a localhost-only first run. We'll come back to `.env` when we expose the server to the internet.

### 4. Start the stack

```bash
docker compose up -d
```

First run pulls the Node base image and builds your image — takes a few minutes. Subsequent runs are instant.

### 5. Open it

Go to <http://localhost:3000>. You should see the landing page. Click **Enter Void**.

You'll land in `/app` with the onboarding modal explaining:
- Your random display name (changeable in Settings)
- How every message is encrypted to one specific recipient
- How to invite friends (we'll do this next)

Click **Got it** when you've read it. Create your first community to make sure everything works.

### 6. Stop the server when you're done testing

```bash
docker compose down
```

Your data persists in the `voidchat_data` Docker volume. Start it again any time with `docker compose up -d`.

---

## Inviting friends

The fundamental rule: a friend joins your server by **opening a URL pointing at your machine in their browser**. There's no friend list, no DMs out of the blue. Share the URL through a channel you trust.

### On the same network (LAN)

Easiest case — you and your friend are on the same Wi-Fi, both in your house, on a campus network, etc.

1. Find your machine's address. On Linux/macOS: `ip addr` or `ifconfig`. Pick the one in `192.168.x.x` or `10.x.x.x`. On Windows: `ipconfig`. You can also use `your-hostname.local` if mDNS works on your network.
2. Update `.env` to allow that origin:
   ```bash
   CORS_ORIGIN="http://localhost:3000,http://192.168.x.x:3000"
   ```
   (Or for LAN-only setups where you don't care what address friends type, use `CORS_ORIGIN="*"`. **Never use `*` on the public internet.**)
3. Restart the relay so it picks up the new config:
   ```bash
   docker compose restart relay
   ```
4. Send your friend the URL: `http://192.168.x.x:3000`. They open it. They're in your void.

### Anywhere in the world (the internet)

Three reasonable paths, easiest to most-DIY:

#### Option A: Tailscale (recommended for friends-and-family)

[Tailscale](https://tailscale.com/) creates a private mesh network across the public internet. Both you and your friend install it, accept each other, and your machine is reachable at `your-hostname.tail-something.ts.net` from theirs. No ports to forward, no certificates to manage.

1. Install Tailscale on your machine (the host) and your friend's machine.
2. Both of you sign in to the same Tailscale account (or accept a share invite).
3. Update `.env`:
   ```bash
   CORS_ORIGIN="http://your-hostname.tail-something.ts.net:3000"
   ```
   Restart: `docker compose restart relay`.
4. Send your friend: `http://your-hostname.tail-something.ts.net:3000`.

#### Option B: Cloudflare Tunnel (free, no router config)

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) gives you a public `https://something.trycloudflare.com` URL pointing at your localhost, with TLS handled for you.

1. Install `cloudflared`.
2. Run `cloudflared tunnel --url http://localhost:3000` — it'll print a public URL.
3. You'll **also** need a tunnel for the relay on `:3001`. Either run a second tunnel and point your friends at the web URL + set `NEXT_PUBLIC_VOID_RELAY_URL` to the relay tunnel URL in `.env`, or use a single tunnel that proxies both ports via a named tunnel config.
4. Update `CORS_ORIGIN` in `.env` to your public web URL, restart.

#### Option C: Your own domain + reverse proxy (full control)

You have a domain (`alice.tld`) and a VPS or your home router can forward ports.

1. Point `alice.tld` DNS at your machine's public IP (A record).
2. Open ports `3000` and `3001` in your router / firewall.
3. Put [Caddy](https://caddyserver.com/) or nginx in front of both ports with TLS. Caddy auto-fetches a LetsEncrypt cert:
   ```
   alice.tld {
     reverse_proxy localhost:3000
   }
   wss.alice.tld {
     reverse_proxy localhost:3001
   }
   ```
4. Set in `.env`:
   ```bash
   CORS_ORIGIN="https://alice.tld"
   NEXT_PUBLIC_VOID_RELAY_URL="wss://wss.alice.tld"
   ```
5. Restart: `docker compose down && docker compose up -d` (the `NEXT_PUBLIC_*` env vars are baked into the Next build, so a full rebuild may be needed if you changed them — `docker compose up -d --build`).
6. Send your friend `https://alice.tld`.

---

## Joining someone else's server

You don't need to host anything yourself to use Void Chat. To join someone else's:

1. Get the URL they share with you.
2. Open it in your browser. Land on their landing page, click **Enter Void**.
3. The app served from their machine talks to their relay automatically. Your browser generates an identity. Pick a display name. You're in their void.

If they sent you an **invite code** (a short string starting with `cm…`) instead of a URL, that's a community code. Click **Create Community** on the dashboard, switch to the **Join with code** tab, paste the code (and the password if they shared one through a different channel), hit **Join**.

---

## Protecting your server

By default anyone who can reach your server's URL can create communities on it. For a friend-group server that's usually fine — your friends are the only ones who know the URL. For tighter setups:

### 1. Use private (password-protected) communities

When creating a community, toggle **Private Community** and set a password. The password is hashed with `scrypt` (random 16-byte salt, 64-byte derived key) before storage; the relay never sees the plaintext. Only people with the password can see the channel list or join the chat.

### 2. Share the password through a different channel than the invite

The invite code goes through one medium; the password through a different one. That way a leak of either alone doesn't compromise the community.

### 3. Use Wash for off-Void sharing

If you're sending the invite code or password through a medium you don't fully trust (SMS, group chat, email), use the **Wash** tool to add a second encryption layer:

- Open Wash from the droplet icon at the bottom-left of the app, the icon in any chat input bar, or via <http://your-server/wash>.
- "Wash" your invite code with a passphrase you and your friend agreed on.
- Send the washed blob (`void$wash$…`) through your normal channel.
- Send the passphrase through a different channel (call them, hand them a slip of paper, whatever).
- Friend opens Wash on their end, pastes the blob, types the passphrase, gets the original invite code.

Wash uses Web Crypto AES-256-GCM with PBKDF2-SHA256 — a different cipher family from the chat protocol (NaCl box). If someone cracks one layer, they still need to break the other.

Wash also has a **SubPub** mode: each session has a wash public key. Share your SubPub, friends can wash phrases addressed to you specifically (no passphrase exchange needed). See `/how-it-works` for the full breakdown.

### 4. CORS allowlist

The `CORS_ORIGIN` env var is a comma-separated list of origins the relay will accept WebSocket connections from. **Don't use `*` on the public internet** — it disables CORS protection entirely.

### 5. Put it behind TLS

Plain HTTP works for LAN/Tailscale. For internet exposure, terminate TLS at a reverse proxy (Caddy, nginx, Cloudflare). See the [internet section](#anywhere-in-the-world-the-internet) above.

---

## Day-to-day use

### Creating a community

Click the **+** icon on the leftmost sidebar strip (or the "Create Community" button if you have no communities yet). Pick a name, optional description and icon. Toggle private + enter a password if you want it gated. A `general` channel is created automatically.

### Adding more channels

Inside a community, hover over **Text Channels** in the left panel — a **+** appears. Click it, type a name. Done.

### Deleting a community

Inside the community, click the community name in the left panel header. A dropdown appears with **Copy invite link** and **Delete community**. Delete requires confirmation. Cascade-deletes its channels. If the community is private, the cached password is used; if you've forgotten it, the only way to delete is to wipe the SQLite file (`docker compose down -v` — this wipes ALL communities) or edit the row directly.

### Changing your display name

User panel at the bottom-left → settings cog → edit. Other peers see the new name on your next message after they receive a roster update (the client teardown+reconnects under the hood to push the new name).

### Ending your session manually

Settings → **End Session**. Wipes your sessionStorage (keypair gone), wipes your IndexedDB messages, reloads. You come back as a fresh identity.

---

## Backup, restore, update, stop

### Back up your server's data

```bash
docker run --rm \
  -v voidchat_data:/data \
  -v "$(pwd)":/backup \
  alpine cp /data/voidchat.db /backup/voidchat-backup.db
```

That's the entire server state — community + channel directory. Messages aren't stored, so there's nothing to back up there.

### Restore from a backup

```bash
docker compose down
docker run --rm \
  -v voidchat_data:/data \
  -v "$(pwd)":/backup \
  alpine cp /backup/voidchat-backup.db /data/voidchat.db
docker compose up -d
```

### Update to the latest version

```bash
cd Void-Chat
git pull
docker compose up -d --build
```

Schema changes (if any) are applied automatically on web startup via `prisma db push`.

### Stop the server

```bash
docker compose down
```

Data persists in the volume. To wipe the volume entirely (nuclear option):

```bash
docker compose down -v
```

---

## Running without Docker

You need Node 20+ and yarn 4. Prisma uses SQLite, so no separate DB to install.

```bash
git clone https://github.com/HuntsmanADHD/Void-Chat.git
cd Void-Chat
cp .env.example .env
yarn install
yarn prisma generate
yarn prisma db push
yarn dev:all          # starts Next on :3000 and the relay on :3001
```

The data lives at `./data/voidchat.db` on the host filesystem. Back it up by copying the file.

---

## Honest limitations

- **Display names aren't authenticated.** Anyone can pick "alice." Recognize friends by context.
- **No message history for new joiners.** When you join a channel, you see messages from that moment forward.
- **No offline DMs.** Recipient not connected = message dropped. You'll be told.
- **Channel bandwidth scales with channel size.** 50-person channel = 50 encrypted copies per message. That's the cost of zero-knowledge fan-out.
- **No forgotten-password recovery.** Lose a community password, lose the community. That's the point of the gate.
- **Spam-resistance is your firewall + your trust boundary.** Public hosting without access control will get spammed.

These are design choices, not bugs to fix later. Trade them for a server you fully own.

---

## Tech stack + license

| Layer | Technology |
|---|---|
| Web | Next.js 14 (App Router), TypeScript, Tailwind |
| Relay | Socket.io, Node 20+ |
| Chat crypto | TweetNaCl (Curve25519 + XSalsa20-Poly1305) |
| Wash crypto | Web Crypto (P-256 ECDH and PBKDF2 + AES-256-GCM) |
| Directory DB | SQLite via Prisma |
| Identifiers | base58 |

Full crypto explainer: <http://your-server/how-it-works>.

MIT — see [LICENSE](LICENSE).
