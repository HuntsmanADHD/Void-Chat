'use client';

import React, { useState, useRef, useEffect } from 'react';

/**
 * Common emoji set for reactions
 */
export const REACTION_EMOJIS = [
  { emoji: '👍', name: 'thumbs up' },
  { emoji: '❤️', name: 'heart' },
  { emoji: '😂', name: 'laughing' },
  { emoji: '😮', name: 'surprised' },
  { emoji: '😢', name: 'sad' },
  { emoji: '😡', name: 'angry' },
  { emoji: '🔥', name: 'fire' },
  { emoji: '👀', name: 'eyes' },
  { emoji: '🎉', name: 'party' },
  { emoji: '💯', name: 'hundred' },
];

// Expanded emoji categories for the full picker
const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😴', '🤤', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'],
  'Gestures': ['👍', '👎', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '🫶', '🤏', '🫰', '🫵', '🫱', '🫲', '🫳', '🫴', '🤛', '🤜', '👊', '✊', '🫂', '💅', '🤳', '💆', '💇', '🧎', '🧍', '🚶', '🏃', '💃', '🕺', '🧑‍🤝‍🧑', '👫', '👭', '👬'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💌', '💋', '💍', '💎', '❤️‍🔥', '❤️‍🩹', '🫀', '💏', '💑', '🥰', '😍', '😘', '😻', '💐', '🌹', '🌷', '🌸', '🪷', '🏵️', '🌺'],
  'Animals': ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘'],
  'Food': ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🍕', '🍔', '🍟', '🌭', '🍿', '🧀', '🥐', '🍞', '🥖', '🥨', '🧁', '🍰', '🎂', '🍩', '🍪', '🍫', '🍬', '🍭', '☕', '🍵', '🧃', '🥤', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍶', '🫖', '🧊', '🥡', '🍱', '🍛', '🍜', '🍝', '🍣', '🍤', '🍙', '🍚', '🥮', '🥟', '🥠', '🥫'],
  'Nature': ['🌍', '🌎', '🌏', '🌐', '🗺️', '🧭', '🏔️', '⛰️', '🌋', '🗻', '🏕️', '🏖️', '🏜️', '🏝️', '🏞️', '🌅', '🌄', '🌠', '🎇', '🎆', '🌌', '🌉', '🌃', '🌁', '🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '🌊', '💧', '💦', '☔', '🌺', '🌻', '🌼', '🌷', '🌱', '🪴', '🌲', '🌳', '🌴', '🌵', '🍀', '🍁', '🍂', '🍃', '🪹', '🪺', '🍄', '🌾', '🐚'],
  'Objects': ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💾', '💿', '📷', '🎥', '🔦', '💡', '🔋', '🔌', '💎', '💰', '💳', '🔑', '🗝️', '🔨', '🛠️', '⚙️', '🔫', '💣', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '📚', '📖', '📰', '🗞️', '📑', '🔖', '🏷️', '✉️', '📧', '📦', '📫', '📪', '📬', '📭', '📮', '🗳️', '✏️', '✒️', '🖋️', '🖊️', '🖌️', '🖍️', '📝'],
  'Symbols': ['❤️', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💬', '🗨️', '🗯️', '💭', '💤', '✅', '❌', '❓', '❗', '⭐', '🌟', '✨', '⚡', '🔥', '💥', '🎉', '🎊', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🎮', '🎲', '♠️', '♥️', '♦️', '♣️', '🃏', '🀄', '🎴', '🔇', '🔈', '🔉', '🔊', '📢', '📣', '🔔', '🔕', '🎵', '🎶', '🎼', '🎤', '🎧', '📻', '🎷', '🎸', '🎹', '🎺'],
};

export interface EmojiPickerProps {
  /** Callback when emoji is selected */
  onSelect: (emoji: string) => void;
  /** Callback to close the picker */
  onClose: () => void;
  /** Position of the picker */
  position?: 'top' | 'bottom';
  /** Whether to show the expanded full picker */
  expanded?: boolean;
}

/**
 * Emoji picker with compact and expanded modes
 * - Compact: Shows quick reaction emojis
 * - Expanded: Shows categorized emoji grid with search
 */
export function EmojiPicker({ onSelect, onClose, position = 'top', expanded = false }: EmojiPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState<string>('Smileys');
  const [isExpanded, setIsExpanded] = useState(expanded);
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji);
    onClose();
  };

  const positionClass = position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';

  // Compact mode - just reaction emojis
  if (!isExpanded) {
    return (
      <div
        ref={pickerRef}
        className={`absolute ${positionClass} left-0 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden animate-fade-in`}
      >
        <div className="p-3">
          <div className="grid grid-cols-5 gap-2">
            {REACTION_EMOJIS.map(({ emoji, name }) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleEmojiClick(emoji)}
                onMouseEnter={() => setHoveredEmoji(emoji)}
                onMouseLeave={() => setHoveredEmoji(null)}
                className="w-11 h-11 flex items-center justify-center text-2xl hover:bg-zinc-800 hover:scale-125 rounded-lg transition-all duration-150"
                title={name}
                aria-label={`React with ${name}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3 min-h-[2.5rem]">
            {hoveredEmoji ? (
              <>
                <span className="text-4xl leading-none">{hoveredEmoji}</span>
                <span className="text-sm text-zinc-400 font-medium">
                  {REACTION_EMOJIS.find(e => e.emoji === hoveredEmoji)?.name}
                </span>
              </>
            ) : (
              <span className="text-sm text-zinc-600">Hover to preview</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-all duration-150"
          >
            More emojis
          </button>
        </div>
      </div>
    );
  }

  // Expanded mode - full emoji picker with categories
  return (
    <div
      ref={pickerRef}
      className={`absolute ${positionClass} left-0 z-50 w-[420px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden animate-fade-in`}
    >
      {/* Category tabs */}
      <div className="flex gap-1 p-2 border-b border-zinc-800 overflow-x-auto scrollbar-none bg-zinc-900/95">
        {Object.keys(EMOJI_CATEGORIES).map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-all duration-150 ${
              activeCategory === category
                ? 'bg-zinc-700 text-zinc-100 shadow-md'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Emoji grid - 8 columns x 6 rows visible (larger area) */}
      <div className="p-3 h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
        <div className="grid grid-cols-8 gap-2">
          {EMOJI_CATEGORIES[activeCategory as keyof typeof EMOJI_CATEGORIES]?.map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              type="button"
              onClick={() => handleEmojiClick(emoji)}
              onMouseEnter={() => setHoveredEmoji(emoji)}
              onMouseLeave={() => setHoveredEmoji(null)}
              className="w-11 h-11 flex items-center justify-center text-2xl hover:bg-zinc-800 hover:scale-125 rounded-lg transition-all duration-150"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Footer with large hover preview */}
      <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/95 flex items-center justify-between">
        <div className="flex items-center gap-3 min-h-[3rem]">
          {hoveredEmoji ? (
            <>
              <span className="text-5xl leading-none">{hoveredEmoji}</span>
              <div className="flex flex-col">
                <span className="text-sm text-zinc-300 font-medium">Click to insert</span>
                <span className="text-xs text-zinc-500">or continue browsing</span>
              </div>
            </>
          ) : (
            <span className="text-sm text-zinc-600">Hover over an emoji to preview</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-all duration-150"
        >
          Show less
        </button>
      </div>
    </div>
  );
}

export default EmojiPicker;
