# Void Chat

A privacy-focused, Web3-native messaging platform built on Solana. Your wallet is your identity, your messages are end-to-end encrypted, and community moderation is transparent and accountable.

## Overview

Void Chat is a Discord/Telegram alternative that combines:
- **Solana wallet authentication** - No passwords, no email, just your wallet
- **End-to-end encryption** - Messages encrypted client-side with TweetNaCl
- **Token-gated communities** - Access controlled by $CLAWED token holdings
- **X/Twitter verification** - Optional identity linking for accountability
- **Transparent moderation** - 3-strike system with clear rules

## Features

### Core Messaging
- Real-time messaging via WebSocket (Socket.io)
- End-to-end encrypted direct messages
- Community channels with token-gating
- P2P direct communication via WebRTC
- Typing indicators and online status

### Authentication & Identity
- Phantom, Solflare, and other Solana wallet support
- Message signing for wallet ownership verification
- Optional X/Twitter account linking
- Verified holder badges based on token tiers

### Privacy & Security
- TweetNaCl encryption (nacl.box for asymmetric, nacl.secretbox for symmetric)
- Private keys never leave the client (stored in IndexedDB)
- Public keys stored server-side for message routing
- No plaintext message storage on servers

### Token Integration
- $CLAWED token balance verification via Helius API
- Token-gated community access (minimum hold requirements)
- Cached balance checks (5-minute TTL)
- Holder tier badges displayed on profiles

### Moderation System
- Community-driven reporting system
- 3-strike progressive discipline:
  - **Strike 1**: Warning + 24-hour timeout from reporting community
  - **Strike 2**: 7-day platform-wide timeout
  - **Strike 3**: Permanent wallet blacklist
- Report categories: Spam, Harassment, Scam, Illegal, Other
- Admin review panel for report management

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend | Next.js API Routes, Prisma ORM |
| Database | PostgreSQL |
| Blockchain | Solana (@solana/web3.js, @solana/wallet-adapter) |
| Encryption | TweetNaCl |
| Real-time | Socket.io |
| P2P | WebRTC via simple-peer |
| Auth | Wallet signatures + NextAuth (X OAuth) |

## Prerequisites

Before you begin, ensure you have:

- **Node.js** >= 18.0.0
- **npm** or **yarn** or **pnpm**
- **PostgreSQL** >= 14 (or use Prisma Postgres)
- **Solana wallet** (Phantom, Solflare, etc.)
- **Helius API key** (free tier available at [helius.dev](https://www.helius.dev/))
- **X/Twitter Developer App** (optional, for identity verification)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/HuntsmanADHD/Void-Chat.git
cd Void-Chat
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your actual values.

### 4. Set up the database

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5. Run the application

```bash
# Run both Next.js and Socket.io server
npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
void-chat/
├── prisma/              # Database schema
├── server/              # Socket.io server
├── src/
│   ├── app/             # Next.js App Router pages & API routes
│   ├── components/      # React components
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # Utility functions
│   └── types/           # TypeScript types
```

## Security Features

- End-to-end encryption with TweetNaCl
- Wallet-based authentication (no passwords)
- Token gating for community access
- 3-strike moderation system

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with privacy in mind. Your keys, your messages.
