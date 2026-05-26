/**
 * Prisma Client Singleton
 */

// Set a default DATABASE_URL before importing PrismaClient — Prisma reads it
// at client construction. For Tauri builds this gets overridden with the
// per-install app data dir; for `yarn dev` / `yarn socket` it just works.
if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = 'file:../data/voidchat.db';
}

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown — close database connections on process exit
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
});
process.on('SIGINT', async () => {
  await prisma.$disconnect();
});

export default prisma;
