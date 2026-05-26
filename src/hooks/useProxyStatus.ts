import { useEffect, useState } from 'react';

/**
 * Surface the onion forward proxy's health to the React tree. Rust
 * emits `proxy://status` from setup with `{ ok, error }` after it tries
 * to bind 127.0.0.1:11811. If the bind fails (port collision, sandbox
 * restriction), cross-host invites silently won't work — without this
 * hook the user would just get a "join failed" toast with no actionable
 * info. Showing the proxy error in Settings tells them what to fix.
 */

export interface ProxyStatus {
  /** True when the proxy is bound and accepting connections. */
  ok: boolean;
  /** Human-readable error if the proxy failed to start. */
  error: string | null;
  /** Whether the Tauri runtime is available — false in pure browser dev. */
  available: boolean;
}

const EMPTY: ProxyStatus = { ok: false, error: null, available: false };

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function useProxyStatus(): ProxyStatus {
  const [status, setStatus] = useState<ProxyStatus>(EMPTY);

  useEffect(() => {
    if (!inTauri()) return;
    setStatus((s) => ({ ...s, available: true }));

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ ok: boolean; error: string | null }>(
          'proxy://status',
          (event) => {
            if (cancelled) return;
            setStatus({
              ok: !!event.payload.ok,
              error: event.payload.error ?? null,
              available: true,
            });
          },
        );
      } catch (err) {
        console.warn('[useProxyStatus] could not wire IPC:', err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return status;
}

export default useProxyStatus;
