import { useCallback, useEffect, useState } from 'react';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { Session } from '@/types/session';

const SESSION_KEYS_STORAGE = 'voidchat_session_keys'; // sessionStorage
const DISPLAY_NAME_STORAGE = 'voidchat_display_name'; // localStorage

interface StoredKeys {
  signingPublicKey: string;
  signingSecretKey: string; // base58
  boxPublicKey: string;
  boxSecretKey: string; // base58
  createdAt: number;
}

function generateSession(displayName: string): Session {
  const signingKeypair = nacl.sign.keyPair();
  const boxKeypair = nacl.box.keyPair();
  const signingPublicKey = bs58.encode(signingKeypair.publicKey);
  const boxPublicKey = bs58.encode(boxKeypair.publicKey);
  return {
    signingPublicKey,
    signingSecretKey: signingKeypair.secretKey,
    boxPublicKey,
    boxSecretKey: boxKeypair.secretKey,
    displayName,
    createdAt: Date.now(),
    publicId: signingPublicKey,
    publicKey: boxPublicKey,
    signature: '',
  };
}

function persistSession(session: Session): void {
  const stored: StoredKeys = {
    signingPublicKey: session.signingPublicKey,
    signingSecretKey: bs58.encode(session.signingSecretKey),
    boxPublicKey: session.boxPublicKey,
    boxSecretKey: bs58.encode(session.boxSecretKey),
    createdAt: session.createdAt,
  };
  sessionStorage.setItem(SESSION_KEYS_STORAGE, JSON.stringify(stored));
}

function loadStoredSession(displayName: string): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEYS_STORAGE);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredKeys;
    return {
      signingPublicKey: stored.signingPublicKey,
      signingSecretKey: bs58.decode(stored.signingSecretKey),
      boxPublicKey: stored.boxPublicKey,
      boxSecretKey: bs58.decode(stored.boxSecretKey),
      displayName,
      createdAt: stored.createdAt,
      publicId: stored.signingPublicKey,
      publicKey: stored.boxPublicKey,
      signature: '',
    };
  } catch {
    sessionStorage.removeItem(SESSION_KEYS_STORAGE);
    return null;
  }
}

function randomDisplayName(): string {
  const adjectives = ['silent', 'hidden', 'ghostly', 'fleeting', 'ephemeral', 'unseen', 'masked', 'distant'];
  const nouns = ['void', 'echo', 'shade', 'wisp', 'cipher', 'drift', 'specter', 'whisper'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${adj}-${noun}-${num}`;
}

interface UseSessionReturn {
  session: Session | null;
  displayName: string;
  setDisplayName: (name: string) => void;
  isReady: boolean;
}

/**
 * Ephemeral session hook. Generates a fresh signing + box keypair on first
 * load of a tab, persists keys to sessionStorage (gone on tab close), and
 * persists only the display name to localStorage as a convenience.
 */
export function useSession(): UseSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayNameState] = useState<string>('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedName = localStorage.getItem(DISPLAY_NAME_STORAGE) || randomDisplayName();
    if (!localStorage.getItem(DISPLAY_NAME_STORAGE)) {
      localStorage.setItem(DISPLAY_NAME_STORAGE, storedName);
    }
    setDisplayNameState(storedName);

    let loaded = loadStoredSession(storedName);
    if (!loaded) {
      loaded = generateSession(storedName);
      persistSession(loaded);
    }
    setSession(loaded);
    setIsReady(true);
  }, []);

  const setDisplayName = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 32);
    if (!trimmed) return;
    localStorage.setItem(DISPLAY_NAME_STORAGE, trimmed);
    setDisplayNameState(trimmed);
    setSession((prev) => (prev ? { ...prev, displayName: trimmed } : prev));
  }, []);

  return { session, displayName, setDisplayName, isReady };
}

export default useSession;
