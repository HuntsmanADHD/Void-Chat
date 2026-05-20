/**
 * Void Chat - Moderation Components
 *
 * Community-driven moderation: every member is equal.
 * Reports accumulate per-community. At threshold, user is auto-kicked.
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
