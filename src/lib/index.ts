/**
 * Central exports for client-safe lib utilities. prisma is intentionally
 * NOT re-exported here — it's server-only and would bundle into the browser
 * if pulled through a barrel the React tree consumes.
 */

export { formatPublicId, truncatePublicId } from './format';
export {
  compressSmart,
  compressMessage,
  decompressMessage,
  gzipCompress,
  gzipDecompress,
  isLikelyPrecompressed,
  crc32,
  CorruptDataError,
  CHAT_DICTIONARY,
} from './compress';
