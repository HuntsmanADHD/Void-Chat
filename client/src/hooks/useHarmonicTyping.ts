import { useCallback, useRef, useEffect, useState } from 'react';

/**
 * 432Hz Harmonic Typing Sound Hook
 *
 * Creates musical tones based on 432Hz tuning when the user types.
 * 432Hz is considered a "natural" frequency that resonates with
 * the universe and creates a more harmonious sound.
 *
 * The hook generates different notes in a pentatonic scale based on
 * which key is pressed, creating a musical experience while typing.
 */

// 432Hz tuned pentatonic scale frequencies (A = 432Hz base)
// This creates a pleasant, non-dissonant sound regardless of key order
const PENTATONIC_SCALE_432 = [
  432.00,   // A4
  486.00,   // B4
  513.00,   // C#5
  648.00,   // E5
  729.00,   // F#5
  864.00,   // A5 (octave)
  972.00,   // B5
  1026.00,  // C#6
  1296.00,  // E6
];

// Extended scale for more variety
const EXTENDED_SCALE_432 = [
  216.00,   // A3
  243.00,   // B3
  256.50,   // C#4
  324.00,   // E4
  364.50,   // F#4
  ...PENTATONIC_SCALE_432,
];

// Map keyboard rows to different octaves for spatial sound
const ROW_FREQUENCIES: Record<string, number[]> = {
  // Number row - highest octave
  '1234567890': EXTENDED_SCALE_432.slice(9),
  // QWERTY row - high octave
  'qwertyuiop': EXTENDED_SCALE_432.slice(6, 15),
  // ASDF row - middle octave
  'asdfghjkl': EXTENDED_SCALE_432.slice(3, 12),
  // ZXCV row - low octave
  'zxcvbnm': EXTENDED_SCALE_432.slice(0, 9),
};

interface UseHarmonicTypingOptions {
  /** Whether sound is enabled */
  enabled?: boolean;
  /** Master volume (0-1) */
  volume?: number;
  /** Note duration in milliseconds */
  noteDuration?: number;
  /** Attack time (fade in) in seconds */
  attack?: number;
  /** Release time (fade out) in seconds */
  release?: number;
  /** Add subtle reverb effect */
  reverb?: boolean;
}

interface UseHarmonicTypingReturn {
  /** Play a note for a specific key */
  playNote: (key: string) => void;
  /** Toggle sound on/off */
  toggleSound: () => void;
  /** Whether sound is currently enabled */
  isEnabled: boolean;
  /** Set volume (0-1) */
  setVolume: (vol: number) => void;
  /** Current volume */
  volume: number;
}

/**
 * Get frequency for a specific key based on its keyboard position
 */
function getFrequencyForKey(key: string): number {
  const lowerKey = key.toLowerCase();

  // Find which row the key belongs to
  for (const [row, frequencies] of Object.entries(ROW_FREQUENCIES)) {
    const index = row.indexOf(lowerKey);
    if (index !== -1) {
      return frequencies[index % frequencies.length];
    }
  }

  // Default: use a hash of the key to pick a frequency
  const hash = lowerKey.charCodeAt(0) % PENTATONIC_SCALE_432.length;
  return PENTATONIC_SCALE_432[hash];
}

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

  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const activeOscillators = useRef<Set<OscillatorNode>>(new Set());

  // Initialize audio context on first interaction
  const initAudio = useCallback(() => {
    if (audioContextRef.current) return;

    try {
      audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      // Create master gain node
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = volume;
      gainNodeRef.current.connect(audioContextRef.current.destination);
    } catch (error) {
      console.warn('[HarmonicTyping] Could not initialize audio:', error);
    }
  }, [volume]);

  // Update gain when volume changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  // Cleanup on unmount
  useEffect(() => {
    // Store ref values in local variables inside the effect
    const oscillators = activeOscillators.current;
    const audioContext = audioContextRef.current;

    return () => {
      oscillators.forEach(osc => {
        try {
          osc.stop();
        } catch {
          // Ignore if already stopped
        }
      });
      if (audioContext) {
        audioContext.close();
      }
    };
  }, []);

  /**
   * Play a harmonic note for a key press
   */
  const playNote = useCallback((key: string) => {
    if (!isEnabled) return;

    // Initialize audio on first use (must be triggered by user interaction)
    initAudio();

    const ctx = audioContextRef.current;
    const masterGain = gainNodeRef.current;
    if (!ctx || !masterGain) return;

    // Resume audio context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const frequency = getFrequencyForKey(key);
    const now = ctx.currentTime;

    // Create oscillator
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine'; // Sine wave for pure, harmonic tone
    oscillator.frequency.value = frequency;

    // Create envelope (ADSR-like)
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, now + attack);
    envelope.gain.setValueAtTime(1, now + attack);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + (noteDuration / 1000) + release);

    // Add subtle harmonics for richness
    const harmonic = ctx.createOscillator();
    harmonic.type = 'sine';
    harmonic.frequency.value = frequency * 2; // First harmonic (octave)

    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.15; // Subtle harmonic

    // Connect the signal chain
    oscillator.connect(envelope);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(envelope);
    envelope.connect(masterGain);

    // Start and schedule stop
    oscillator.start(now);
    harmonic.start(now);

    const stopTime = now + (noteDuration / 1000) + release + 0.1;
    oscillator.stop(stopTime);
    harmonic.stop(stopTime);

    // Track active oscillators
    activeOscillators.current.add(oscillator);
    activeOscillators.current.add(harmonic);

    // Cleanup after note ends
    setTimeout(() => {
      activeOscillators.current.delete(oscillator);
      activeOscillators.current.delete(harmonic);
    }, noteDuration + (release * 1000) + 200);
  }, [isEnabled, initAudio, attack, noteDuration, release]);

  const toggleSound = useCallback(() => {
    setIsEnabled(prev => !prev);
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clampedVol = Math.max(0, Math.min(1, vol));
    setVolumeState(clampedVol);
  }, []);

  return {
    playNote,
    toggleSound,
    isEnabled,
    setVolume,
    volume,
  };
}

export default useHarmonicTyping;
