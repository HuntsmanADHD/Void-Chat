import { useRealtime, type ConnectionState } from '@/hooks/useRealtime';

interface Display {
  label: string;
  className: string;
}

function describe(state: ConnectionState): Display | null {
  switch (state) {
    case 'ready':
      return null; // Steady state — banner hidden.
    case 'handshaking':
      return { label: 'Connecting…', className: 'bg-amber-900/40 text-amber-200 border-amber-700/50' };
    case 'connecting':
      return { label: 'Reconnecting…', className: 'bg-amber-900/40 text-amber-200 border-amber-700/50' };
    case 'disconnected':
      return { label: 'Disconnected', className: 'bg-red-900/40 text-red-200 border-red-700/50' };
  }
}

/**
 * Renders a small status pill when the relay connection is anything other
 * than `ready`. Lives at the top of chat surfaces; mounts/unmounts with
 * its parent — no global state to manage.
 */
export function ConnectionStatusBanner() {
  const { connectionState } = useRealtime();
  const display = describe(connectionState);
  if (!display) return null;
  return (
    <div className={`px-4 py-1.5 border-b text-xs flex items-center gap-2 ${display.className}`}>
      <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
      <span>{display.label}</span>
    </div>
  );
}

export default ConnectionStatusBanner;
