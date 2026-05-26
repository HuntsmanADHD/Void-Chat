import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, RefreshCw, Server, Trash2 } from 'lucide-react';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import naclUtil from 'tweetnacl-util';

const { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } = naclUtil;

/**
 * Live demo widget: generates two fresh keypairs (alice + bob), encrypts
 * whatever the user types from alice → bob, shows the ciphertext, then
 * decrypts back on bob's side. Re-keys on click. Demonstrates the exact
 * primitive (`nacl.box`) the real app uses for every message.
 */
function EncryptionDemo() {
  const [aliceSec, setAliceSec] = useState<Uint8Array>(() => nacl.box.keyPair().secretKey);
  const [bobSec, setBobSec] = useState<Uint8Array>(() => nacl.box.keyPair().secretKey);
  const [plaintext, setPlaintext] = useState('hello from alice');
  const [reveal, setReveal] = useState(false);

  const alicePub = useMemo(() => nacl.box.keyPair.fromSecretKey(aliceSec).publicKey, [aliceSec]);
  const bobPub = useMemo(() => nacl.box.keyPair.fromSecretKey(bobSec).publicKey, [bobSec]);

  const sealed = useMemo(() => {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ct = nacl.box(decodeUTF8(plaintext), nonce, bobPub, aliceSec);
    return ct ? { ciphertext: encodeBase64(ct), nonce: encodeBase64(nonce) } : null;
  }, [plaintext, bobPub, aliceSec]);

  const decrypted = useMemo(() => {
    if (!sealed) return null;
    const opened = nacl.box.open(
      decodeBase64(sealed.ciphertext),
      decodeBase64(sealed.nonce),
      alicePub,
      bobSec,
    );
    return opened ? encodeUTF8(opened) : null;
  }, [sealed, alicePub, bobSec]);

  const reroll = () => {
    setAliceSec(nacl.box.keyPair().secretKey);
    setBobSec(nacl.box.keyPair().secretKey);
  };

  useEffect(() => {
    reroll();
  }, []);

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Live encryption demo</h3>
        <button
          onClick={reroll}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          New keypairs
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Two fresh Curve25519 keypairs (alice and bob) generated in your browser. Type below — alice
        encrypts to bob&apos;s public key, bob decrypts with his secret. Nothing leaves this page.
      </p>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">alice types:</label>
        <textarea
          value={plaintext}
          onChange={(e) => setPlaintext(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 resize-none focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="flex items-center justify-between text-xs text-zinc-500 mb-1">
            <span>what the relay sees (ciphertext):</span>
            <button
              onClick={() => setReveal((p) => !p)}
              className="text-zinc-500 hover:text-zinc-300"
              title={reveal ? 'hide' : 'reveal'}
            >
              {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </label>
          <div className="px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-xs font-mono text-amber-400 break-all min-h-[64px]">
            {sealed
              ? reveal
                ? `${sealed.ciphertext}.${sealed.nonce}`
                : '•'.repeat(Math.min(sealed.ciphertext.length, 80))
              : '(empty)'}
          </div>
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">what bob decrypts:</label>
          <div className="px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-emerald-300 min-h-[64px] whitespace-pre-wrap">
            {decrypted ?? '(decrypt failed)'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-zinc-500 font-mono">
        <div>
          <span className="text-zinc-600">alice pub:</span>{' '}
          <span className="text-zinc-400 break-all">{bs58.encode(alicePub).slice(0, 16)}…</span>
        </div>
        <div>
          <span className="text-zinc-600">bob pub:</span>{' '}
          <span className="text-zinc-400 break-all">{bs58.encode(bobPub).slice(0, 16)}…</span>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center">
          <Icon className="w-4 h-4 text-zinc-300" />
        </div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      <div className="text-sm text-zinc-300 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export default function HowItWorks() {
  return (
    <div className="h-screen overflow-y-auto bg-black">
      <header className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold text-white">How Void Chat works</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <p className="text-zinc-400">
          Void Chat is a self-hosted ephemeral messenger. Every tab generates its own cryptographic
          identity, every message is end-to-end encrypted to one specific recipient, and the relay
          server is a dumb pipe that never sees plaintext. Here&apos;s what that means in practice.
        </p>

        <Section icon={KeyRound} title="Your identity is a fresh keypair per tab">
          <p>
            When you open the app, your browser generates two NaCl keypairs: an ed25519 pair for
            signing announcements (proving you possess your identity) and a Curve25519 pair for
            encrypting messages. Both secret keys live in <code>sessionStorage</code>, which
            disappears when you close the tab. No account, no password, no recovery.
          </p>
          <p>
            Your display name lives in <code>localStorage</code> as a convenience — but it&apos;s
            not authenticated. Anyone can pick the same name; you recognize friends by context, not
            by label.
          </p>
        </Section>

        <Section icon={Lock} title="Messages are sealed for one recipient at a time">
          <p>
            Every message you send is encrypted with <code>nacl.box</code> from your Curve25519
            secret to one specific recipient&apos;s public key. For a DM, that&apos;s one
            encryption. For a channel of N people, your client encrypts N separate copies — one per
            member — before sending. The relay routes each ciphertext to the right socket, decrypts
            nothing.
          </p>
          <p>
            This is what &quot;zero knowledge&quot; means here: even if the server is compromised,
            even if you don&apos;t trust the person running it, the only thing they could see is
            ciphertext addressed to specific public keys.
          </p>
          <EncryptionDemo />
        </Section>

        <Section icon={Server} title="What the server actually stores">
          <p>The SQLite directory on the host machine holds:</p>
          <ul className="list-disc pl-5 space-y-1 text-zinc-400">
            <li>community names + descriptions + (optional) password hashes</li>
            <li>channel names per community</li>
            <li>nothing else</li>
          </ul>
          <p>
            No users, no memberships, no messages, no files. Restart the relay process and every
            roster, every in-flight message, every connected identity is gone — only the directory
            (rooms + channels) survives. Back up the server by copying the SQLite file.
          </p>
        </Section>

        <Section icon={Lock} title="Private communities use password-derived gates">
          <p>
            When you mark a community private, the password you choose is hashed with{' '}
            <code>scrypt</code> (random 16-byte salt, 64-byte derived key) and stored. The
            plaintext password never touches disk. To join later, you supply the password; the
            server re-derives and compares in constant time.
          </p>
          <p>
            Lose the password and the community is orphaned — there is no &quot;forgot password.&quot;
            The server operator can delete the row directly from the SQLite file if needed, but
            they can&apos;t recover the original.
          </p>
          <p className="text-zinc-500 text-xs">
            Note: the password is a gate on the directory, not on the messages. Even without a
            password, every message inside is already end-to-end encrypted. The password just
            controls who can see the channel list.
          </p>
        </Section>

        <Section icon={Trash2} title="What's NOT here (honest limitations)">
          <ul className="list-disc pl-5 space-y-1 text-zinc-400">
            <li>
              <strong>No display-name authentication.</strong> Anyone can pick &quot;alice.&quot;
              Recognize friends by context.
            </li>
            <li>
              <strong>No message history for new joiners.</strong> You see what arrives after you
              connect. Nothing in the past, ever.
            </li>
            <li>
              <strong>No offline DMs.</strong> Recipient not connected = dropped. You&apos;ll be
              told.
            </li>
            <li>
              <strong>Channel bandwidth is O(N).</strong> 50-person channel = 50 encrypted copies
              per message. That&apos;s what zero-knowledge fan-out costs.
            </li>
            <li>
              <strong>Public hosting needs trust boundaries.</strong> Spam-resistance is your
              firewall + your friend group, not the protocol.
            </li>
          </ul>
        </Section>

        <Section icon={Lock} title="Need a second layer? Wash it.">
          <p>
            For invites, community passwords, or any phrase you&apos;re going to send through a
            channel you don&apos;t fully trust, the{' '}
            <Link to="/wash" className="text-zinc-100 underline hover:text-white">
              Wash
            </Link>{' '}
            tool wraps a string in a passphrase-derived AES-256-GCM layer. Independent algorithm
            from the chat protocol — defense in depth.
          </p>
          <p className="text-xs text-zinc-500">
            Hand the passphrase to the recipient through a different channel than the washed blob.
            Both halves in the same place defeats the point.
          </p>
        </Section>

        <div className="text-center pt-4 pb-16">
          <Link to="/app" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Enter the void →
          </Link>
        </div>
      </main>
    </div>
  );
}
