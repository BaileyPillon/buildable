import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts (CSP is font-src 'self'): latin subsets only.
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './ui/styles.css';
import './ui/landing.css';
import './ui/results.css';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
