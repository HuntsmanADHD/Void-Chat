'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import { useXAuth } from '@/hooks/useXAuth';

const CheckIcon = ({ className = 'w-6 h-6' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ErrorIcon = ({ className = 'w-6 h-6' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>
);

const LoadingSpinner = ({ className = 'w-6 h-6' }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
);

type LinkStatus = 'loading' | 'linking' | 'success' | 'error' | 'no-session';

export default function XLinkCompletePage() {
  const router = useRouter();
  const { isConnected, isAuthenticated } = useWalletAuth();
  const { xSession, xAccountStatus, linkXAccount, error } = useXAuth();
  const [status, setStatus] = useState<LinkStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleLinking = async () => {
      if (!isConnected || !isAuthenticated) { setStatus('error'); setErrorMessage('Please connect and sign in with your wallet first'); return; }
      if (!xSession?.xProfile) { setStatus('no-session'); return; }
      if (xAccountStatus?.linked) { setStatus('success'); return; }
      setStatus('linking');
      const success = await linkXAccount();
      if (success) { setStatus('success'); } else { setStatus('error'); setErrorMessage(error || 'Failed to link X account'); }
    };
    const timer = setTimeout(handleLinking, 500);
    return () => clearTimeout(timer);
  }, [isConnected, isAuthenticated, xSession, xAccountStatus, linkXAccount, error]);

  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => { router.push('/app'); }, 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [status, router]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {status === 'loading' && (
          <div className="text-center">
            <div className="inline-flex p-4 bg-zinc-900 rounded-2xl mb-4"><LoadingSpinner className="w-12 h-12 text-zinc-400" /></div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">Checking X Account</h2>
            <p className="text-zinc-400">Please wait...</p>
          </div>
        )}
        {status === 'linking' && (
          <div className="text-center">
            <div className="inline-flex p-4 bg-zinc-900 rounded-2xl mb-4"><LoadingSpinner className="w-12 h-12 text-blue-400" /></div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">Linking X Account</h2>
            <p className="text-zinc-400">Connecting @{xSession?.xProfile?.username} to your wallet...</p>
          </div>
        )}
        {status === 'success' && (
          <div className="text-center">
            <div className="inline-flex p-4 bg-emerald-900/30 rounded-2xl mb-4"><CheckIcon className="w-12 h-12 text-emerald-400" /></div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">Successfully Linked!</h2>
            <p className="text-zinc-400 mb-4">Your X account @{xAccountStatus?.xHandle || xSession?.xProfile?.username} is now linked to your wallet.</p>
            <p className="text-zinc-500 text-sm">Redirecting to app...</p>
          </div>
        )}
        {status === 'no-session' && (
          <div className="text-center">
            <div className="inline-flex p-4 bg-amber-900/30 rounded-2xl mb-4"><ErrorIcon className="w-12 h-12 text-amber-400" /></div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">X Authentication Required</h2>
            <p className="text-zinc-400 mb-6">Please authenticate with X to link your account.</p>
            <button onClick={() => router.push('/auth/x-link')} className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg transition-colors">Try Again</button>
          </div>
        )}
        {status === 'error' && (
          <div className="text-center">
            <div className="inline-flex p-4 bg-red-900/30 rounded-2xl mb-4"><ErrorIcon className="w-12 h-12 text-red-400" /></div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">Linking Failed</h2>
            <p className="text-zinc-400 mb-6">{errorMessage || 'An error occurred while linking your X account.'}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => router.push('/auth/x-link')} className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg transition-colors">Try Again</button>
              <button onClick={() => router.push('/app')} className="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-lg transition-colors">Skip for Now</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
