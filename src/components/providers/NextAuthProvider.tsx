'use client';

/**
 * NextAuth Session Provider
 *
 * Wraps the application with NextAuth's SessionProvider for X OAuth.
 * This enables useSession() hook throughout the application.
 *
 * Note: This is specifically for X account linking, not primary authentication.
 * Primary authentication remains wallet-based via Solana signatures.
 */

import { FC, ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';

interface NextAuthProviderProps {
  children: ReactNode;
  /** Initial session from server-side (optional) */
  session?: Session | null;
}

/**
 * NextAuthProvider Component
 *
 * Provides NextAuth session context for X OAuth integration.
 * Should wrap components that need access to X linking functionality.
 */
export const NextAuthProvider: FC<NextAuthProviderProps> = ({
  children,
  session,
}) => {
  return (
    <SessionProvider
      session={session}
      // Refetch session when window gains focus
      refetchOnWindowFocus={true}
      // Refetch session every 5 minutes
      refetchInterval={5 * 60}
    >
      {children}
    </SessionProvider>
  );
};

export default NextAuthProvider;
