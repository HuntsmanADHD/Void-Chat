'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { useBackdropClose } from '@/components/ui/useBackdropClose';

export interface CommunityPasswordPromptProps {
  isOpen: boolean;
  /** Community name to display, if known. */
  communityName?: string;
  /** Optional error from a previous failed attempt. */
  error?: string | null;
  isSubmitting?: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/**
 * Reusable modal that asks the user for a community password. Used on
 * dashboard click-into-private-community and on a 401 response from the
 * per-community GET (e.g., after a server restart where sessionStorage
 * still has a stale entry).
 */
export function CommunityPasswordPrompt({
  isOpen,
  communityName,
  error,
  isSubmitting = false,
  onSubmit,
  onCancel,
}: CommunityPasswordPromptProps) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const backdrop = useBackdropClose(onCancel, isOpen && !isSubmitting);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      // Defer focus so the input is mounted.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isSubmitting, onCancel]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (isSubmitting) return;
      const trimmed = password.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
    },
    [password, isSubmitting, onSubmit],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      {...backdrop}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-gradient-to-br from-zinc-950 via-zinc-900 to-black rounded-xl shadow-2xl border border-zinc-800/50 p-6 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
            <Lock className="w-5 h-5 text-zinc-300" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Password required</h3>
            {communityName && (
              <p className="text-xs text-zinc-500 truncate" title={communityName}>
                {communityName}
              </p>
            )}
          </div>
        </div>

        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="Enter password"
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !password.trim()}
            className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isSubmitting ? 'Checking…' : 'Enter'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default CommunityPasswordPrompt;
