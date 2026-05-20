import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Key, Copy, Check, AlertTriangle, ChevronRight } from 'lucide-react';
import { SoulArtCanvas } from '@/components/auth/SoulArtCanvas';
import { useAuth } from '@/hooks/useAuth';

/**
 * Account creation flow — the identity ceremony.
 *
 * Step 1: Generate keypair, show private key ONCE
 * Step 2: User confirms they wrote it down
 * Step 3: User picks a permanent public ID
 * Step 4: User draws their soul art
 * Step 5: Submit → account created
 */

type Step = 'generate' | 'confirm' | 'choose-id' | 'soul-art' | 'creating' | 'done';

export default function CreateAccountPage() {
  const navigate = useNavigate();
  const { createAccount } = useAuth();

  const [step, setStep] = useState<Step>('generate');
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [publicId, setPublicId] = useState('');
  const [publicIdError, setPublicIdError] = useState<string | null>(null);
  const [artHash, setArtHash] = useState<string | null>(null);
  const [artData, setArtData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Step 1: Generate keypair
  const generateKeys = useCallback(() => {
    const keypair = nacl.sign.keyPair();
    const privKey = bs58.encode(keypair.secretKey);
    const pubKey = bs58.encode(keypair.publicKey);
    setPrivateKey(privKey);
    setPublicKey(pubKey);
    setStep('confirm');
  }, []);

  // Copy private key
  const copyKey = useCallback(async () => {
    if (!privateKey) return;
    try {
      await navigator.clipboard.writeText(privateKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS
      const textarea = document.createElement('textarea');
      textarea.value = privateKey;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [privateKey]);

  // Validate public ID
  const validatePublicId = useCallback((id: string) => {
    setPublicId(id);
    if (id.length === 0) {
      setPublicIdError(null);
      return;
    }
    if (id.length < 3) {
      setPublicIdError('Must be at least 3 characters');
      return;
    }
    if (id.length > 32) {
      setPublicIdError('Must be 32 characters or less');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      setPublicIdError('Only letters, numbers, _ and - allowed');
      return;
    }
    setPublicIdError(null);
  }, []);

  // Handle art completion
  const handleArtComplete = useCallback((hash: string, data: string) => {
    setArtHash(hash);
    setArtData(data);
  }, []);

  // Submit account creation
  const handleCreate = useCallback(async () => {
    if (!privateKey || !publicId || !artHash) return;

    setStep('creating');
    setError(null);

    try {
      const success = await createAccount(privateKey, publicId, artHash);
      if (success) {
        // Store art data locally (user's device only, never sent to server)
        try {
          localStorage.setItem(`void_soul_art_${publicId}`, artData || '');
        } catch {
          // localStorage might be full or disabled
        }
        setStep('done');
      } else {
        setError('Account creation failed. The public ID may be taken.');
        setStep('soul-art');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account creation failed');
      setStep('soul-art');
    }
  }, [privateKey, publicId, artHash, artData, createAccount]);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full">

        {/* Step 1: Generate */}
        {step === 'generate' && (
          <div className="text-center space-y-8">
            <div>
              <Key className="w-16 h-16 mx-auto text-purple-400 mb-4" />
              <h1 className="text-2xl font-bold mb-2">Create Your Identity</h1>
              <p className="text-gray-400 text-sm leading-relaxed">
                Your identity in the Void is a single cryptographic key.
                You get one. Ever. If you lose it, it&apos;s gone forever.
                There is no recovery, no reset, no second chance.
              </p>
            </div>

            <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="text-left text-sm text-yellow-200/80">
                  <p className="font-medium text-yellow-200 mb-1">This is permanent</p>
                  <p>You will be shown your private key exactly once.
                     Write it down on paper. Do not screenshot it.
                     Do not save it digitally. Paper only.</p>
                </div>
              </div>
            </div>

            <button
              onClick={generateKeys}
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 transition-colors"
            >
              Generate My Key
            </button>
          </div>
        )}

        {/* Step 2: Show key + confirm */}
        {step === 'confirm' && privateKey && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Your Private Key</h1>
              <p className="text-gray-400 text-sm">
                Write this down. Right now. On paper.
              </p>
            </div>

            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
              <div className="font-mono text-sm text-purple-300 break-all leading-relaxed select-all">
                {privateKey}
              </div>
              <button
                onClick={copyKey}
                className="mt-3 flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy to clipboard'}
              </button>
            </div>

            <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4">
              <p className="text-sm text-red-200/80">
                After you leave this screen, this key will never be shown again.
                If you lose it, your identity is gone permanently.
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 w-4 h-4 accent-purple-500"
              />
              <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                I have written down my private key on paper and understand
                that losing it means losing my identity forever.
              </span>
            </label>

            <button
              onClick={() => setStep('choose-id')}
              disabled={!confirmed}
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 3: Choose public ID */}
        {step === 'choose-id' && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Choose Your Name</h1>
              <p className="text-gray-400 text-sm">
                This is your public identity. Like a birth certificate you get to write yourself.
                Choose carefully — it can never be changed.
              </p>
            </div>

            <div>
              <input
                type="text"
                value={publicId}
                onChange={(e) => validatePublicId(e.target.value)}
                placeholder="your-name-here"
                maxLength={32}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 font-mono text-lg"
                autoFocus
              />
              {publicIdError && (
                <p className="text-red-400 text-xs mt-2">{publicIdError}</p>
              )}
              <p className="text-gray-500 text-xs mt-2">
                {publicId.length}/32 — Letters, numbers, underscore, hyphen only
              </p>
            </div>

            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400">
                This name is permanent. It&apos;s how others will find and recognize you.
                It carries the same weight as your key — it is you.
              </p>
            </div>

            <button
              onClick={() => setStep('soul-art')}
              disabled={!publicId || publicId.length < 3 || !!publicIdError}
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 4: Soul Art */}
        {step === 'soul-art' && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Make Your Mark</h1>
              <p className="text-gray-400 text-sm">
                Draw something. Anything. This is your soul art — your proof of humanity.
                It&apos;s baked into your identity and stored only on your device.
              </p>
              <p className="text-gray-500 text-xs mt-2">
                If you are ever cast out from the Void, this is what remains.
              </p>
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <SoulArtCanvas
              onArtComplete={handleArtComplete}
              disabled={false}
            />

            {artHash && (
              <button
                onClick={handleCreate}
                className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-500 transition-colors"
              >
                Enter the Void
              </button>
            )}
          </div>
        )}

        {/* Step 5: Creating */}
        {step === 'creating' && (
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <h1 className="text-xl font-bold">Forging your identity...</h1>
            <p className="text-gray-400 text-sm">
              Binding key, name, and art into one.
            </p>
          </div>
        )}

        {/* Step 6: Done */}
        {step === 'done' && (
          <div className="text-center space-y-6">
            <div className="text-5xl mb-4">&#x2726;</div>
            <h1 className="text-2xl font-bold">Welcome to the Void</h1>
            <p className="text-gray-400 text-sm">
              Your identity has been forged. You are <span className="text-purple-400 font-mono">{publicId}</span>.
            </p>

            {artData && (
              <div className="flex justify-center">
                <img
                  src={artData}
                  alt="Your soul art"
                  className="w-32 h-32 rounded-lg border border-gray-700"
                />
              </div>
            )}

            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400">
                Guard your private key. There are no second chances.
              </p>
            </div>

            <button
              onClick={() => navigate('/app')}
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 transition-colors"
            >
              Enter
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
