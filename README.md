# Void Chat

A privacy-first desktop messenger that routes everything through Tor hidden services. You run it on your own machine, your friends reach you at your `.onion` address, and what's said in the void stays in the void.

No accounts. No email. No password. No history. Every browser tab generates a fresh cryptographic identity that disappears when you close it.

<p align="center">
  <img src="public/Example%20Img/landing%20page.png" alt="Void Chat landing page" width="800" />
</p>

---

## Table of contents

1. [What you're getting](#what-youre-getting)
2. [Step-by-step: from zero to running Void Chat](#step-by-step-from-zero-to-running-void-chat)
   - [1. Install the OS-level prerequisites](#1-install-the-os-level-prerequisites)
   - [2. Install Rust](#2-install-rust)
   - [3. Install Node 25 and Yarn 4](#3-install-node-25-and-yarn-4)
   - [4. Clone the repo](#4-clone-the-repo)
   - [5. Install the JS dependencies](#5-install-the-js-dependencies)
   - [6. Fetch the bundled Tor runtime](#6-fetch-the-bundled-tor-runtime)
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
| Your display name | Browser sessionStorage | The tab closes |
| Messages — in flight | Relay RAM, microseconds | Forwarded and forgotten |
| Messages — your local copy | Browser IndexedDB | You "End Session" or wipe browser data |
| Community + channel directory | A single SQLite file | You delete it |
| Your `.onion` address | Tor's hidden-service key file | You delete the `app_data_dir` — back it up first |

The relay decrypts nothing. The SQLite file holds only the names of communities and channels — no messages, no users. Tor handles the network: your friends reach you at a `.onion` address that doesn't leak your IP, and they don't have to be on your network, your VPN, or pay for tunneling.

You also get **Wash**, a separate off-Void encryption tool (different cipher family from the chat protocol) for sharing invite codes, passwords, or any phrase through channels you don't fully trust.

<p align="center">
  <img src="public/Example%20Img/startingPage.png" alt="Dashboard / starting page" width="800" />
</p>

---

## Step-by-step: from zero to running Void Chat

You'll install six things — system libraries, Rust, Node, the repo, the JS dependencies, and the bundled Tor runtime — then run one command. Total time: 10–30 minutes depending on your machine and connection.

### 1. Install the OS-level prerequisites

Void Chat is a [Tauri 2](https://tauri.app) desktop app. Tauri uses your OS's native webview, plus a few system libraries for things like image rendering. Tor itself is **downloaded by the build** (step 6), so you don't need to install it system-wide.

**Arch Linux:**
```bash
sudo pacman -S --needed base-devel curl wget file openssl \
                        appmenu-gtk-module libappindicator-gtk3 \
                        librsvg webkit2gtk-4.1 \
                        gst-plugins-base gst-plugins-good
```

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
                    libxdo-dev libssl-dev libayatana-appindicator3-dev \
                    librsvg2-dev \
                    gstreamer1.0-plugins-base gstreamer1.0-plugins-good
```

**Fedora:**
```bash
sudo dnf install -y gcc gcc-c++ make \
                    webkit2gtk4.1-devel openssl-devel curl wget file \
                    libappindicator-gtk3-devel librsvg2-devel \
                    gstreamer1-plugins-base gstreamer1-plugins-good
```
(`gcc gcc-c++ make` is Fedora's equivalent of Ubuntu's `build-essential` — Rust needs a C linker. Fedora doesn't bundle one by default, so omitting these gives a `linker 'cc' not found` error the first time cargo compiles a crate.)

**Void Linux (glibc):**
```bash
sudo xbps-install -Sy base-devel pkg-config \
                      webkit2gtk-devel openssl-devel \
                      librsvg-devel libappindicator-devel \
                      gst-plugins-base1 gst-plugins-good1 \
                      curl wget file gnupg
```

> **About the GStreamer packages:** Void Chat doesn't play audio (no voice calls, no media). But WebKitGTK probes for an audio sink at webview startup and logs a noisy `GStreamer element autoaudiosink not found` + `GLib-GObject-CRITICAL: invalid (NULL) pointer instance` if the GStreamer plugin packages are missing. The app still runs without them — it's pure log spam — but installing `gst-plugins-base` + `gst-plugins-good` (or the distro equivalents above) silences it cleanly.

> **Use glibc Void, not musl Void.** The bundled Tor Expert Bundle from `scripts/fetch-tor-binaries.sh` is glibc-linked and won't load on musl (you'll get a confusing `Exec format error` or `not found`). On musl, skip the fetch script and `sudo xbps-install tor` instead — the runtime falls back to system tor on `PATH`. Some Rust crates (notably the `openssl` family) also need extra work on musl.

**macOS:**
```bash
xcode-select --install   # Apple's command-line tools, includes the C toolchain
```

**Windows:**

- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (select the "Desktop development with C++" workload).
- The Microsoft Edge WebView2 runtime is bundled with Windows 11; on Windows 10 install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).

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

We use Node 25 and Yarn 4. Recommended path is `nvm` + Corepack, but the repo ships its own Yarn 4 binary at `.yarn/releases/yarn-4.15.0.cjs` — so once you have *any* yarn on PATH, the project's `.yarnrc.yml` will defer to the bundled Yarn 4 the moment you `cd` into the directory.

**Recommended: nvm + Corepack (Linux / macOS):**
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

**Fallback if `corepack enable` says "command not found":** Fedora's `dnf install nodejs` doesn't include Corepack in the main package (it's a separate `corepack` package), and a few distro Node builds drop it entirely. Either install Corepack directly, or just bootstrap Yarn via npm:

```bash
# Fedora: corepack as a separate package
sudo dnf install -y corepack && corepack enable

# OR universal fallback — any yarn works, the project redirects to Yarn 4
npm install -g yarn
```

Verify (run inside the cloned repo after step 4):
```bash
node --version    # v25.x
yarn --version    # 4.15.0  ← if you see 1.x here, you're not inside the project dir
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

### 6. Fetch the bundled Tor runtime

Void Chat ships with its own Tor — no system install needed. The runtime (`tor` + libevent + OpenSSL + obfs4-compatible `lyrebird`) is downloaded from the [Tor Project](https://www.torproject.org/) via a one-shot script:

```bash
./scripts/fetch-tor-binaries.sh
```

This pulls the official Tor Expert Bundle for your host platform (Linux x86_64/aarch64, macOS x86_64/arm64, or Windows x86_64) and installs it to `src-tauri/binaries/tor-runtime/`. The directory is gitignored — re-run the script to refresh, or override the version with `TOR_VERSION=14.5.x ./scripts/fetch-tor-binaries.sh`.

> **This step is required to build, not just to run.** `tauri.conf.json` lists `binaries/tor-runtime` under `bundle.resources`, and Tauri's build script refuses to compile if a listed resource path doesn't exist on disk. Skipping this step gives you a confusing `resource path 'binaries/tor-runtime' doesn't exist` failure deep inside the cargo build. (The runtime separately falls back to a system `tor` on your `PATH` if the bundled one isn't started — but that's a runtime fallback, not a build one.)

> **About installers:** `yarn tauri:build` produces `.deb` / `.rpm` artifacts that bundle the frontend, the Rust shell, the Rust relay (now a sidecar), and the Tor binary into a single self-contained installer. v0.1 is still tagged a **source-run release** while the bundled installer gets wider testing — clone, install deps, `yarn tauri:dev` is the supported path. The artifacts produced by `yarn tauri:build` are now self-contained; if you choose to distribute them, expect them to behave as a v0.1.x preview.

### 7. Launch the app

```bash
yarn tauri:dev
```

First launch builds the entire Rust crate tree — expect a couple of minutes of `Compiling …` log lines (the relay crate is also compiled by `src-tauri`'s `build.rs` so it gets staged as a sidecar in the same step). Subsequent launches are seconds.

When it finishes you'll get a native window titled **Void Chat**. The terminal will stream three things in parallel:

- **Vite** serving the UI on `:5173`
- **The relay** sidecar listening on `:3001` (lines prefixed `[relay/stdout]`; HTTP API + socket.io)
- **Tor** bootstrapping (`[tor] Bootstrapped 5% → 100%` over 30–60 seconds)

The relay creates its SQLite database automatically on first run at `~/.local/share/dev.voidchat.app/voidchat.db` (or the OS-equivalent app data dir) — no separate `prisma db push` step.

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

<p align="center">
  <img src="public/Example%20Img/group.png" alt="Community / channel view inside a joined chat" width="800" />
</p>

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

# Run just the relay (when iterating on the Rust relay crate)
cd relay && cargo run

# Type-check the whole project
yarn typecheck

# Build the production Tauri artifacts for your OS.
# Self-contained as of v0.1 (Rust shell + Rust relay sidecar + Tor
# bundled). v0.1 is still tagged a source-run release while the
# bundled installer gets wider testing — see "Fetch the bundled Tor
# runtime" above.
yarn tauri:build
```

Stopping is `Ctrl+C` in the terminal that started `yarn tauri:dev`. Tauri sends `RunEvent::Exit` to the Rust side, which kills the relay sidecar and SIGTERMs the Tor child (with a 1.5-second grace before SIGKILL). On Linux the relay child is registered with `PR_SET_PDEATHSIG` so it also dies if the parent is SIGKILLed or crashes.

If a previous launch crashed before cleanup, you may see orphan processes holding the dev ports:
```bash
pgrep -a tor              # tor on 19050 / 19051
pgrep -a voidchat-relay   # relay on 3001 (macOS/Windows only — Linux auto-reaps)
```
Kill any survivors by PID before the next `yarn tauri:dev`. A leftover relay will hold `:3001` and the new one will silently fail to bind; you'll get CORS errors from a relay running without the dev origin allowlist.

---

## Honest limitations

- **No display-name authentication.** Anyone can pick "alice." Recognize friends by their public key fingerprint (Settings shows yours), not by name.
- **No message history for new joiners.** You see what arrives after you connect. Past messages, even from yesterday, are gone.
- **No offline DMs, no offline indicator.** Recipient not connected = the send is silently dropped (looks identical to "delivered but no reply" — that's intentional; the previous offline indicator was a presence oracle). Channel messages similarly require the recipient to be online when you send.
- **Channel bandwidth is O(N).** A 50-person channel = your client encrypts 50 copies of every message. That's what zero-knowledge fan-out costs.
- **Tor latency.** First-hop SOCKS handshake + 3-hop circuit + hidden-service rendezvous = real round-trip cost vs. local relay. Expect 200ms–2s per request for cross-host.
- **Cross-host communities aren't surfaced in the sidebar yet.** Joining one navigates to it; reload the tab and you'll need to paste the invite again. (Tracked for the next iteration.)
- **Bridges work out of the box** if you used the bundled Tor runtime (`scripts/fetch-tor-binaries.sh`) — the Expert Bundle ships `lyrebird`, the modern obfs4proxy replacement. Settings → "Tor bridges" lets you paste lines from <https://bridges.torproject.org>. If you skipped the script and are using a system Tor, install `obfs4proxy` separately: `pacman -S obfs4proxy` / `apt install obfs4proxy` / `brew install obfs4proxy`.
- **Windows file permissions on the .onion private key inherit the user-profile ACL.** On Linux and macOS we explicitly `chmod 0700` the HiddenServiceDir and `0600` the secret key file. On Windows the equivalent ACL hardening isn't applied — the key inherits whatever your user profile uses, which is usually fine for single-user machines but isn't equivalent to Unix's `0600`. Don't share a Windows user account with someone you wouldn't want impersonating your .onion.

---

## Tech stack + license

- **UI:** React 18 + React Router 7 (Vite)
- **Desktop shell:** Tauri 2 (Rust)
- **Network:** Tor v3 hidden services, SOCKS5 forward proxy in Rust
- **Crypto:** [TweetNaCl](https://github.com/dchest/tweetnacl-js) for chat (Curve25519 + XSalsa20-Poly1305), Web Crypto for Wash (AES-256-GCM + PBKDF2)
- **Relay:** Rust sidecar (axum + socketioxide + rusqlite/bundled SQLite), argon2id for community passwords. Spawned by the Tauri shell at startup.
- **Build:** Yarn 4 (Corepack), TypeScript strict; `src-tauri/build.rs` compiles the relay crate and stages it as a sidecar under `binaries/voidchat-relay-<target-triple>`

License: MIT. Pull requests and forks welcome — see CONTRIBUTING (or just open an issue with what you'd like to change).
