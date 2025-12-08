'use client';

import { FC, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  formatWalletAddress,
  formatTokenBalance,
  getClawedTokenBalance,
} from '@/lib/solana';

interface WalletConnectProps {
  /** Show token balance next to wallet address */
  showBalance?: boolean;
  /** Callback when wallet connection state changes */
  onConnectionChange?: (connected: boolean, publicKey: string | null) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * WalletConnect component for connecting Solana wallets
 *
 * Features:
 * - WalletMultiButton for wallet selection
 * - Displays truncated wallet address when connected
 * - Shows $CLAWED token balance
 * - Dark theme styling matching Discord aesthetic
 */
export const WalletConnect: FC<WalletConnectProps> = ({
  showBalance = true,
  onConnectionChange,
  className = '',
}) => {
  const { publicKey, connected, connecting, disconnecting } = useWallet();
  const [tokenBalance, setTokenBalance] = useState<bigint>(BigInt(0));
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  // Fetch token balance when wallet connects
  useEffect(() => {
    const fetchBalance = async () => {
      if (!publicKey) {
        setTokenBalance(BigInt(0));
        return;
      }

      setIsLoadingBalance(true);
      try {
        const balance = await getClawedTokenBalance(publicKey.toBase58());
        setTokenBalance(balance);
      } catch (error) {
        console.error('Failed to fetch token balance:', error);
        setTokenBalance(BigInt(0));
      } finally {
        setIsLoadingBalance(false);
      }
    };

    fetchBalance();
  }, [publicKey]);

  // Notify parent of connection changes
  useEffect(() => {
    if (onConnectionChange) {
      onConnectionChange(connected, publicKey?.toBase58() || null);
    }
  }, [connected, publicKey, onConnectionChange]);

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Wallet Info Display */}
      {connected && publicKey && (
        <div className="flex items-center gap-3 px-3 py-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
          {/* Token Balance */}
          {showBalance && (
            <div className="flex items-center gap-1.5">
              <span className="text-amber-400 font-medium text-sm">
                $CLAWED
              </span>
              <span className="text-zinc-300 text-sm">
                {isLoadingBalance ? (
                  <span className="inline-block w-12 h-4 bg-zinc-700 animate-pulse rounded" />
                ) : (
                  formatTokenBalance(tokenBalance)
                )}
              </span>
            </div>
          )}

          {/* Divider */}
          {showBalance && (
            <div className="w-px h-5 bg-zinc-600" />
          )}

          {/* Wallet Address */}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-zinc-300 text-sm font-mono">
              {formatWalletAddress(publicKey.toBase58())}
            </span>
          </div>
        </div>
      )}

      {/* Connection Status Indicator */}
      {(connecting || disconnecting) && (
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <div className="w-4 h-4 border-2 border-zinc-600 border-t-amber-400 rounded-full animate-spin" />
          <span>{connecting ? 'Connecting...' : 'Disconnecting...'}</span>
        </div>
      )}

      {/* Wallet Multi Button with custom styling */}
      <WalletMultiButton
        style={{
          backgroundColor: '#3f3f46', // zinc-700
          color: '#fafafa', // zinc-50
          borderRadius: '0.5rem',
          fontWeight: 500,
          fontSize: '0.875rem',
          padding: '0.5rem 1rem',
          border: '1px solid #52525b', // zinc-600
          transition: 'all 150ms ease-in-out',
        }}
      />
    </div>
  );
};

/**
 * Compact version of WalletConnect for use in navigation/headers
 */
export const WalletConnectCompact: FC<{
  onConnectionChange?: (connected: boolean, publicKey: string | null) => void;
}> = ({ onConnectionChange }) => {
  const { publicKey, connected } = useWallet();
  const [tokenBalance, setTokenBalance] = useState<bigint>(BigInt(0));

  useEffect(() => {
    const fetchBalance = async () => {
      if (!publicKey) {
        setTokenBalance(BigInt(0));
        return;
      }

      try {
        const balance = await getClawedTokenBalance(publicKey.toBase58());
        setTokenBalance(balance);
      } catch (error) {
        console.error('Failed to fetch token balance:', error);
      }
    };

    fetchBalance();
  }, [publicKey]);

  useEffect(() => {
    if (onConnectionChange) {
      onConnectionChange(connected, publicKey?.toBase58() || null);
    }
  }, [connected, publicKey, onConnectionChange]);

  if (!connected || !publicKey) {
    return (
      <WalletMultiButton
        style={{
          backgroundColor: '#3f3f46',
          color: '#fafafa',
          borderRadius: '0.5rem',
          fontWeight: 500,
          fontSize: '0.75rem',
          padding: '0.375rem 0.75rem',
          border: '1px solid #52525b',
        }}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800 rounded-md">
        <span className="text-amber-400 text-xs font-medium">
          {formatTokenBalance(tokenBalance)}
        </span>
        <span className="text-zinc-500 text-xs">$CLAWED</span>
      </div>
      <WalletMultiButton
        style={{
          backgroundColor: '#3f3f46',
          color: '#fafafa',
          borderRadius: '0.5rem',
          fontWeight: 500,
          fontSize: '0.75rem',
          padding: '0.375rem 0.75rem',
          border: '1px solid #52525b',
        }}
      />
    </div>
  );
};

export default WalletConnect;
