/**
 * Onion identity backup + restore wrapper.
 *
 * The Rust side (src-tauri/src/tor.rs) reads the v3 hidden-service key
 * files into a JSON payload. This module passphrase-encrypts that
 * payload with the existing Wash cipher (AES-256-GCM via PBKDF2) and
 * downloads it as a `.washed` file the user can store anywhere.
 *
 * Restore is the same in reverse: read file, unwash with passphrase,
 * hand the payload back to Rust which atomically replaces the local
 * key files and restarts Tor.
 *
 * Security note: the raw payload contains the v3 secret key — anyone
 * who possesses it can impersonate this .onion. The passphrase is the
 * ONLY thing standing between a leaked backup file and identity theft.
 * Pick a strong one; the UI enforces a minimum length.
 */

import { wash, unwash } from './wash';

export interface TorBackup {
  publicKeyB64: string;
  secretKeyB64: string;
  hostname: string;
  formatVersion: number;
}

export const MIN_BACKUP_PASSPHRASE_LEN = 12;

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Read the local hidden-service keys, encrypt with the passphrase, and
 *  return the washed string ready for download. Throws if not in Tauri,
 *  if the passphrase is too short, or if the Rust read fails. */
export async function buildEncryptedBackup(passphrase: string): Promise<string> {
  if (!inTauri()) throw new Error('Backups are only available in the desktop app.');
  if (passphrase.length < MIN_BACKUP_PASSPHRASE_LEN) {
    throw new Error(
      `Passphrase must be at least ${MIN_BACKUP_PASSPHRASE_LEN} characters — this protects your identity if the file leaks.`,
    );
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const payload = await invoke<TorBackup>('tor_backup_keys');
  const json = JSON.stringify(payload);
  return wash(json, passphrase);
}

/** Decrypt a previously-built backup string and hand the keys to Rust
 *  for atomic restore + Tor restart. The new .onion appears in
 *  tor://status shortly after this resolves. */
export async function restoreFromEncryptedBackup(
  washedString: string,
  passphrase: string,
): Promise<TorBackup> {
  if (!inTauri()) throw new Error('Restore is only available in the desktop app.');
  const plaintext = await unwash(washedString.trim(), passphrase);
  if (plaintext === null) {
    throw new Error('Could not decrypt — wrong passphrase or corrupted backup.');
  }
  let parsed: TorBackup;
  try {
    parsed = JSON.parse(plaintext) as TorBackup;
  } catch {
    throw new Error('Decrypted payload is not a valid backup file.');
  }
  if (!parsed.publicKeyB64 || !parsed.secretKeyB64 || !parsed.hostname) {
    throw new Error('Backup file is missing required fields.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('tor_restore_keys', { backup: parsed });
  return parsed;
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
