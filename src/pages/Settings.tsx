import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Download, Eye, Globe, Key, Shield, Trash2, Upload } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { destroyActiveSession } from '@/lib/messageStore';
import { useTorStatus } from '@/hooks/useTorStatus';
import { useProxyStatus } from '@/hooks/useProxyStatus';
import { clearWashIdentity } from '@/lib/wash';
import {
  buildEncryptedBackup,
  downloadBackupFile,
  MIN_BACKUP_PASSPHRASE_LEN,
  readBackupFile,
  restoreFromEncryptedBackup,
} from '@/lib/onionBackup';

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-800/50 rounded-xl border border-zinc-700/50 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-700/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center">
            <Icon className="w-5 h-5 text-zinc-300" />
          </div>
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            {description && <p className="text-sm text-zinc-400">{description}</p>}
          </div>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  copyable = false,
  monospace = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  monospace?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);
  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-700/50 last:border-b-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-sm text-white truncate max-w-[16rem] ${monospace ? 'font-mono' : ''}`}
          title={value}
        >
          {value}
        </span>
        {copyable && (
          <button
            onClick={handleCopy}
            className="p-1 text-zinc-500 hover:text-white transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline UI for configuring Tor bridges (obfs4 / vanilla). Shown only
 * inside the desktop app. The textarea takes one bridge line per row;
 * Apply saves the file and restarts Tor with the new torrc.
 *
 * Stall watchdog → user adds bridges here → tor restarts using them →
 * censored-network bootstrap succeeds. End-to-end recovery without
 * leaving the app.
 */
function BridgesSection() {
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState('');
  const [hasObfs4, setHasObfs4] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const [current, obfs4] = await Promise.all([
          invoke<string>('tor_get_bridges'),
          invoke<boolean>('tor_has_obfs4proxy'),
        ]);
        if (cancelled) return;
        setDraft(current);
        setOriginal(current);
        setHasObfs4(obfs4);
        if (current.trim().length > 0) setExpanded(true);
      } catch (err) {
        if (!cancelled) console.warn('[bridges] could not load state', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleApply = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('tor_set_bridges', { bridgesText: draft });
      setOriginal(draft);
      setSuccess(
        draft.trim().length === 0
          ? 'Bridges cleared. Tor is restarting in direct-connection mode.'
          : 'Bridges saved. Tor is restarting — watch the bootstrap progress above.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply bridges.');
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const isDirty = draft !== original;
  const bridgeCount = draft.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;

  return (
    <SettingsSection
      title="Tor bridges"
      description="Use bridges if your ISP or country blocks direct connections to the Tor network."
      icon={Shield}
    >
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="text-sm text-zinc-400 hover:text-white underline"
        >
          Configure bridges
        </button>
      ) : (
        <div className="space-y-3">
          {success && (
            <div className="p-3 bg-emerald-900/20 border border-emerald-800/50 rounded-lg text-sm text-emerald-300">
              {success}
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg text-sm text-red-300">
              {error}
            </div>
          )}
          {hasObfs4 === false && (
            <div className="p-3 bg-amber-900/20 border border-amber-800/50 rounded-lg text-xs text-amber-200">
              <code>obfs4proxy</code> isn&apos;t installed — only plain (non-obfuscated) bridges will
              work. Install it: <code>pacman -S obfs4proxy</code> /{' '}
              <code>apt install obfs4proxy</code> / <code>brew install obfs4proxy</code>.
            </div>
          )}
          <p className="text-xs text-zinc-500">
            One bridge per line. Get fresh bridges from{' '}
            <a
              href="https://bridges.torproject.org"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-zinc-300"
            >
              bridges.torproject.org
            </a>
            . Lines starting with <code>#</code> are ignored.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="obfs4 192.0.2.10:443 ABCDEF...FINGERPRINT cert=... iat-mode=0"
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs font-mono text-zinc-200 placeholder:text-zinc-600"
            disabled={busy}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              {bridgeCount === 0
                ? 'No bridges configured (direct connection)'
                : `${bridgeCount} bridge${bridgeCount === 1 ? '' : 's'} configured`}
            </span>
            <button
              onClick={handleApply}
              disabled={busy || !isDirty}
              className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {busy ? 'Restarting Tor…' : 'Apply & restart Tor'}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * Inline UI for backing up + restoring the v3 hidden service identity.
 * Sits below the Hidden Service section once the onion is reachable.
 * Two flows:
 *   - Back up: passphrase + confirm → calls Rust to read keys →
 *     wash-encrypts → triggers file download.
 *   - Restore: file picker → passphrase → unwash → calls Rust to
 *     replace keys + restart Tor. New hostname appears in tor://status.
 */
function OnionBackupSection({ hostname }: { hostname: string }) {
  const [mode, setMode] = useState<'idle' | 'backup' | 'restore'>('idle');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMode('idle');
    setPass('');
    setConfirm('');
    setRestoreFile(null);
    setError(null);
    setSuccess(null);
  }, []);

  const handleStartBackup = useCallback(() => {
    reset();
    setMode('backup');
  }, [reset]);

  const handleStartRestore = useCallback(async () => {
    reset();
    try {
      const content = await readBackupFile();
      setRestoreFile(content);
      setMode('restore');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read file.');
    }
  }, [reset]);

  const handleBackupConfirm = useCallback(async () => {
    setError(null);
    if (pass.length < MIN_BACKUP_PASSPHRASE_LEN) {
      setError(`Passphrase must be at least ${MIN_BACKUP_PASSPHRASE_LEN} characters.`);
      return;
    }
    if (pass !== confirm) {
      setError('Passphrases do not match.');
      return;
    }
    setBusy(true);
    try {
      const washed = await buildEncryptedBackup(pass);
      downloadBackupFile(washed, hostname);
      setSuccess('Backup downloaded. Store it somewhere safe — the passphrase is the only thing protecting it.');
      setMode('idle');
      setPass('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBusy(false);
    }
  }, [pass, confirm, hostname]);

  const handleRestoreConfirm = useCallback(async () => {
    setError(null);
    if (!restoreFile) {
      setError('No backup file loaded.');
      return;
    }
    if (!pass) {
      setError('Enter the passphrase used when this backup was created.');
      return;
    }
    setBusy(true);
    try {
      const restored = await restoreFromEncryptedBackup(restoreFile, pass);
      setSuccess(`Restored. Your .onion is now ${restored.hostname}. Tor is restarting — give it a moment to re-bootstrap.`);
      setMode('idle');
      setPass('');
      setRestoreFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  }, [restoreFile, pass]);

  return (
    <SettingsSection
      title="Backup & restore identity"
      description="Save your .onion secret key so you can recover it on a new device or after a reinstall."
      icon={Shield}
    >
      {success && (
        <div className="mb-4 p-3 bg-emerald-900/20 border border-emerald-800/50 rounded-lg text-sm text-emerald-300">
          {success}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-800/50 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {mode === 'idle' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={handleStartBackup}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            Back up identity
          </button>
          <button
            onClick={handleStartRestore}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors border border-zinc-700"
          >
            <Upload className="w-4 h-4" />
            Restore from backup
          </button>
        </div>
      )}

      {mode === 'backup' && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            The backup file is encrypted with this passphrase. Without it the file is useless — and
            unrecoverable. Pick something memorable and write it down separately.
          </p>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={`Passphrase (≥ ${MIN_BACKUP_PASSPHRASE_LEN} chars)`}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
            disabled={busy}
            autoFocus
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm passphrase"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
            disabled={busy}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={reset}
              disabled={busy}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBackupConfirm}
              disabled={busy}
              className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {busy ? 'Encrypting…' : 'Download backup'}
            </button>
          </div>
        </div>
      )}

      {mode === 'restore' && (
        <div className="space-y-3">
          <div className="p-3 bg-amber-900/20 border border-amber-800/50 rounded-lg text-sm text-amber-300">
            Restoring overwrites your current .onion. Anyone holding invites to your old address
            will no longer be able to reach you.
          </div>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Passphrase for this backup"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
            disabled={busy}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={reset}
              disabled={busy}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRestoreConfirm}
              disabled={busy}
              className="px-4 py-2 text-sm bg-amber-600/20 hover:bg-amber-600/30 disabled:opacity-50 text-amber-200 rounded-lg transition-colors border border-amber-800/50"
            >
              {busy ? 'Restoring…' : 'Overwrite & restart Tor'}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { session, displayName, setDisplayName, isReady } = useSession();
  const tor = useTorStatus();
  const proxy = useProxyStatus();
  const [draftName, setDraftName] = useState(displayName);

  useEffect(() => setDraftName(displayName), [displayName]);

  const handleBack = useCallback(() => navigate('/app'), [navigate]);

  const handleSaveName = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== displayName) setDisplayName(trimmed);
  }, [draftName, displayName, setDisplayName]);

  const [washRotated, setWashRotated] = useState(false);
  const handleRotateWash = useCallback(() => {
    clearWashIdentity();
    setWashRotated(true);
    // Visual confirmation only — the new identity is generated lazily
    // on next wash operation (passphrase encrypt or SubPub seal).
    setTimeout(() => setWashRotated(false), 3000);
  }, []);

  const handleEndSession = useCallback(async () => {
    if (typeof window === 'undefined') return;
    await destroyActiveSession().catch(() => {});
    sessionStorage.clear();
    window.location.assign('/');
  }, []);

  if (!isReady || !session) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <p className="text-zinc-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-black">
      <header className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={handleBack}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold text-white">Settings</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <SettingsSection title="Session Identity" description="Your tab's ephemeral keypair" icon={Key}>
          <div className="space-y-1">
            <InfoRow label="Display name" value={displayName} />
            <InfoRow label="Signing key (ed25519)" value={session.signingPublicKey} copyable monospace />
            <InfoRow label="Box key (curve25519)" value={session.boxPublicKey} copyable monospace />
            <InfoRow label="Created" value={new Date(session.createdAt).toLocaleString()} />
          </div>
          <div className="mt-6 flex items-center gap-2">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={32}
              className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
              placeholder="Display name"
            />
            <button
              onClick={handleSaveName}
              disabled={!draftName.trim() || draftName.trim() === displayName}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              Save
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Display names are not unique and not authenticated. Anyone can pick the same name.
          </p>
        </SettingsSection>

        <SettingsSection
          title="Hidden service"
          description={
            tor.available
              ? 'Your inbound .onion address. Share it with peers so they can reach you over Tor.'
              : 'Tor is only available in the desktop app.'
          }
          icon={Globe}
        >
          {tor.available ? (
            tor.hostname ? (
              <div className="space-y-1">
                <InfoRow label="Onion address" value={tor.hostname} copyable monospace />
                <InfoRow label="Bootstrap" value="100% — ready" />
                {tor.bridgesEnabled && (
                  <InfoRow label="Connection" value="Using bridges (censored-network mode)" />
                )}
                {tor.restartCount > 0 && (
                  <InfoRow
                    label="Auto-restarts"
                    value={`${tor.restartCount} this session — Tor crashed and was respawned`}
                  />
                )}
              </div>
            ) : tor.error ? (
              <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-lg">
                <p className="text-sm text-red-300">{tor.error}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">
                    {tor.stalled ? 'Bootstrap stalled' : 'Bootstrapping…'}
                  </span>
                  <span className="text-zinc-300 tabular-nums">{tor.bootstrapPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      tor.stalled
                        ? 'bg-gradient-to-r from-amber-700 to-amber-500'
                        : 'bg-gradient-to-r from-zinc-500 to-zinc-300'
                    }`}
                    style={{ width: `${Math.max(tor.bootstrapPct, 2)}%` }}
                  />
                </div>
                {tor.stalled ? (
                  <div className="p-3 bg-amber-900/20 border border-amber-800/50 rounded-lg text-xs text-amber-200">
                    Bootstrap hasn&apos;t advanced in 30+ seconds. Your network may be blocking
                    Tor directory authorities. Try adding bridges below.
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">
                    First start takes 30–60 seconds while Tor downloads consensus and builds circuits.
                  </p>
                )}
                {tor.restartCount > 0 && (
                  <p className="text-xs text-amber-400">
                    Tor has auto-restarted {tor.restartCount}× this session.
                  </p>
                )}
              </div>
            )
          ) : (
            <p className="text-sm text-zinc-500">
              Run the desktop build (<code>yarn tauri:dev</code>) to get a hidden service.
            </p>
          )}
        </SettingsSection>

        {proxy.available && proxy.error && (
          <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg">
            <p className="text-sm font-semibold text-red-200 mb-1">Cross-host comms disabled</p>
            <p className="text-xs text-red-300">{proxy.error}</p>
            <p className="text-xs text-red-300/70 mt-2">
              Local communities still work; joining a remote .onion will fail until this is fixed.
              Most common cause: another process is holding port 11811. Check with{' '}
              <code>ss -tlnp | grep 11811</code> and kill the conflicting process.
            </p>
          </div>
        )}

        {tor.available && <BridgesSection />}

        {tor.available && tor.hostname && (
          <OnionBackupSection hostname={tor.hostname} />
        )}

        <SettingsSection
          title="What's persisted"
          description="The honest list of what survives — and what doesn't"
          icon={Shield}
        >
          <div className="space-y-1">
            <InfoRow label="Private keys" value="Tab sessionStorage — gone on tab close" />
            <InfoRow label="Display name" value="localStorage — survives tab close" />
            <InfoRow label="Messages (server)" value="Never persisted — relay-only" />
            <InfoRow label="Messages (your device)" value="Memory only — gone on reload" />
            <InfoRow label="Identity" value="Regenerated every tab open" />
          </div>
          <div className="mt-6 p-4 bg-emerald-900/20 border border-emerald-800/50 rounded-lg flex items-start gap-3">
            <Eye className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-emerald-400 mb-1">Zero knowledge by design</h4>
              <p className="text-sm text-zinc-300">
                The relay only sees ciphertext addressed to specific recipients. Nothing is decrypted
                server-side. Nothing is written to disk.
              </p>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Rotate Wash identity"
          description="Drop your SubPub keypair without ending the chat session"
          icon={Key}
        >
          <p className="text-sm text-zinc-400 mb-4">
            Your Wash SubPub key is what people encrypt to when they send you
            washed blobs out-of-band. If you sent your public key to someone
            you later don&apos;t trust, rotate — a new keypair generates on
            the next Wash operation. Your chat identity is not affected.
          </p>
          <button
            onClick={handleRotateWash}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg transition-colors"
          >
            <Key className="w-4 h-4" />
            {washRotated ? 'Rotated — next Wash uses a fresh key' : 'Rotate Wash key'}
          </button>
        </SettingsSection>

        <SettingsSection
          title="End session"
          description="Drop this keypair and reload with a fresh one"
          icon={Trash2}
        >
          <p className="text-sm text-zinc-400 mb-4">
            Clears your sessionStorage and reloads. You&apos;ll get a brand new identity and lose all
            in-memory messages.
          </p>
          <button
            onClick={handleEndSession}
            className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            End Session
          </button>
        </SettingsSection>

        <div className="text-center pt-8 pb-16 space-y-2">
          <p className="text-sm text-zinc-500">Void Chat v0.1.0 — ephemeral</p>
          <div className="flex items-center justify-center gap-4 text-xs text-zinc-500">
            <a href="/how-it-works" className="hover:text-white transition-colors underline">
              How the encryption works
            </a>
            <a href="/wash" className="hover:text-white transition-colors underline">
              Wash a phrase
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
