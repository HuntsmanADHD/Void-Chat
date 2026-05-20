/**
 * AppProviders Component
 *
 * Combines all context providers needed by Void Chat:
 * - ErrorBoundary: Error handling and fallback UI
 * - WalletProvider: Auth provider passthrough
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
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * AppProviders Component
 *
 * Provider composition for the entire application.
 * Order matters: ErrorBoundary is outermost for error handling, WalletProvider is primary auth.
 */
export const AppProviders: FC<AppProvidersProps> = ({ children }) => {
  return (
    <ErrorBoundary showDetails={import.meta.env.DEV}>
      <WalletProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </WalletProvider>
    </ErrorBoundary>
  );
};

export default AppProviders;
