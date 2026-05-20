import { FC, ReactNode } from 'react';

interface WalletProviderProps {
  children: ReactNode;
}

/**
 * WalletProvider - passthrough component
 *
 * Solana wallet adapters have been removed.
 * Auth is now handled via local NaCl keypairs in useAuth.
 * This component is kept as a passthrough for backward compatibility.
 */
export const WalletProvider: FC<WalletProviderProps> = ({ children }) => {
  return <>{children}</>;
};

export default WalletProvider;
