/**
 * Prisma Client Singleton
 *
 * Connection pool size is configured via the DATABASE_URL connection string.
 * Append ?connection_limit=<N>&pool_timeout=<seconds> to DATABASE_URL.
 * Example: postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=10
 */

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

export default prisma;
