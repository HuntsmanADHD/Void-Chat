import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Eye as EyeIcon,
  KeyRound,
  Lock,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } = naclUtil;

const SEEN_KEY = 'voidchat_onboarding_seen';

/** Has the user already dismissed the onboarding flow in this browser? */
export function hasSeenOnboarding(): boolean {
  if (typeof window === 'undefined') return true; // don't flash on SSR
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function markOnboardingSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // ignore quota / disabled
  }
}

export interface OnboardingModalProps {
  isOpen: boolean;
  /** The user's current display name, so step 1 can show "you are <name>." */
  displayName: string;
  onClose: () => void;
}

// ── Step 2 demo: a tiny version of the live encryption widget ────────────

function MiniEncryptionDemo() {
  const [text, setText] = useState('only bob can read this');
  const keys = useMemo(() => {
    const a = nacl.box.keyPair();
    const b = nacl.box.keyPair();
    return { aliceSec: a.secretKey, alicePub: a.publicKey, bobSec: b.secretKey, bobPub: b.publicKey };
  }, []);

  const sealed = useMemo(() => {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ct = nacl.box(decodeUTF8(text), nonce, keys.bobPub, keys.aliceSec);
    return ct ? { ciphertext: encodeBase64(ct), nonce: encodeBase64(nonce) } : null;
  }, [text, keys]);

  const decrypted = useMemo(() => {
    if (!sealed) return null;
    const opened = nacl.box.open(
      decodeBase64(sealed.ciphertext),
      decodeBase64(sealed.nonce),
      keys.alicePub,
      keys.bobSec,
    );
    return opened ? encodeUTF8(opened) : null;
  }, [sealed, keys]);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2 text-xs">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-zinc-600">relay sees:</span>
          <p className="text-amber-400 font-mono break-all line-clamp-2 mt-1">
            {sealed ? `${sealed.ciphertext.slice(0, 32)}…` : '—'}
          </p>
        </div>
        <div>
          <span className="text-zinc-600">recipient sees:</span>
          <p className="text-emerald-300 mt-1 break-words">{decrypted ?? '—'}</p>
        </div>
      </div>
    </div>
  );
}

// ── Step content ─────────────────────────────────────────────────────────

interface StepProps {
  displayName: string;
}

function StepIdentity({ displayName }: StepProps) {
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-zinc-300" />
        </div>
        <h2 className="text-xl font-semibold text-white">You are anonymous</h2>
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed">
        Your name in this tab is{' '}
        <span className="font-mono text-white px-1.5 py-0.5 bg-zinc-800 rounded">{displayName}</span>{' '}
        — random, chosen for you, change it any time in Settings.
      </p>
      <p className="text-sm text-zinc-400 leading-relaxed">
        Your keypair lives in this browser tab. Close the tab and the identity is gone — no
        recovery, no account, no email. Nothing to hack, nothing to phish.
      </p>
      <p className="text-sm text-zinc-400 leading-relaxed">
        Display names are <em>not</em> verified. Anyone can pick &quot;alice.&quot; You recognize
        friends by context, not by a username badge.
      </p>
    </>
  );
}

function StepEncryption() {
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
          <Lock className="w-5 h-5 text-zinc-300" />
        </div>
        <h2 className="text-xl font-semibold text-white">Every message is sealed</h2>
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed">
        Your browser encrypts each message with <code className="text-zinc-200">nacl.box</code>{' '}
        addressed to one specific recipient&apos;s key. The server forwards the sealed bytes
        without ever decrypting them.
      </p>
      <p className="text-sm text-zinc-400 leading-relaxed">
        Try it — type below and watch the server&apos;s view vs the recipient&apos;s view:
      </p>
      <MiniEncryptionDemo />
      <p className="text-xs text-zinc-500">
        Want more depth?{' '}
        <Link to="/how-it-works" className="underline text-zinc-300 hover:text-white">
          Read the full how-it-works
        </Link>
        .
      </p>
    </>
  );
}

function StepInvite() {
  const origin = typeof window === 'undefined' ? 'https://your-server' : window.location.origin;
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
          <Share2 className="w-5 h-5 text-zinc-300" />
        </div>
        <h2 className="text-xl font-semibold text-white">Inviting friends</h2>
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed">
        There&apos;s no friend list, no DM-out-of-the-blue. To bring someone in, share the URL
        they should open. They land in the same void you&apos;re in.
      </p>
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2 text-xs">
        <div>
          <span className="text-zinc-500">Your server:</span>
          <p className="font-mono text-zinc-200 break-all mt-1">{origin}</p>
        </div>
        <div>
          <span className="text-zinc-500">A specific community:</span>
          <p className="font-mono text-zinc-200 break-all mt-1">
            {origin}/app/community/&lt;id&gt;
          </p>
          <p className="text-zinc-500 mt-1">
            Inside a community, click the community name in the sidebar →{' '}
            <em>Copy invite link</em>.
          </p>
        </div>
      </div>
      <p className="text-sm text-zinc-400 leading-relaxed">
        For <strong>private communities</strong>, share the password{' '}
        <em>through a different channel</em> (in person, on Signal, etc.) — the link doesn&apos;t
        carry it. That&apos;s the point of the gate.
      </p>
    </>
  );
}

function StepReady() {
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-zinc-300" />
        </div>
        <h2 className="text-xl font-semibold text-white">You&apos;re ready</h2>
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed">
        Create a community to bring friends together, or jump into one you were invited to. Every
        message you send is sealed; nothing here is ever stored as plaintext.
      </p>
      <ul className="text-sm text-zinc-400 space-y-2 mt-2">
        <li className="flex items-start gap-2">
          <Eye className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500" />
          <span>Right side of the chat shows who&apos;s in the channel right now.</span>
        </li>
        <li className="flex items-start gap-2">
          <EyeIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500" />
          <span>Reload the page = your sent history stays (cached in your browser).</span>
        </li>
        <li className="flex items-start gap-2">
          <X className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500" />
          <span>Close the tab = your identity and undelivered DMs vanish.</span>
        </li>
      </ul>
    </>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────

const STEP_COUNT = 4;

export function OnboardingModal({ isOpen, displayName, onClose }: OnboardingModalProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (isOpen) setStep(0);
  }, [isOpen]);

  const finish = useCallback(() => {
    markOnboardingSeen();
    onClose();
  }, [onClose]);

  const renderStep = () => {
    switch (step) {
      case 0:
        return <StepIdentity displayName={displayName} />;
      case 1:
        return <StepEncryption />;
      case 2:
        return <StepInvite />;
      default:
        return <StepReady />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-gradient-to-br from-zinc-950 via-zinc-900 to-black rounded-xl shadow-2xl border border-zinc-800/60 max-h-[90vh] flex flex-col">
        {/* Header with skip + progress pips */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/50">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step ? 'bg-white' : i < step ? 'bg-zinc-500' : 'bg-zinc-700'
                }`}
              />
            ))}
          </div>
          <button
            onClick={finish}
            className="text-xs text-zinc-500 hover:text-white transition-colors"
          >
            Skip
          </button>
        </div>

        {/* Body — scrolls if the demo widget pushes it tall */}
        <div className="p-6 space-y-4 overflow-y-auto">{renderStep()}</div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800/50">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:text-zinc-400"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <span className="text-xs text-zinc-600">
            {step + 1} of {STEP_COUNT}
          </span>
          {step < STEP_COUNT - 1 ? (
            <button
              onClick={() => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))}
              className="flex items-center gap-1 px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={finish}
              className="flex items-center gap-1 px-4 py-1.5 text-sm bg-gradient-to-r from-zinc-600 to-zinc-500 hover:from-zinc-500 hover:to-zinc-400 text-white rounded-lg transition-colors"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OnboardingModal;
