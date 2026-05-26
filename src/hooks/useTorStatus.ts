import { useEffect, useState } from 'react';

/**
 * Hook that surfaces the local Tor hidden service status to the React tree.
 *
 * Subscribes to the `tor://status` event the Rust side emits whenever
 * bootstrap progress changes or the hostname becomes available, and
 * primes the initial value with the `tor_status` Tauri command on mount.
 *
 * Outside of Tauri (browser dev mode), returns a permanent "unavailable"
 * state — the rest of the UI can branch on `available` to decide whether
 * to render Tor-specific affordances.
 */

export interface TorStatus {
  bootstrapPct: number;
  hostname: string | null;
  error: string | null;
}

export interface UseTorStatusReturn extends TorStatus {
  /** True when the Tauri runtime is reachable (i.e. we're in the desktop
   *  app, not a plain browser). False means the rest of the values are
   *  defaults and Tor isn't running in this context. */
  available: boolean;
}

const EMPTY_STATUS: TorStatus = { bootstrapPct: 0, hostname: null, error: null };

/** Quick runtime test for the Tauri host. The IPC bridge injects
 *  __TAURI_INTERNALS__ onto the window object before the page loads. */
function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function useTorStatus(): UseTorStatusReturn {
  const [status, setStatus] = useState<TorStatus>(EMPTY_STATUS);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!inTauri()) return;
    setAvailable(true);

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const initial = await invoke<TorStatus>('tor_status');
        if (!cancelled) setStatus(initial);

        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<TorStatus>('tor://status', (event) => {
          setStatus(event.payload);
        });
      } catch (err) {
        console.warn('[useTorStatus] failed to wire Tor IPC:', err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return { ...status, available };
}

export default useTorStatus;
