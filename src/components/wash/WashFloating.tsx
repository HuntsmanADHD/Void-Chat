'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { WashWidget } from './WashWidget';

export interface WashFloatingProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Square floating popup version of the wash tool, designed to anchor at
 * the bottom-left of the screen (just above the Sidebar user panel where
 * the trigger lives). No dim backdrop — just a panel that pops up and
 * closes on outside click or Escape.
 *
 * The chat-bar wash button uses `WashModal` (centered overlay); this
 * version is for when wash is opened from the persistent sidebar so the
 * rest of the UI stays interactive while it's open.
 */
export function WashFloating({ isOpen, onClose }: WashFloatingProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    // mousedown not click — close before the click bubbles to other handlers.
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      // Bottom-left anchor: clears the 72px community-icon strip and sits
      // above the ~52px user panel. Square via w-[360px] h-[360px].
      className="fixed bottom-16 left-20 z-40 w-[360px] h-[360px] bg-gradient-to-br from-zinc-950 via-zinc-900 to-black border border-zinc-700 rounded-xl shadow-2xl shadow-black/70 flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/60">
        <span className="text-sm font-semibold text-white">Wash</span>
        <button
          onClick={onClose}
          aria-label="Close wash"
          className="p-1 text-zinc-500 hover:text-white rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <WashWidget compact />
      </div>
    </div>
  );
}

export default WashFloating;
