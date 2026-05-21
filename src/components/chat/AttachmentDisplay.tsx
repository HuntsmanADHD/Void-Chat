'use client';

/**
 * AttachmentDisplay — STUB for the ephemeral pivot.
 *
 * File attachments need server storage which the ephemeral model doesn't
 * provide. Returns null until P2P file sharing is wired up.
 */

import type { AttachmentResponse } from '@/types/api';

interface AttachmentDisplayProps {
  attachment: AttachmentResponse;
  onDownload?: (attachment: AttachmentResponse) => void;
  decryptedUrl?: string | null;
  isDecrypting?: boolean;
}

export function AttachmentDisplay(_props: AttachmentDisplayProps): null {
  return null;
}

export default AttachmentDisplay;
