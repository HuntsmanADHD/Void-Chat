# Void Chat

A privacy-first desktop messenger that routes everything through Tor hidden services. You run it on your own machine, your friends reach you at your `.onion` address, and what's said in the void stays in the void.

No accounts. No email. No password. No history. Every browser tab generates a fresh cryptographic identity that disappears when you close it.

---

## Table of contents

1. [What you're getting](#what-youre-getting)
2. [Step-by-step: from zero to running Void Chat](#step-by-step-from-zero-to-running-void-chat)
   - [1. Install the OS-level prerequisites](#1-install-the-os-level-prerequisites)
   - [2. Install Rust](#2-install-rust)
   - [3. Install Node 25 and Yarn 4](#3-install-node-25-and-yarn-4)
   - [4. Clone the repo](#4-clone-the-repo)
   - [5. Install the JS dependencies](#5-install-the-js-dependencies)
   - [6. Create the SQLite database](#6-create-the-sqlite-database)
   - [7. Launch the app](#7-launch-the-app)
3. [What happens on first launch](#what-happens-on-first-launch)
4. [Inviting friends over Tor](#inviting-friends-over-tor)
5. [Joining someone else's chat](#joining-someone-elses-chat)
6. [Back up your `.onion` identity](#back-up-your-onion-identity)
7. [Day-to-day commands](#day-to-day-commands)
8. [Honest limitations](#honest-limitations)
9. [Tech stack + license](#tech-stack--license)

---

## What you're getting

| What | Where it lives | When it's gone |
|---|---|---|
| Your private keys | Browser sessionStorage | The tab closes |
| Your display name | Browser localStorage | You clear it |
| Messages — in flight | Relay RAM, microseconds | Forwarded and forgotten |
| Messages — your local copy | Browser IndexedDB | You "End Session" or wipe browser data |
| Community + channel directory | A single SQLite file | You delete it |
| Your `.onion` address | Tor's hidden-service key file | You delete the `app_data_dir` — back it up first |

The relay decrypts nothing. The SQLite file holds only the names of communities and channels — no messages, no users. Tor handles the network: your friends reach you at a `.onion` address that doesn't leak your IP, and they don't have to be on your network, your VPN, or pay for tunneling.

You also get **Wash**, a separate off-Void encryption tool (different cipher family from the chat protocol) for sharing invite codes, passwords, or any phrase through channels you don't fully trust.

---

## Step-by-step: from zero to running Void Chat

You'll install five things — system libraries, Rust, Node, the repo, and the dependencies — then run one command. Total time: 10–30 minutes depending on your machine and connection.

### 1. Install the OS-level prerequisites

Void Chat is a [Tauri 2](https://tauri.app) desktop app. Tauri uses your OS's native webview, plus a few system libraries for things like image rendering. It also needs `tor` itself on your `PATH` for the hidden service.

**Arch Linux:**
```bash
sudo pacman -S --needed base-devel curl wget file openssl \
                        appmenu-gtk-module libappindicator-gtk3 \
                        librsvg webkit2gtk-4.1 tor
```

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
                    libxdo-dev libssl-dev libayatana-appindicator3-dev \
                    librsvg2-dev tor
```

**Fedora:**
```bash
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file \
                    libappindicator-gtk3-devel librsvg2-devel tor
```

**macOS:**
```bash
xcode-select --install   # Apple's command-line tools, includes the C toolchain
# Install Homebrew first if you don't have it: https://brew.sh
brew install tor
```

**Windows:**

- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (select the "Desktop development with C++" workload).
- The Microsoft Edge WebView2 runtime is bundled with Windows 11; on Windows 10 install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
- Tor: download the [Tor Expert Bundle](https://www.torproject.org/download/tor/), extract it, and add the `tor` directory to your `PATH` so `tor --version` works in a fresh terminal.

### 2. Install Rust

Tauri's shell is written in Rust. Use the official installer:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

On Windows: download `rustup-init.exe` from <https://rustup.rs> and run it.

Restart your terminal, then verify:
```bash
rustc --version    # should print 1.77 or later
cargo --version
```

### 3. Install Node 25 and Yarn 4

We use Node 25 via `nvm` and Yarn 4 via Corepack (the version manager Node ships with).

**Linux / macOS:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# Close and reopen your terminal so nvm is on PATH
nvm install 25
nvm use 25
corepack enable
```

**Windows:** install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases), then in a fresh terminal:
```powershell
nvm install 25
nvm use 25
corepack enable
```

Verify:
```bash
node --version    # v25.x
yarn --version    # 4.x  (the first run inside the repo will pin to 4.15.0)
```

### 4. Clone the repo

```bash
git clone https://github.com/HuntsmanADHD/Void-Chat.git
cd Void-Chat
```

### 5. Install the JS dependencies

```bash
yarn install
```

First run pulls Tauri's Rust dependencies in addition to the npm packages, so it takes longer than a normal `yarn install` — anywhere from 1 to 5 minutes depending on your CPU.

### 6. Create the SQLite database

The relay (`server/socket-server.ts`) needs an empty schema in `data/voidchat.db`. The repo ships an empty file; one command writes the tables into it:

```bash
DATABASE_URL='file:../data/voidchat.db' npx prisma db push --skip-generate
```

You should see `Your database is now in sync with your Prisma schema`. You only do this once.

### 7. Launch the app

```bash
yarn tauri:dev
```

First launch builds the entire Rust crate tree — expect a couple of minutes of `Compiling …` log lines. Subsequent launches are seconds.

When it finishes you'll get a native window titled **Void Chat**. The terminal will stream three things in parallel:

- **Vite** serving the UI on `:5173`
- **The relay** listening on `:3001` (HTTP API + socket.io)
- **Tor** bootstrapping (`[tor] Bootstrapped 5% → 100%` over 30–60 seconds)

When Tor hits 100% you'll see:
```
[tor] hidden service ready at <56-char>.onion
```

That `.onion` is your address. It's stable across restarts — the secret key persists in `~/.local/share/dev.voidchat.app/tor/hs/` (or the equivalent on macOS / Windows).

#### Linux-on-Wayland note

If `yarn tauri:dev` opens a white window or crashes with `Error 71 (Protocol error) dispatching to Wayland display`, the project's `tauri:dev` script already exports the two environment variables that fix this (`WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1`). If you're running `tauri dev` by hand for some reason, prepend those yourself or use `GDK_BACKEND=x11`.

---

## What happens on first launch

1. The Landing page renders with the "Enter Void" button.
2. Clicking through gives you a session keypair (ed25519 for signatures, Curve25519 for encryption) — both live in `sessionStorage`. They die when you close the window.
3. The onboarding modal explains what's persisted and what's not.
4. Settings → "Hidden service" shows your `.onion` (copy button) and Tor's bootstrap percentage.
5. From the dashboard you can create a community → channel → start chatting.

Single-machine use works immediately. To talk to someone else, see the next section.

---

## Inviting friends over Tor

This is the part the old README needed Tailscale, Cloudflare Tunnel, or your own domain for. With Tor it's a one-line copy:

1. Open the community you want to invite someone to.
2. Right-click the community name (top of the channel sidebar) → **Copy invite link**.
3. Paste it anywhere — chat, email, signal. The format is:
   ```
   <community-id>@<onion-address>
   ```
4. Hand the recipient that string. That's it. No DNS, no port forwarding, no static IP, no certificates.

If your `.onion` isn't ready yet (Tor still bootstrapping), the copied invite will be just the bare community ID — useful for same-machine joins but won't work cross-host. Wait for the Settings page to show 100% then copy again.

For **private** (password-gated) communities, share the password through a different channel than the invite. The Wash tool wraps a short string in an independent AES-GCM passphrase layer; sending the password washed to a public chat is safer than sending it plaintext.

---

## Joining someone else's chat

1. They send you `<id>@<onion>`.
2. Open Void Chat → dashboard → **Join community** → paste it.
3. If the community is private, the password prompt appears.
4. Behind the scenes: a local Rust forward proxy on `127.0.0.1:11811` opens a SOCKS5 connection to your local Tor on `127.0.0.1:19050`, dials the `<onion>:80` hidden service, and forwards your API + WebSocket traffic. The remote host never learns your IP; you never learn theirs. CORS for `.onion` origins is allowed unconditionally on both sides (if you can reach the relay through the hidden service, you already proved you have the address).

Your local Tor needs to be fully bootstrapped (Settings → 100%) before cross-host joins will work. Same-host joins (an invite where the onion matches your own) work whether Tor is up or not.

---

## Back up your `.onion` identity

Your `.onion` address is derived from a single 64-byte secret key stored in `~/.local/share/dev.voidchat.app/tor/hs/hs_ed25519_secret_key`. **If you lose that file, every invite ever shared at your old address becomes dead.** Back it up.

**To back up:**
- Settings → **Backup & restore identity** → **Back up identity**
- Enter a passphrase (minimum 12 characters) and confirm.
- A `voidchat-onion-<short>-<date>.washed` file downloads. Store it somewhere safe — the file is encrypted with your passphrase using the Wash cipher (AES-256-GCM + PBKDF2), but the passphrase is the only thing standing between a leaked copy and identity theft.

**To restore** (new machine, reinstall, etc.):
- Settings → **Backup & restore identity** → **Restore from backup**
- Pick the `.washed` file, enter the same passphrase, confirm the warning.
- Tor shuts down, the keys are atomically replaced, Tor restarts. Your `.onion` will reappear once it re-bootstraps.

---

## Day-to-day commands

```bash
# Launch the full stack (Vite + relay + Tauri window + Tor)
yarn tauri:dev

# Frontend-only iteration (no Tauri shell, browser at localhost:5173)
yarn dev

# Production-style build of the frontend only
yarn build

# Run just the relay (when iterating on server code)
yarn socket

# Type-check the whole project
yarn typecheck

# Build the production Tauri installer for your OS
yarn tauri:build
```

Stopping is `Ctrl+C` in the terminal that started `yarn tauri:dev`. Tauri sends `RunEvent::Exit` to the Rust side, which SIGTERMs the Tor child (with a 1.5-second grace before SIGKILL).

If you see orphan `tor` processes lingering between runs (`pgrep -a tor` shows one), kill them by PID before the next launch — a leftover Tor will hold ports 19050/19051 and the new one will silently fail to bind.

---

## Honest limitations

- **No display-name authentication.** Anyone can pick "alice." Recognize friends by their public key fingerprint (Settings shows yours), not by name.
- **No message history for new joiners.** You see what arrives after you connect. Past messages, even from yesterday, are gone.
- **No offline DMs.** Recipient not connected = the send fails with a banner. Channel messages similarly require the recipient to be online when you send.
- **Channel bandwidth is O(N).** A 50-person channel = your client encrypts 50 copies of every message. That's what zero-knowledge fan-out costs.
- **Tor latency.** First-hop SOCKS handshake + 3-hop circuit + hidden-service rendezvous = real round-trip cost vs. local relay. Expect 200ms–2s per request for cross-host.
- **Cross-host communities aren't surfaced in the sidebar yet.** Joining one navigates to it; reload the tab and you'll need to paste the invite again. (Tracked for the next iteration.)
- **No bridges for censored networks yet.** If your ISP blocks Tor directory authorities, bootstrap will stall under 100%. obfs4 + meek bridge support is in the hardening pass.

---

## Tech stack + license

- **UI:** React 18 + React Router 7 (Vite)
- **Desktop shell:** Tauri 2 (Rust)
- **Network:** Tor v3 hidden services, SOCKS5 forward proxy in Rust
- **Crypto:** [TweetNaCl](https://github.com/dchest/tweetnacl-js) for chat (Curve25519 + XSalsa20-Poly1305), Web Crypto for Wash (AES-256-GCM + PBKDF2)
- **Relay:** Node + socket.io, Prisma + SQLite for the directory
- **Build:** Yarn 4 (Corepack), TypeScript strict

License: MIT. Pull requests and forks welcome — see CONTRIBUTING (or just open an issue with what you'd like to change).
