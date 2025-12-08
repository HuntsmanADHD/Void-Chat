'use client';

import { FC, ReactNode, useMemo, useCallback } from 'react';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { WalletError } from '@solana/wallet-adapter-base';
import { clusterApiUrl } from '@solana/web3.js';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

interface WalletProviderProps {
  children: ReactNode;
}

/**
 * WalletProvider component that wraps the application with Solana wallet connectivity
 *
 * Configured wallets:
 * - Phantom: Most popular Solana wallet
 * - Solflare: Feature-rich alternative
 *
 * Uses Helius RPC if API key is available, otherwise falls back to public mainnet
 */
export const WalletProvider: FC<WalletProviderProps> = ({ children }) => {
  // Determine RPC endpoint
  // Uses NEXT_PUBLIC_SOLANA_RPC if configured, otherwise public mainnet
  // Note: Do NOT expose API keys via NEXT_PUBLIC_ - use the full RPC URL instead
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC;

    if (customRpc) {
      return customRpc;
    }

    return clusterApiUrl('mainnet-beta');
  }, []);

  // Initialize wallet adapters
  // These are the primary wallets supported by Clawed Messenger
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  // Handle wallet errors gracefully
  const onError = useCallback((error: WalletError) => {
    console.error('[Wallet Error]:', error.message);

    // You could add toast notifications here
    // toast.error(`Wallet error: ${error.message}`);
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider
        wallets={wallets}
        autoConnect={true}
        onError={onError}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
};

export default WalletProvider;
