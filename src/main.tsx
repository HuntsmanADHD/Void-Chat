import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Web fonts (Vite replacement for next/font/google).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

// Re-use the existing global stylesheet that Next's layout also imports.
// Stage E moves this file to src/index.css and deletes the Next layout.
import './app/globals.css';
import { App } from './App';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
