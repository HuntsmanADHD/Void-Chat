# Void Chat

Privacy-focused, Solana-powered messaging platform. Discord/Telegram alternative with end-to-end encryption. Utilizing the best elements from telegram and discord.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript 5, Tailwind CSS
- **Backend**: Next.js API Routes, Socket.io server (separate process)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Solana wallet signatures, X/Twitter OAuth (NextAuth)
- **Encryption**: TweetNaCl (nacl.box for DMs, nacl.secretbox for files)
- **Real-time**: Socket.io + WebRTC (simple-peer) for P2P messaging
- **Blockchain**: Solana Web3.js, $CLAWED token gating via Helius API

## Commands

```bash
npm run dev          # Next.js dev server (port 3000)
npm run socket       # Socket.io server (port 3001)
npm run dev:all      # Both servers concurrently
npm run build        # Production build
npm run lint         # ESLint
npx prisma studio    # Database GUI
npx prisma migrate dev  # Run migrations
npx prisma generate  # Regenerate client
```

## Architecture

```
src/
├── app/                 # Next.js App Router
│   ├── api/             # API routes
│   ├── app/             # Main app pages
│   └── auth/            # Auth flow pages
├── components/          # React components
├── hooks/               # Custom hooks
├── lib/                 # Core logic
└── types/               # TypeScript types

server/
└── socket-server.ts     # Standalone Socket.io server
```

## Moderation System

- Strike 1: Warning + 24hr community timeout
- Strike 2: 7-day platform-wide timeout
- Strike 3: Permanent wallet blacklist
