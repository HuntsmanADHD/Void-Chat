import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Eye, EyeOff, KeyRound, Sparkles } from 'lucide-react';
import {
  getOrCreateWashIdentity,
  isWashed,
  unwash,
  wash,
  washForRecipient,
  washMode,
} from '@/lib/wash';

type Direction = 'wash' | 'unwash';
type WashMode = 'passphrase' | 'subpub';

export interface WashWidgetProps {
  /** Compact rendering for in-modal use (no big intro). */
  compact?: boolean;
}

/**
 * The Wash UI as a reusable widget. Both the standalone /wash page and
 * the in-app WashModal mount this. Mode toggles + intelligent defaults
 * keep the form tight: pasting a wash blob auto-flips to Unwash mode,
 * filling the recipient SubPub auto-selects asymmetric mode.
 */
export function WashWidget({ compact = false }: WashWidgetProps) {
  const [direction, setDirection] = useState<Direction>('wash');
  const [mode, setMode] = useState<WashMode>('passphrase');
  const [input, setInput] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [recipientPub, setRecipientPub] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedPub, setCopiedPub] = useState(false);

  const [mySubPub, setMySubPub] = useState<string | null>(null);
  const [subpubError, setSubpubError] = useState<string | null>(null);

  // Lazy-load this session's SubPub on first render.
  useEffect(() => {
    getOrCreateWashIdentity()
      .then((id) => setMySubPub(id.publicKeyB58))
      .catch((err) => setSubpubError(err instanceof Error ? err.message : 'Could not generate SubPub'));
  }, []);

  // Auto-flip to Unwash if the input pastes as a known blob.
  useEffect(() => {
    if (direction === 'wash' && isWashed(input.trim())) {
      setDirection('unwash');
      // The blob already encodes which mode to use — passphrase fields
      // remain available if the blob is the v1 (passphrase) flavor.
      const detected = washMode(input.trim());
      if (detected) setMode(detected);
    }
  }, [input, direction]);

  // Auto-select subpub mode when the user fills a recipient.
  useEffect(() => {
    if (direction === 'wash' && recipientPub.trim()) setMode('subpub');
  }, [recipientPub, direction]);

  const handleRun = useCallback(async () => {
    setError(null);
    setOutput('');
    setCopied(false);
    const trimmed = input.trim();
    if (!trimmed) {
      setError(direction === 'wash' ? 'Type or paste a phrase to wash' : 'Paste a wash blob');
      return;
    }

    setBusy(true);
    try {
      if (direction === 'wash') {
        if (mode === 'subpub') {
          if (!recipientPub.trim()) {
            setError('Paste the recipient’s SubPub');
            return;
          }
          setOutput(await washForRecipient(input, recipientPub.trim()));
        } else {
          if (!passphrase) {
            setError('A passphrase is required for passphrase mode');
            return;
          }
          setOutput(await wash(input, passphrase));
        }
      } else {
        // Unwash auto-routes by blob prefix; passphrase only used for v1 blobs.
        const detected = washMode(trimmed);
        if (detected === 'passphrase' && !passphrase) {
          setError('Passphrase required for this blob');
          return;
        }
        const result = await unwash(trimmed, passphrase);
        if (result === null) {
          setError(
            detected === 'subpub'
              ? 'Could not unwash — was this blob washed for your SubPub?'
              : 'Could not unwash — wrong passphrase or corrupted blob',
          );
        } else {
          setOutput(result);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  }, [direction, mode, input, passphrase, recipientPub]);

  const copyToClipboard = useCallback(
    async (text: string, setFlag: (v: boolean) => void) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setFlag(true);
        setTimeout(() => setFlag(false), 1500);
      } catch {
        // ignore
      }
    },
    [],
  );

  return (
    <div className="space-y-5">
      {!compact && (
        <div className="text-sm text-zinc-400 space-y-2">
          <p>
            <strong className="text-zinc-200">Wash plain text.</strong> A second, independent
            encryption layer for things you&apos;ll send <em>outside</em> Void Chat — invite
            codes, community passwords, a phrase you want to dictate over the phone safely.
            Inside Void Chat, every message is already encrypted; you don&apos;t need wash for
            normal chatting.
          </p>
          <p className="text-xs text-zinc-500">
            Wash uses Web Crypto AES-256-GCM, with the key derived either from a passphrase
            (PBKDF2-SHA256) or from an ECDH-P-256 handshake against a recipient&apos;s SubPub.
            That&apos;s a different cryptographic family from the chat protocol (NaCl &nbsp;
            <code>box</code>: Curve25519 + XSalsa20-Poly1305). If someone breaks one layer, the
            other still stands.
          </p>
        </div>
      )}

      {/* SubPub identity card */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-zinc-800 flex items-center justify-center">
            <KeyRound className="w-3.5 h-3.5 text-zinc-300" />
          </div>
          <span className="text-sm font-medium text-white">Your SubPub</span>
          <span className="text-xs text-zinc-500">P-256 wash key, fresh this tab</span>
        </div>
        {subpubError ? (
          <p className="text-xs text-red-400">{subpubError}</p>
        ) : mySubPub ? (
          <div className="flex items-start gap-2">
            <code className="flex-1 px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-emerald-300 font-mono break-all">
              {mySubPub}
            </code>
            <button
              onClick={() => copyToClipboard(mySubPub, setCopiedPub)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded transition-colors"
              title="Copy SubPub to clipboard"
            >
              {copiedPub ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copiedPub ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Generating…</p>
        )}
        <p className="text-xs text-zinc-500">
          Share this with someone so they can wash a phrase that only you can unwash. SubPubs are
          regenerated every tab, like your chat identity.
        </p>
      </div>

      {/* Direction toggle */}
      <div className="flex items-center gap-1 border border-zinc-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => {
            setDirection('wash');
            setOutput('');
            setError(null);
          }}
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            direction === 'wash' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Wash
        </button>
        <button
          onClick={() => {
            setDirection('unwash');
            setOutput('');
            setError(null);
          }}
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            direction === 'unwash' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Unwash
        </button>
      </div>

      {/* Mode toggle, only meaningful when washing */}
      {direction === 'wash' && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Mode:</span>
          <button
            onClick={() => setMode('passphrase')}
            className={`px-2 py-1 rounded transition-colors ${
              mode === 'passphrase' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Passphrase
          </button>
          <button
            onClick={() => setMode('subpub')}
            className={`px-2 py-1 rounded transition-colors ${
              mode === 'subpub' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Recipient SubPub
          </button>
        </div>
      )}

      {/* Input */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-zinc-400">
          {direction === 'wash' ? 'Phrase to wash' : 'Washed blob'}
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            direction === 'wash'
              ? 'Paste an invite code, password, or any phrase…'
              : 'Paste a void$wash$… blob'
          }
          rows={3}
          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-600 font-mono text-sm resize-vertical focus:outline-none focus:ring-2 focus:ring-zinc-500"
        />
      </div>

      {/* Conditional fields */}
      {direction === 'wash' && mode === 'subpub' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-zinc-400">Recipient SubPub</label>
          <input
            value={recipientPub}
            onChange={(e) => setRecipientPub(e.target.value)}
            placeholder="Paste their SubPub (base58 P-256 public key)"
            spellCheck={false}
            autoComplete="off"
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-600 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
          />
        </div>
      )}

      {((direction === 'wash' && mode === 'passphrase') ||
        (direction === 'unwash' && washMode(input.trim()) !== 'subpub')) && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-zinc-400">Passphrase</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Share through a different channel than the blob"
              autoComplete="off"
              className="w-full px-3 py-2 pr-10 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500"
            />
            <button
              type="button"
              onClick={() => setShowPass((p) => !p)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
              tabIndex={-1}
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={busy || !input.trim()}
        className="w-full py-2.5 px-4 bg-gradient-to-r from-zinc-700 via-zinc-600 to-zinc-500 hover:from-zinc-600 hover:via-zinc-500 hover:to-zinc-400 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2"
      >
        {busy ? 'Working…' : direction === 'wash' ? 'Wash' : 'Unwash'}
        {!busy && <ArrowRight className="w-4 h-4" />}
      </button>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {output && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-zinc-400">
              {direction === 'wash' ? 'Washed blob (send this)' : 'Recovered phrase'}
            </label>
            <button
              onClick={() => copyToClipboard(output, setCopied)}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg font-mono text-xs text-emerald-300 break-all whitespace-pre-wrap">
            {output}
          </div>
        </div>
      )}

      {!compact && (
        <div className="pt-2 text-xs text-zinc-500 space-y-1.5">
          <p>
            <Sparkles className="w-3 h-3 inline mr-1 text-zinc-400" />
            <strong>Send the passphrase / SubPub via a different channel</strong> than the blob.
            Both halves in one place defeats the layer.
          </p>
          <p>
            <Link to="/how-it-works" className="underline text-zinc-400 hover:text-white">
              How the chat encryption works
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

export default WashWidget;
