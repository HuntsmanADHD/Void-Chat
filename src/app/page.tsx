'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Shield, Lock, Users, Zap, MessageCircle, Key } from 'lucide-react';
import { WarrantCanaryBadge } from '@/components/legal/WarrantCanary';

/**
 * Animated decoding text effect
 */
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
          chars[Math.floor(Math.random() * chars.length)]
        ).join('');
        return revealed + scrambled;
      });
    }, 30);

    const revealTimeout = setTimeout(() => {
      setCurrentIndex((prev) => prev + 1);
    }, 80);

    return () => {
      clearInterval(scrambleInterval);
      clearTimeout(revealTimeout);
    };
  }, [currentIndex, text, chars]);

  useEffect(() => {
    const startDelay = setTimeout(() => {
      setCurrentIndex(0);
      setDisplayText(Array.from({ length: text.length }, () =>
        chars[Math.floor(Math.random() * chars.length)]
      ).join(''));
    }, 500);
    return () => clearTimeout(startDelay);
  }, [text, chars]);

  return (
    <span className={className}>
      {displayText || text}
    </span>
  );
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
  const router = useRouter();
  const { connected } = useWallet();

  useEffect(() => {
    if (connected) {
      router.push('/app');
    }
  }, [connected, router]);

  const leftFeatures = [
    { icon: Lock, title: 'E2E Encrypted', description: 'TweetNaCl encryption. Keys never leave your device.' },
    { icon: Shield, title: 'Token-Gated', description: '$CLAWED required for access. Anti-spam by design.' },
    { icon: Zap, title: 'P2P Direct', description: 'Peer-to-peer when possible. No middleman.' },
  ];

  const rightFeatures = [
    { icon: Users, title: '3-Strike System', description: 'On-chain blacklisting. Bad actors removed permanently.' },
    { icon: MessageCircle, title: 'Real-Time', description: 'Instant delivery with typing indicators.' },
    { icon: Key, title: 'Wallet = Identity', description: 'No passwords. No emails. Just your wallet.' },
  ];

  return (
    <div className="min-h-screen bg-black flex flex-col relative overflow-hidden">
      <div className="absolute pointer-events-none" style={{ top: '5%', left: '50%', transform: 'translateX(-50%)', width: '70%', height: '70%', backgroundImage: 'url(/images/logo.png)', backgroundPosition: 'center top', backgroundRepeat: 'no-repeat', backgroundSize: 'contain', opacity: 0.3 }} aria-hidden="true" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center top, transparent 0%, black 70%)' }} aria-hidden="true" />

      <header className="relative z-10 w-full px-6 py-4 flex items-center justify-between border-b border-white/5 bg-black/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Image src="/images/logo.png" alt="Void Chat Logo" width={40} height={40} className="rounded-xl" />
          <span className="text-xl font-bold text-white text-shadow-sm">Void Chat</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
          </a>
          <WalletMultiButton style={{ background: 'linear-gradient(135deg, #4a4a4a 0%, #6b6b6b 50%, #8a8a8a 100%)', borderRadius: '0.5rem', fontWeight: 500, fontSize: '0.875rem', padding: '0.5rem 1.25rem', border: '1px solid rgba(255, 255, 255, 0.15)' }} />
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center px-6 pt-8 pb-16">
        <div className="w-full max-w-7xl mx-auto flex items-start justify-between gap-8 mt-8">
          <div className="hidden lg:flex flex-col gap-8 pt-32">
            {leftFeatures.map((feature) => (<FeatureItem key={feature.title} icon={feature.icon} title={feature.title} description={feature.description} align="left" />))}
          </div>

          <div className="flex-1 flex flex-col items-center text-center max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 rounded-full bg-black/60 border border-white/10 text-sm backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-zinc-300">Powered by Solana</span>
              <span className="text-zinc-600">|</span>
              <span className="text-amber-400 text-shadow-sm">$CLAWED</span>
            </div>

            <h1 className="text-6xl md:text-8xl font-black mb-6 tracking-tight">
              <span className="bg-gradient-to-b from-zinc-900 via-zinc-500 to-white bg-clip-text text-transparent drop-shadow-2xl">VOID</span><br />
              <span className="bg-gradient-to-r from-zinc-700 via-zinc-400 to-white bg-clip-text text-transparent">CHAT</span>
            </h1>

            <div className="h-8 mb-10">
              <p className="text-xl md:text-2xl font-mono tracking-wide">
                <DecodingText text="Speak to others using void chat and your messages become void" className="text-zinc-400" />
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <WalletMultiButton style={{ background: 'linear-gradient(135deg, #3a3a3a 0%, #6b6b6b 50%, #a0a0a0 100%)', borderRadius: '0.75rem', fontWeight: 600, fontSize: '1.125rem', padding: '1rem 2.5rem', height: 'auto', boxShadow: '0 0 40px rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255, 255, 255, 0.2)' }} />
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="px-8 py-4 rounded-xl text-lg font-semibold text-zinc-200 bg-gradient-to-r from-zinc-800/80 via-zinc-700/60 to-zinc-600/40 hover:from-zinc-700/80 hover:via-zinc-600/60 hover:to-zinc-500/40 border border-white/10 hover:border-white/30 backdrop-blur-md transition-all hover:scale-105">View on GitHub</a>
            </div>

            <div className="grid grid-cols-3 gap-8 py-6 border-y border-white/5 w-full max-w-md">
              <div className="text-center"><div className="text-2xl font-bold text-white text-shadow-lg mb-1">E2E</div><div className="text-xs text-zinc-500">Encrypted</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-white text-shadow-lg mb-1">P2P</div><div className="text-xs text-zinc-500">Direct</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-white text-shadow-lg mb-1">Web3</div><div className="text-xs text-zinc-500">Native</div></div>
            </div>
          </div>

          <div className="hidden lg:flex flex-col gap-8 pt-32">
            {rightFeatures.map((feature) => (<FeatureItem key={feature.title} icon={feature.icon} title={feature.title} description={feature.description} align="right" />))}
          </div>
        </div>

        <div className="lg:hidden grid grid-cols-2 gap-4 mt-12 max-w-lg mx-auto">
          {[...leftFeatures, ...rightFeatures].map((feature) => (
            <div key={feature.title} className="flex items-start gap-2 p-3 rounded-lg bg-gradient-to-br from-zinc-800/40 to-zinc-700/20 border border-white/10 backdrop-blur-sm">
              <feature.icon className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5" />
              <div><h3 className="text-xs font-semibold text-zinc-200">{feature.title}</h3><p className="text-[10px] text-zinc-500">{feature.description}</p></div>
            </div>
          ))}
        </div>

        <div className="max-w-xl mx-auto mt-16 text-center">
          <div className="bg-gradient-to-r from-zinc-900/40 via-zinc-800/30 to-zinc-700/20 rounded-2xl p-6 border border-white/10 backdrop-blur-md">
            <h3 className="text-lg font-semibold text-white text-shadow-lg mb-3">$CLAWED Token</h3>
            <p className="text-sm text-zinc-400 mb-4">Hold $CLAWED to access exclusive communities and unlock premium features.</p>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 border border-white/10 font-mono text-xs">
              <span className="text-zinc-400">CA:</span>
              <span className="text-amber-400 text-shadow-sm select-all">ELusVXzUPHyAuPB3M7qemr2Y2KshiWnGXauK17XYpump</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 w-full px-6 py-6 border-t border-white/5 bg-black/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/images/logo.png" alt="Clawed Logo" width={28} height={28} className="rounded-lg" />
            <span className="text-xs text-zinc-500">Void Chat - Privacy-first Web3 communication</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-zinc-500">
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <WarrantCanaryBadge />
          </div>
        </div>
      </footer>
    </div>
  );
}
