'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, Lock, Shield, Trash2, UserX, Zap } from 'lucide-react';
import { WarrantCanaryBadge } from '@/components/legal/WarrantCanary';

function DecodingText({ text, className }: { text: string; className?: string }) {
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*';

  useEffect(() => {
    if (currentIndex >= text.length) {
      setDisplayText(text);
      return;
    }
    const scrambleInterval = setInterval(() => {
      setDisplayText(() => {
        const revealed = text.slice(0, currentIndex);
        const scrambled = Array.from({ length: text.length - currentIndex }, () =>
          chars[Math.floor(Math.random() * chars.length)],
        ).join('');
        return revealed + scrambled;
      });
    }, 30);
    const revealTimeout = setTimeout(() => setCurrentIndex((p) => p + 1), 80);
    return () => {
      clearInterval(scrambleInterval);
      clearTimeout(revealTimeout);
    };
  }, [currentIndex, text, chars]);

  useEffect(() => {
    const startDelay = setTimeout(() => {
      setCurrentIndex(0);
      setDisplayText(
        Array.from({ length: text.length }, () => chars[Math.floor(Math.random() * chars.length)]).join(''),
      );
    }, 500);
    return () => clearTimeout(startDelay);
  }, [text, chars]);

  return <span className={className}>{displayText || text}</span>;
}

function FeatureItem({
  icon: Icon,
  title,
  description,
  align = 'left',
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={`flex items-start gap-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-zinc-600/80 to-zinc-400/60 flex items-center justify-center flex-shrink-0 border border-white/10">
        <Icon className="w-5 h-5 text-zinc-200" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">{title}</h3>
        <p className="text-xs text-zinc-500 leading-relaxed max-w-[200px]">{description}</p>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const leftFeatures = [
    { icon: Lock, title: 'E2E Encrypted', description: 'TweetNaCl box. Keys never leave your device.' },
    { icon: Eye, title: 'Zero Knowledge', description: 'The relay never sees plaintext. Ever.' },
    { icon: Trash2, title: 'Ephemeral', description: 'Close the tab and your identity is gone.' },
  ];

  const rightFeatures = [
    { icon: UserX, title: 'No Accounts', description: 'No signups. No emails. No passwords.' },
    { icon: Zap, title: 'Real-Time', description: 'Direct relay with per-recipient encryption.' },
    { icon: Shield, title: 'No History', description: 'Nothing stored on the server. Nothing.' },
  ];

  return (
    <div className="min-h-screen bg-black flex flex-col relative overflow-hidden">
      <div
        className="absolute pointer-events-none"
        style={{
          top: '5%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '70%',
          height: '70%',
          backgroundImage: 'url(/images/logo.png)',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          opacity: 0.3,
        }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center top, transparent 0%, black 70%)' }}
        aria-hidden="true"
      />

      <header className="relative z-10 w-full px-6 py-4 flex items-center justify-between border-b border-white/5 bg-black/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Image src="/images/logo.png" alt="Void Chat Logo" width={40} height={40} className="rounded-xl" />
          <span className="text-xl font-bold text-white text-shadow-sm">Void Chat</span>
        </div>
        <Link
          href="/app"
          className="px-5 py-2 rounded-lg font-medium text-sm text-white bg-gradient-to-r from-zinc-700 to-zinc-500 hover:from-zinc-600 hover:to-zinc-400 border border-white/15 transition-all"
        >
          Enter Void
        </Link>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center px-6 pt-8 pb-16">
        <div className="w-full max-w-7xl mx-auto flex items-start justify-between gap-8 mt-8">
          <div className="hidden lg:flex flex-col gap-8 pt-32">
            {leftFeatures.map((f) => (
              <FeatureItem key={f.title} icon={f.icon} title={f.title} description={f.description} align="left" />
            ))}
          </div>

          <div className="flex-1 flex flex-col items-center text-center max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 rounded-full bg-black/60 border border-white/10 text-sm backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-zinc-300">Ephemeral · No Accounts · No History</span>
            </div>

            <h1 className="text-6xl md:text-8xl font-black mb-6 tracking-tight">
              <span className="bg-gradient-to-b from-zinc-900 via-zinc-500 to-white bg-clip-text text-transparent drop-shadow-2xl">
                VOID
              </span>
              <br />
              <span className="bg-gradient-to-r from-zinc-700 via-zinc-400 to-white bg-clip-text text-transparent">
                CHAT
              </span>
            </h1>

            <div className="h-8 mb-10">
              <p className="text-xl md:text-2xl font-mono tracking-wide">
                <DecodingText
                  text="Speak to others using void chat and your messages become void"
                  className="text-zinc-400"
                />
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 mb-12">
              <Link
                href="/app"
                className="px-10 py-4 rounded-xl text-lg font-semibold text-white bg-gradient-to-r from-zinc-700 via-zinc-500 to-zinc-400 hover:from-zinc-600 hover:via-zinc-400 hover:to-zinc-300 border border-white/20 shadow-[0_0_40px_rgba(255,255,255,0.15)] transition-all hover:scale-105"
              >
                Enter Void
              </Link>
            </div>

            <div className="grid grid-cols-3 gap-8 py-6 border-y border-white/5 w-full max-w-md">
              <div className="text-center">
                <div className="text-2xl font-bold text-white text-shadow-lg mb-1">E2E</div>
                <div className="text-xs text-zinc-500">Encrypted</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white text-shadow-lg mb-1">0</div>
                <div className="text-xs text-zinc-500">Persisted</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white text-shadow-lg mb-1">∅</div>
                <div className="text-xs text-zinc-500">Accounts</div>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex flex-col gap-8 pt-32">
            {rightFeatures.map((f) => (
              <FeatureItem key={f.title} icon={f.icon} title={f.title} description={f.description} align="right" />
            ))}
          </div>
        </div>

        <div className="lg:hidden grid grid-cols-2 gap-4 mt-12 max-w-lg mx-auto">
          {[...leftFeatures, ...rightFeatures].map((f) => (
            <div
              key={f.title}
              className="flex items-start gap-2 p-3 rounded-lg bg-gradient-to-br from-zinc-800/40 to-zinc-700/20 border border-white/10 backdrop-blur-sm"
            >
              <f.icon className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-semibold text-zinc-200">{f.title}</h3>
                <p className="text-[10px] text-zinc-500">{f.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="max-w-xl mx-auto mt-16 text-center">
          <div className="bg-gradient-to-r from-zinc-900/40 via-zinc-800/30 to-zinc-700/20 rounded-2xl p-6 border border-white/10 backdrop-blur-md">
            <h3 className="text-lg font-semibold text-white text-shadow-lg mb-3">Privacy by Design</h3>
            <p className="text-sm text-zinc-400 mb-4">
              Every tab generates a fresh keypair. The server is a dumb relay — it sees ciphertext only
              and forgets when you close the tab.
            </p>
          </div>
        </div>
      </main>

      <footer className="relative z-10 w-full px-6 py-6 border-t border-white/5 bg-black/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/images/logo.png" alt="Void Chat Logo" width={28} height={28} className="rounded-lg" />
            <span className="text-xs text-zinc-500">Void Chat — Privacy-first communication</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-zinc-500">
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacy
            </Link>
            <WarrantCanaryBadge />
          </div>
        </div>
      </footer>
    </div>
  );
}
