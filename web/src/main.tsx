import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { watchForAppUpdates } from './lib/pwa';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/chat.css';
import './styles/cards.css';
import './styles/details.css';
import './styles/modals.css';
import './styles/viewer.css';
import './styles/voice.css';
import './styles/mobile.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // A deployed worker claims this tab via skipWaiting + clients.claim; attach
  // before load/registration so an update arriving during startup is not missed.
  watchForAppUpdates(navigator.serviceWorker, () => window.location.reload());
  const registerSw = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline shell is best-effort */ });
  };
  if (document.readyState === 'complete') registerSw();
  else window.addEventListener('load', registerSw, { once: true });
}
