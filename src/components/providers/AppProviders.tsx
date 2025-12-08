'use client';

/**
 * AppProviders Component
 *
 * Combines all context providers needed by Clawed Messenger:
 * - ErrorBoundary: Error handling and fallback UI
 * - WalletProvider: Solana wallet connectivity (primary auth)
 * - NextAuthProvider: X OAuth session (verification layer)
 * - ToastProvider: Toast notifications
 *
 * Usage in layout.tsx:
 * ```tsx
 * import { AppProviders } from '@/components/providers/AppProviders';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <AppProviders>{children}</AppProviders>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */

import { FC, ReactNode } from 'react';
import { WalletProvider } from './WalletProvider';
import { NextAuthProvider } from './NextAuthProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import type { Session } from 'next-auth';

interface AppProvidersProps {
  children: ReactNode;
  /** Initial NextAuth session from server-side (optional) */
  session?: Session | null;
}

/**
 * AppProviders Component
 *
 * Provider composition for the entire application.
 * Order matters: ErrorBoundary is outermost for error handling, WalletProvider is primary auth.
 */
export const AppProviders: FC<AppProvidersProps> = ({ children, session }) => {
  return (
    <ErrorBoundary showDetails={process.env.NODE_ENV === 'development'}>
      <WalletProvider>
        <NextAuthProvider session={session}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </NextAuthProvider>
      </WalletProvider>
    </ErrorBoundary>
  );
};

export default AppProviders;
