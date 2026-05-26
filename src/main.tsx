import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { initProxyToken } from '@/lib/relayBase';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import './index.css';
import { App } from './App';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing in index.html');

// Fetch the onion-proxy token from Rust before we mount, so the
// relayBaseFor() helpers can return ready-to-use URLs. In a browser
// (no Tauri) the call no-ops; cross-host proxy isn't reachable anyway.
// The fetch is fast (<1ms over IPC), so blocking render is cheaper than
// dealing with "URL ready" plumbing in every component.
void initProxyToken().finally(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
