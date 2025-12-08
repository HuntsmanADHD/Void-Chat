/**
 * Format utilities for Clawed Messenger
 *
 * Provides consistent formatting for wallet addresses and other data across the app.
 */

/**
 * Truncates a Solana wallet address for display
 * Shows first 4 and last 4 characters with ellipsis in between
 *
 * @param address - The full wallet address
 * @returns Truncated address (e.g., "Dzz1...xpmN")
 */
export function truncateWallet(address: string): string {
  if (!address) return '';
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Formats a token balance for display
 * Converts large numbers to readable format (K, M, B)
 *
 * @param balance - Token balance as bigint or number
 * @returns Formatted balance string (e.g., "1.5M", "500K")
 */
export function formatTokenBalance(balance: bigint | number): string {
  const num = typeof balance === 'bigint' ? Number(balance) : balance;
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}
