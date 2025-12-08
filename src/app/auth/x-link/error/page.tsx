'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const ErrorIcon = ({ className = 'w-6 h-6' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: 'X authentication is not properly configured. Please contact support.',
  AccessDenied: 'You denied access to your X account. No changes were made.',
  Verification: 'Unable to verify your X account. Please try again.',
  OAuthSignin: 'Error starting the X sign-in process. Please try again.',
  OAuthCallback: 'Error during X authentication callback. Please try again.',
  OAuthCreateAccount: 'Unable to create account from X. Please try again.',
  EmailCreateAccount: 'Unable to create account. Please try again.',
  Callback: 'Authentication callback error. Please try again.',
  OAuthAccountNotLinked: 'This X account is already linked to another wallet.',
  Default: 'An error occurred during X authentication. Please try again.',
};

function XLinkErrorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || 'Default';
  const errorMessage = ERROR_MESSAGES[error] || ERROR_MESSAGES.Default;

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex p-4 bg-red-900/30 rounded-2xl mb-4"><ErrorIcon className="w-12 h-12 text-red-400" /></div>
        <h1 className="text-2xl font-bold text-zinc-100 mb-2">X Authentication Error</h1>
        <p className="text-zinc-400 mb-6">{errorMessage}</p>
        {error !== 'Default' && (<p className="text-zinc-600 text-sm mb-6">Error code: {error}</p>)}
        <div className="flex gap-3 justify-center">
          <button onClick={() => router.push('/auth/x-link')} className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg transition-colors">Try Again</button>
          <button onClick={() => router.push('/app')} className="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-lg transition-colors">Continue Without X</button>
        </div>
        <p className="mt-8 text-zinc-600 text-xs">X account linking is optional. You can continue using Clawed without linking your X account.</p>
      </div>
    </div>
  );
}

export default function XLinkErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="text-zinc-400">Loading...</div></div>}>
      <XLinkErrorContent />
    </Suspense>
  );
}
