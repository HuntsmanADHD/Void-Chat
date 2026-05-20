/**
 * Format utilities for Void Chat
 *
 * Provides consistent formatting for public IDs and other data across the app.
 */

/**
 * Format a public ID for display
 * Public IDs are already human-readable, so return as-is
 */
export function formatPublicId(publicId: string): string {
  return publicId;
}

/**
 * Truncate a public ID or identifier for compact display
 * Shows first 6 and last 4 characters with ellipsis
 */
export function truncateWallet(id: string, startLen = 6, endLen = 4): string {
  if (!id) return '';
  if (id.length <= startLen + endLen + 3) return id;
  return `${id.slice(0, startLen)}...${id.slice(-endLen)}`;
}
