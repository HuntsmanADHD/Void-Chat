/**
 * Void Chat Server
 * Standalone Express + Socket.io relay server
 *
 * Run: npm run dev
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { prisma } from './lib/prisma.js';
import { initSocketServer } from './socket.js';

// Route imports
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import communityRoutes from './routes/communities.js';
import memberRoutes from './routes/members.js';
import channelRoutes from './routes/channels.js';
import searchRoutes from './routes/search.js';
import reportRoutes from './routes/reports.js';
import vouchRoutes from './routes/vouches.js';
import banRoutes from './routes/bans.js';

// =============================================================================
// ENVIRONMENT VALIDATION
// =============================================================================

function validateEnvironment(): void {
  const required: Record<string, string> = {
    'DATABASE_URL': 'PostgreSQL connection string',
    'AUTH_TOKEN_SECRET': 'Secret for signing auth tokens (min 32 chars)',
  };
  const missing: string[] = [];
  for (const [key, desc] of Object.entries(required)) {
    if (!process.env[key]) {
      missing.push(`  - ${key}: ${desc}`);
    }
  }
  if (missing.length > 0) {
    console.error('Missing required environment variables:\n' + missing.join('\n'));
    process.exit(1);
  }
  const secret = process.env.AUTH_TOKEN_SECRET!;
  if (secret.length < 32 || secret.includes('dev') || secret.includes('test')) {
    console.warn('[WARN] AUTH_TOKEN_SECRET appears to be a development value. Use a strong random secret in production.');
  }
}
validateEnvironment();

// =============================================================================
// CONFIG
// =============================================================================

const PORT = parseInt(process.env.PORT || '3001', 10);
const NODE_ENV = process.env.NODE_ENV || 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:1420'; // Tauri default dev port

// In production, only allow explicitly configured origins + Tauri.
// In development, also allow common localhost dev ports.
const ALLOWED_ORIGINS: string[] = NODE_ENV === 'development'
  ? [
      CORS_ORIGIN,
      'tauri://localhost',
      'https://tauri.localhost',
      'http://localhost:1420',
      'http://localhost:3000',
      'http://localhost:5173',
    ]
  : [
      CORS_ORIGIN,
      'tauri://localhost',
      'https://tauri.localhost',
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : []),
    ];

// =============================================================================
// EXPRESS APP
// =============================================================================

const app = express();

// Trust first proxy (e.g., nginx/cloudflare) so req.ip is accurate
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Tauri handles CSP client-side
  crossOriginEmbedderPolicy: false, // Allow Tauri webview resources
  frameguard: { action: 'deny' },
  noSniff: true,
}));

// CORS — conditional on NODE_ENV
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Public-Id',
    'X-Signature',
    'X-Auth-Message',
  ],
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// =============================================================================
// ROUTES
// =============================================================================

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/communities/:id/members', memberRoutes);
app.use('/api/communities/:id/channels', channelRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/communities/:communityId/vouches', vouchRoutes);
app.use('/api/bans', banRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// =============================================================================
// HTTP + SOCKET SERVER
// =============================================================================

const httpServer = createServer(app);
const io = initSocketServer(httpServer, CORS_ORIGIN);

// =============================================================================
// START
// =============================================================================

httpServer.listen(PORT, () => {
  console.log(`[Void Chat Server] Running on port ${PORT}`);
  console.log(`[Void Chat Server] CORS origins: tauri://localhost, ${CORS_ORIGIN}`);
  console.log(`[Void Chat Server] Socket.io attached`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('[Void Chat Server] Shutting down...');
  io.close(() => {
    httpServer.close(() => {
      prisma.$disconnect().then(() => {
        console.log('[Void Chat Server] Closed');
        process.exit(0);
      });
    });
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, httpServer, io };
