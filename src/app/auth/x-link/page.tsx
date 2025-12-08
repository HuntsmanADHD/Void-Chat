'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import { XLinkButton, XVerificationStatus } from '@/components/auth/XLinkButton';

const XIcon = ({ className = 'w-8 h-8' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const ArrowLeftIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

export default function XLinkPage() {
  const router = useRouter();
  const { isConnected, isAuthenticated } = useWalletAuth();

  useEffect(() => {
    if (!isConnected || !isAuthenticated) { router.push('/'); }
  }, [isConnected, isAuthenticated, router]);

  if (!isConnected || !isAuthenticated) {
    return (<div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="text-zinc-400">Redirecting...</div></div>);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"><ArrowLeftIcon className="w-5 h-5 text-zinc-400" /></button>
          <h1 className="text-lg font-semibold">X Account Linking</h1>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-zinc-900 rounded-2xl mb-4"><XIcon className="w-12 h-12 text-zinc-300" /></div>
          <h2 className="text-2xl font-bold mb-2">Link Your X Account</h2>
          <p className="text-zinc-400 max-w-md mx-auto">Connect your X (Twitter) account to add transparency to your profile. This is optional and helps other users verify your identity.</p>
        </div>
        <div className="grid gap-4 mb-8">
          <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
            <h3 className="font-medium mb-2">Why link your X account?</h3>
            <ul className="space-y-2 text-zinc-400 text-sm">
              <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Display your X handle on your profile</span></li>
              <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Build trust with other community members</span></li>
              <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Verify your identity without compromising privacy</span></li>
              <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Optional - unlink anytime</span></li>
            </ul>
          </div>
        </div>
        <XVerificationStatus className="mb-8" />
        <div className="flex justify-center"><XLinkButton /></div>
        <div className="mt-8 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
          <p className="text-zinc-500 text-xs text-center">We only store your X handle and user ID. We do not access your tweets, followers, or any other X data. You can unlink your account at any time.</p>
        </div>
      </main>
    </div>
  );
}
