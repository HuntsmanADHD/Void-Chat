'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Copy, Eye, Key, Shield, Trash2 } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { destroyActiveSession } from '@/lib/messageStore';

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

export default function SettingsPage() {
  const router = useRouter();
  const { session, displayName, setDisplayName, isReady } = useSession();
  const [draftName, setDraftName] = useState(displayName);

  useEffect(() => setDraftName(displayName), [displayName]);

  const handleBack = useCallback(() => router.push('/app'), [router]);

  const handleSaveName = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== displayName) setDisplayName(trimmed);
  }, [draftName, displayName, setDisplayName]);

  const handleEndSession = useCallback(async () => {
    // In ephemeral mode there is no "logout" — wiping sessionStorage
    // drops the keypair, dropping the IndexedDB wipes message history,
    // and reloading regenerates a fresh identity.
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
