import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Key, Shield, AlertTriangle, Copy, Check, RefreshCw, ExternalLink, LogOut, Skull } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useEncryption } from '@/hooks/useEncryption';

function SettingsSection({ title, description, icon: Icon, children }: { title: string; description?: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-800/50 rounded-xl border border-zinc-700/50 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-700/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center"><Icon className="w-5 h-5 text-zinc-300" /></div>
          <div><h3 className="font-semibold text-white">{title}</h3>{description && (<p className="text-sm text-zinc-400">{description}</p>)}</div>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, copyable = false, monospace = false }: { label: string; value: string; copyable?: boolean; monospace?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }, [value]);
  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-700/50 last:border-b-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm text-white ${monospace ? 'font-mono' : ''}`}>{value}</span>
        {copyable && (<button onClick={handleCopy} className="p-1 text-zinc-500 hover:text-white transition-colors" title="Copy to clipboard">{copied ? (<Check className="w-4 h-4 text-emerald-400" />) : (<Copy className="w-4 h-4" />)}</button>)}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { publicId, isAuthenticated, isBlacklisted, logout } = useAuth();
  const { isInitialized, hasKeypair, publicKey, getOrCreateKeyPair, clearKeyPair } = useEncryption();
  const [isRegeneratingKeys, setIsRegeneratingKeys] = useState(false);
  const [showKeyWarning, setShowKeyWarning] = useState(false);

  useEffect(() => { if (!isAuthenticated) { navigate('/'); } }, [isAuthenticated, navigate]);
  useEffect(() => { if (isAuthenticated && !isInitialized) { getOrCreateKeyPair(); } }, [isAuthenticated, isInitialized, getOrCreateKeyPair]);

  const handleBack = useCallback(() => { navigate('/app'); }, [navigate]);
  const handleSignOut = useCallback(() => { logout(); navigate('/'); }, [logout, navigate]);

  const handleRegenerateKeys = useCallback(async () => {
    if (!showKeyWarning) { setShowKeyWarning(true); return; }
    setIsRegeneratingKeys(true);
    try { clearKeyPair(); await getOrCreateKeyPair(); setShowKeyWarning(false); } catch (error) { console.error('Failed to regenerate keys:', error); } finally { setIsRegeneratingKeys(false); }
  }, [showKeyWarning, clearKeyPair, getOrCreateKeyPair]);

  const handleCancelRegenerate = useCallback(() => { setShowKeyWarning(false); }, []);
  const formatId = (id: string) => { if (id.length <= 12) return id; return `${id.slice(0, 6)}...${id.slice(-4)}`; };

  if (!isAuthenticated) {
    return (<div className="h-screen w-screen flex items-center justify-center bg-black"><div className="text-center"><div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-700 via-zinc-600 to-zinc-500 flex items-center justify-center mb-4 mx-auto animate-pulse border border-zinc-500/30"><span className="text-zinc-100 font-bold text-2xl">C</span></div><p className="text-zinc-400">Loading...</p></div></div>);
  }

  return (
    <div className="min-h-screen bg-[var(--discord-bg)]">
      <header className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={handleBack} className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"><ArrowLeft className="w-5 h-5" /></button>
          <h1 className="text-xl font-bold text-white">Settings</h1>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <SettingsSection title="Identity" description="Your keypair is your identity" icon={Key}>
          <div className="space-y-1">
            <InfoRow label="Public ID" value={publicId || 'Not authenticated'} copyable={!!publicId} monospace />
            <InfoRow label="Display ID" value={publicId ? formatId(publicId) : 'N/A'} />
            <InfoRow label="Authentication Status" value={isAuthenticated ? 'Authenticated' : 'Not authenticated'} />
          </div>
          <div className="mt-6"><button onClick={handleSignOut} className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"><LogOut className="w-4 h-4" />Sign Out</button></div>
        </SettingsSection>

        <SettingsSection title="Encryption Keys" description="Manage your end-to-end encryption keys" icon={Key}>
          <div className="space-y-1">
            <InfoRow label="Key Status" value={hasKeypair ? 'Generated' : 'Not generated'} />
            {publicKey && (<InfoRow label="Public Key" value={`${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`} copyable monospace />)}
            <InfoRow label="Private Key Storage" value="Local device only" />
          </div>
          {showKeyWarning ? (
            <div className="mt-6 p-4 bg-red-900/30 border border-red-800 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-red-400 mb-1">Warning: Key Regeneration</h4>
                      <p className="text-sm text-zinc-300 mb-4">Regenerating your encryption keys will make all your previous messages unreadable. This action cannot be undone.</p>
                  <div className="flex items-center gap-3">
                    <button onClick={handleRegenerateKeys} disabled={isRegeneratingKeys} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50">{isRegeneratingKeys ? 'Regenerating...' : 'Confirm Regenerate'}</button>
                    <button onClick={handleCancelRegenerate} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg transition-colors">Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <button onClick={handleRegenerateKeys} className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"><RefreshCw className="w-4 h-4" />Regenerate Keys</button>
              <p className="mt-2 text-xs text-zinc-500">Only regenerate keys if you suspect they have been compromised.</p>
            </div>
          )}
        </SettingsSection>

        <SettingsSection title="Security & Privacy" description="Your data protection settings" icon={Shield}>
          <div className="space-y-1">
            <InfoRow label="End-to-End Encryption" value="Enabled" />
            <InfoRow label="Message Storage" value="Encrypted on server" />
            <InfoRow label="Private Key Location" value="Your device only" />
            <InfoRow label="P2P Messaging" value="Enabled when available" />
          </div>
          <div className="mt-6 p-4 bg-emerald-900/20 border border-emerald-800/50 rounded-lg">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div><h4 className="font-medium text-emerald-400 mb-1">Your Privacy is Protected</h4><p className="text-sm text-zinc-300">All messages are encrypted client-side before being sent. Your private keys never leave your device. Even Void Chat cannot read your messages.</p></div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title="The Void Wall" description="Platform-wide ban transparency" icon={Skull}>
          <p className="text-sm text-zinc-400 mb-4">
            View users who have been banned by community consensus. Bans are transparent — everyone can see who was banned and why.
          </p>
          <button
            onClick={() => navigate('/app/bans')}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
          >
            <Skull className="w-4 h-4" />
            View Ban Wall
          </button>
        </SettingsSection>

        {isBlacklisted && (
          <div className="p-6 bg-red-900/30 border border-red-800 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div><h3 className="font-semibold text-red-400 mb-1">Account Restricted</h3><p className="text-sm text-zinc-300">Your account has been blacklisted due to violations of community guidelines. You cannot send messages or join communities. If you believe this is an error, please contact support.</p></div>
            </div>
          </div>
        )}

        <div className="text-center pt-8 pb-16">
          <p className="text-sm text-zinc-500">Void Chat v0.1.0</p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <a href="#" className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">Documentation<ExternalLink className="w-3 h-3" /></a>
            <a href="#" className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">Support<ExternalLink className="w-3 h-3" /></a>
          </div>
        </div>
      </main>
    </div>
  );
}
