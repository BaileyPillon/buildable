import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initInstallPrompt } from './lib/install';
import { initStore } from './lib/store';
import { applyStoredTheme } from './lib/theme';
import './styles.css';

applyStoredTheme();
initInstallPrompt();
void initStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      /* offline support is a bonus; the app works without it */
    });
  });
}
