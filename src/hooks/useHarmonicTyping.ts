import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 432Hz harmonic typing sound hook.
 *
 * Each keystroke plays a short sine note picked from a pentatonic scale,
 * indexed by where the key sits on the keyboard so similar regions
 * produce similar notes.
 *
 * Per-keystroke cost matters here (fast typing = many calls per second),
 * so this is written to allocate as little as possible:
 *   - frequency map built once at module load (no Array.indexOf per press)
 *   - oscillators auto-disconnect when stopped — no tracking Set, no
 *     per-note setTimeout for cleanup (was ~470ms timer per keystroke)
 *   - rapid repeats of the same key within ~25ms are coalesced so a
 *     held-down key doesn't fan out into a chorus
 *
 * The base sine + 2x harmonic layer is preserved from the original
 * implementation — the audible character of the sound depends on it.
 *
 * The AudioContext is created lazily on the first user-initiated note
 * (browser autoplay policies require a gesture).
 */

const PENTATONIC_432 = [432.0, 486.0, 513.0, 648.0, 729.0, 864.0, 972.0, 1026.0, 1296.0];
const EXTENDED_432 = [216.0, 243.0, 256.5, 324.0, 364.5, ...PENTATONIC_432];

/** Build the char → frequency map once. Saves an .indexOf scan per keystroke. */
const FREQUENCY_BY_KEY: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  const rows: Array<[string, number[]]> = [
    ['1234567890', EXTENDED_432.slice(9)],
    ['qwertyuiop', EXTENDED_432.slice(6, 15)],
    ['asdfghjkl', EXTENDED_432.slice(3, 12)],
    ['zxcvbnm', EXTENDED_432.slice(0, 9)],
  ];
  for (const [row, frequencies] of rows) {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]!;
      map[ch] = frequencies[i % frequencies.length]!;
    }
  }
  return map;
})();

const FALLBACK_PENTATONIC = PENTATONIC_432;

function freqFor(key: string): number {
  const lower = key.toLowerCase();
  const cached = FREQUENCY_BY_KEY[lower];
  if (cached !== undefined) return cached;
  const idx = lower.charCodeAt(0) % FALLBACK_PENTATONIC.length;
  return FALLBACK_PENTATONIC[idx]!;
}

interface UseHarmonicTypingOptions {
  enabled?: boolean;
  volume?: number;
  noteDuration?: number;
  attack?: number;
  release?: number;
}

interface UseHarmonicTypingReturn {
  playNote: (key: string) => void;
  toggleSound: () => void;
  isEnabled: boolean;
  setVolume: (vol: number) => void;
  volume: number;
}

/** Minimum ms between same-key plays. Held-down keys repeat every ~30ms
 *  via the OS auto-repeat; below this they layer into noise. */
const SAME_KEY_THROTTLE_MS = 25;

export function useHarmonicTyping(options: UseHarmonicTypingOptions = {}): UseHarmonicTypingReturn {
  const {
    enabled: initialEnabled = true,
    volume: initialVolume = 0.15,
    noteDuration = 150,
    attack = 0.01,
    release = 0.1,
  } = options;

  const [isEnabled, setIsEnabled] = useState(initialEnabled);
  const [volume, setVolumeState] = useState(initialVolume);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const lastPlayedAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = volume;
    }
  }, [volume]);

  // Close the context on unmount — this implicitly stops all in-flight
  // oscillators, so we don't have to track them individually.
  useEffect(() => {
    return () => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== 'closed') {
        void ctx.close().catch(() => {});
      }
      audioCtxRef.current = null;
      masterGainRef.current = null;
    };
  }, []);

  const playNote = useCallback(
    (key: string) => {
      if (!isEnabled) return;

      // Throttle rapid same-key repeats (OS auto-repeat).
      const now = performance.now();
      const last = lastPlayedAtRef.current.get(key) ?? 0;
      if (now - last < SAME_KEY_THROTTLE_MS) return;
      lastPlayedAtRef.current.set(key, now);

      // Lazy init — must happen in a user-gesture callback.
      let ctx = audioCtxRef.current;
      if (!ctx) {
        try {
          const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          ctx = new Ctor();
          const master = ctx.createGain();
          master.gain.value = volume;
          master.connect(ctx.destination);
          audioCtxRef.current = ctx;
          masterGainRef.current = master;
        } catch {
          return;
        }
      }
      if (ctx.state === 'suspended') void ctx.resume();
      const master = masterGainRef.current;
      if (!master) return;

      const frequency = freqFor(key);
      const t = ctx.currentTime;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + attack);
      env.gain.setValueAtTime(1, t + attack);
      env.gain.exponentialRampToValueAtTime(0.001, t + noteDuration / 1000 + release);
      env.connect(master);

      const fundamental = ctx.createOscillator();
      fundamental.type = 'sine';
      fundamental.frequency.value = frequency;
      fundamental.connect(env);

      // 2x harmonic (octave above) for tonal richness. Mixed quieter via
      // a dedicated gain so the fundamental still dominates.
      const harmonic = ctx.createOscillator();
      harmonic.type = 'sine';
      harmonic.frequency.value = frequency * 2;
      const harmonicGain = ctx.createGain();
      harmonicGain.gain.value = 0.15;
      harmonic.connect(harmonicGain);
      harmonicGain.connect(env);

      const stopAt = t + noteDuration / 1000 + release + 0.05;
      fundamental.start(t);
      harmonic.start(t);
      fundamental.stop(stopAt);
      harmonic.stop(stopAt);
      // No manual cleanup: WebAudio disconnects + GCs the oscillators
      // automatically after stop().
    },
    [isEnabled, volume, attack, noteDuration, release],
  );

  const toggleSound = useCallback(() => setIsEnabled((prev) => !prev), []);
  const setVolume = useCallback(
    (vol: number) => setVolumeState(Math.max(0, Math.min(1, vol))),
    [],
  );

  return { playNote, toggleSound, isEnabled, setVolume, volume };
}

export default useHarmonicTyping;
