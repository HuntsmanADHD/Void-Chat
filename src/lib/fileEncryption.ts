/**
 * File encryption utilities for Void Chat
 *
 * Stubbed out — file sharing will be P2P in a future update.
 * These exports prevent import errors from components that reference them.
 */

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_TYPES: Record<string, string[]> = {
  'image': ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  'video': ['video/mp4', 'video/webm'],
  'audio': ['audio/mpeg', 'audio/ogg', 'audio/wav'],
  'document': ['application/pdf', 'text/plain'],
};

const ALL_ALLOWED = Object.values(ALLOWED_TYPES).flat();

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  if (!ALL_ALLOWED.includes(file.type)) {
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

export function encryptFileData(
  _data: ArrayBuffer,
  _key: Uint8Array
): { encryptedData: Uint8Array; nonce: string } | null {
  // Stub — P2P file sharing not yet implemented
  return null;
}

export function getFileKeyForChannel(_channelKey: string): Uint8Array | null {
  return null;
}

export function deriveFileKeyForDM(
  _senderSecretKey: string,
  _recipientPublicKey: string
): Uint8Array | null {
  return null;
}
