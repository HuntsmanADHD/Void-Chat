import { FC } from 'react';

interface WalletConnectProps {
  className?: string;
}

/**
 * WalletConnect placeholder
 *
 * Solana wallet adapters have been removed.
 * Auth is now handled via local NaCl keypairs in useAuth.
 * This component is kept as a placeholder for backward compatibility.
 */
export const WalletConnect: FC<WalletConnectProps> = ({ className = '' }) => {
  return (
    <div className={className}>
      {/* Auth handled by useAuth hook */}
    </div>
  );
};

export const WalletConnectCompact: FC = () => {
  return null;
};

export default WalletConnect;
