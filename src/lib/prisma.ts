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

// Per audit M5: never log 'query'. Even in dev, query logs print
// community names + channel metadata to stdout, which then bleeds
// into terminal scrollback / bundled relay logs. The privacy model
// of the app means even directory metadata shouldn't leak via logs.
// 'error' alone is enough — schema problems still surface.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
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
