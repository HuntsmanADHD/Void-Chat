/**
 * Central exports for React hooks
 */

export { useEncryption, useEncryptionReady } from './useEncryption';
export { useWalletAuth, useAuthHeaders } from './useWalletAuth';
export { useXAuth, useXVerification } from './useXAuth';

// Moderation hooks
export {
  useModeration,
  useCanAct,
  useStrikeDisplay,
} from './useModeration';
export type {
  UseModerationOptions,
  UseModerationReturn,
  ModerationStatus,
  StrikeInfo as ModerationStrikeInfo,
  ReportResult,
  ModerationError,
  ReportCategory as ModerationReportCategory,
} from './useModeration';

// Real-time messaging hooks
export { useRealtime } from './useRealtime';
export type { OnMessageReceived } from './useRealtime';

export { useP2P } from './useP2P';
export type { OnP2PMessage, OnP2PStateChange } from './useP2P';

// Notifications hook
export { useNotifications } from './useNotifications';

// Voice/Video call hook
export { useCall } from './useCall';

// API hook
export { useApi } from './useApi';
