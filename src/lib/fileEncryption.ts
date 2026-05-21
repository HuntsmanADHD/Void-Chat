/**
 * File upload helpers — STUB for the ephemeral pivot.
 *
 * File attachments need server storage which the ephemeral model doesn't
 * provide. The buttons in MessageInput stay visible but uploads are no-ops
 * for now. Real file sharing will need a P2P channel or external storage.
 */

export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export const ALLOWED_TYPES: string[] = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav',
  'application/pdf', 'text/plain',
];

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'File type not allowed' };
  }
  return { valid: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
