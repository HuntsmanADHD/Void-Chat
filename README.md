# Void Chat

Anonymous, decentralized messaging. No accounts, no email, no recovery. Your identity is a cryptographic key you generate locally and keep yourself.

## What's different

- **No identity providers.** You generate a NaCl keypair on your device. The server stores only your `publicId` (a username you pick once and keep forever) and your public key. There is no password, no email, no OAuth, no SSO.
- **No central moderators.** There are no admins. Members of a community report bad actors; once a threshold of unique reporters is reached, the user is auto-kicked from that community. Kicked from three communities → automatic permanent platform ban. Every member has equal weight.
- **No recovery.** If you lose your private key, the account is gone. The server has no way to give it back to you because it never had it. The key is shown to you exactly once, at account creation.
- **Soul art.** During account creation, you draw a small piece of art that gets hashed into your identity. The image itself stays on your device. If you're ever cast out from the Void, the art is what remains as a marker.

## Identity flow

1. **Create**: client generates an ed25519 keypair (TweetNaCl). User is shown the raw private key once, picks a permanent `publicId` (3–32 chars, alphanumeric + `_-`), and draws a soul art canvas (≥3 strokes, ≥5 seconds). Server stores `{ publicId, publicKey, artHash }`. One key per lifetime — same key cannot register twice.
2. **Login**: user pastes their private key into the login page. Client signs a timestamped message (`Void Chat Login\ntimestamp: <ms>`), server verifies the signature against the stored public key. Session token issued (HMAC-SHA256, 24h).
3. **E2E messaging**: direct messages and channel content are encrypted client-side with `nacl.box` / `nacl.secretbox`. Server stores ciphertext only.

## Moderation

- Within a community: any member can file a report. Reports are stored but the running tally is hidden. When unique reporter count hits the community's threshold (default 5, configurable 1–100 by the owner), the user is auto-kicked. Anti-raid: only reports from members who joined the community *before* the reported user count toward the threshold.
- Across the platform: a user kicked from three communities is permanently blacklisted. Fully automatic, no human review.
- No appeals. No strikes. No timeouts. No admin panel.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend (web) | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Frontend (desktop) | Vite + React + Tauri 2 *(in progress, in `client/`)* |
| Backend (current) | Next.js API routes + Prisma |
| Backend (rewrite) | Express + Socket.io + Helmet *(in progress, in `server/`)* |
| Database | PostgreSQL |
| Real-time | Socket.io |
| P2P | WebRTC via simple-peer |
| Crypto | TweetNaCl (ed25519 signing, Curve25519 boxes), @noble/ed25519 |
| Identifiers | base58 (bs58) |

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- npm (or pnpm/yarn)

## Setup

```bash
git clone https://github.com/HuntsmanADHD/Void-Chat.git
cd Void-Chat
npm install
cp .env.example .env
# edit .env: set DATABASE_URL, AUTH_TOKEN_SECRET (≥32 chars), ALLOWED_ORIGINS
npx prisma generate
npx prisma migrate dev --name init
npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000).

## Project layout

```
void-chat/
├── prisma/              # Database schema (User, Community, Channel, Membership,
│                        # Report, CommunityKick, Vouch)
├── server/              # Standalone Express + Socket.io backend (WIP)
├── client/              # Vite + React + Tauri desktop client (WIP)
├── server/socket-server.ts   # Original Next.js-paired Socket.io server
└── src/
    ├── app/             # Next.js App Router pages + API routes
    ├── components/      # React components
    ├── hooks/           # Custom hooks (useAuth, useRealtime, useEncryption, ...)
    ├── lib/             # auth, encryption, p2p, moderation, format
    └── types/           # TypeScript types
```

## Status

This codebase is mid-rework. See `PROGRESS.md` for what's done and what's next. Build state is not guaranteed to compile cleanly at every commit.

## License

MIT — see [LICENSE](LICENSE).
