/**
 * Onion identity backup + restore wrapper.
 *
 * Audit pt6 H7: encrypt + decrypt happen Rust-side now. The renderer
 * passes the passphrase to the IPC and receives the already-washed
 * blob; the raw `.onion` secret key never lands in JS heap memory.
 * Previously the secret was returned to JS, JSON-stringified, then
 * passphrase-encrypted via `src/lib/wash.ts` — that gave an XSS
 * window between IPC return and Wash encrypt to exfil the plaintext.
 *
 * The Wash blob format (PBKDF2-SHA256 + AES-256-GCM, `void$wash$v1$`
 * prefix) is identical between the JS and Rust implementations, so
 * backups produced before this change still restore.
 *
 * Security note: the raw payload contains the v3 secret key — anyone
 * who possesses it can impersonate this .onion. The passphrase is the
 * ONLY thing standing between a leaked backup file and identity theft.
 * Pick a strong one; both the UI and Rust enforce a minimum length.
 */

interface TorBackupBlob {
  /** Encrypted backup ready to download — `void$wash$v1$...` */
  washed: string;
  /** Hostname returned alongside so the renderer can build the filename. */
  hostname: string;
}

export const MIN_BACKUP_PASSPHRASE_LEN = 12;

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Ask Rust to read the hidden-service keys and encrypt them with the
 *  passphrase. Returns the washed blob + hostname; the renderer writes
 *  the blob verbatim to a `.washed` file. */
export async function buildEncryptedBackup(passphrase: string): Promise<TorBackupBlob> {
  if (!inTauri()) throw new Error('Backups are only available in the desktop app.');
  if (passphrase.length < MIN_BACKUP_PASSPHRASE_LEN) {
    throw new Error(
      `Passphrase must be at least ${MIN_BACKUP_PASSPHRASE_LEN} characters — this protects your identity if the file leaks.`,
    );
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<TorBackupBlob>('tor_backup_keys', { passphrase });
}

/** Hand the washed blob + passphrase to Rust, which decrypts, prompts
 *  for native confirmation, and atomically replaces the local key
 *  files + restarts Tor. Returns the new .onion hostname so the UI
 *  can show what's now active. */
export async function restoreFromEncryptedBackup(
  washedString: string,
  passphrase: string,
): Promise<string> {
  if (!inTauri()) throw new Error('Restore is only available in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('tor_restore_keys', {
    washed: washedString.trim(),
    passphrase,
  });
}

/** Trigger a browser download of `content` as a file. Uses the standard
 *  blob+anchor pattern that works in both Tauri's webview and browsers. */
export function downloadBackupFile(content: string, hostname: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Filename: voidchat-onion-<first-8-of-hostname>-<YYYYMMDD>.washed
  const short = hostname.split('.')[0]!.slice(0, 8);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.download = `voidchat-onion-${short}-${date}.washed`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Firefox doesn't cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker and resolve with the file contents as text. */
export function readBackupFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.washed,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('No file selected.'));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsText(file);
    };
    input.click();
  });
}
