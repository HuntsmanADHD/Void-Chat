/**
 * Clawed Messenger - Moderation Components
 *
 * Components for the 3-strike moderation system:
 * - Strike 1: Warning + 24hr timeout
 * - Strike 2: 7-day platform-wide timeout
 * - Strike 3: Permanent blacklist
 */

// Report Modal - For submitting reports against users
export { ReportModal } from './ReportModal';
export type { ReportModalProps, ReportSubmission, ReportCategory } from './ReportModal';

// Report Button - Small flag icon that opens ReportModal
export {
  ReportButton,
  MessageReportButton,
  ProfileReportButton,
  ReportMenuItem,
} from './ReportButton';
export type { ReportButtonProps } from './ReportButton';

// Strike Indicator - Display user's strike count with visual indicators
export {
  StrikeIndicator,
  CompactStrikeIndicator,
  StrikeBadge,
  BlacklistIndicator,
} from './StrikeIndicator';
export type { StrikeIndicatorProps, StrikeInfo } from './StrikeIndicator';

// Admin Panel - Admin interface for reviewing and managing reports
export { AdminPanel } from './AdminPanel';
export type {
  AdminPanelProps,
  Report,
  ReportUser,
  ReportMessage,
  ReportStatus,
} from './AdminPanel';
