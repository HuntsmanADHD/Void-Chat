'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { WashWidget } from './WashWidget';
import { useBackdropClose } from '@/hooks/useBackdropClose';

export interface WashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal wrapper around WashWidget, with an intro header. Used by the wash
 * button in the chat input bar so users can open the tool without leaving
 * the chat.
 */
export function WashModal({ isOpen, onClose }: WashModalProps) {
  const backdrop = useBackdropClose(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      {...backdrop}
    >
      <div className="w-full max-w-xl max-h-[90vh] bg-gradient-to-br from-zinc-950 via-zinc-900 to-black rounded-xl shadow-2xl border border-zinc-800/60 flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-800/60">
          <div>
            <h2 className="text-lg font-semibold text-white">Wash plain text</h2>
            <p className="text-xs text-zinc-500 mt-1">
              A second encryption layer for things sent <em>outside</em> Void — invite codes,
              passwords, off-platform phrases. Inside Void, messages are already encrypted, so
              this isn&apos;t needed for normal chatting. Uses a different cryptographic family
              from the chat protocol — see &quot;How it works&quot; for details.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white rounded-lg transition-colors -mt-1 -mr-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          <WashWidget compact />
        </div>
      </div>
    </div>
  );
}

export default WashModal;
