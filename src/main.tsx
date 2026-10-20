import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeDesktopSession } from './lib/api';

async function start() {
  // Authenticated application data must never be cached by an older PWA worker.
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  }
  await initializeDesktopSession();
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
start().catch(error => {
  const root = document.getElementById('root')!;
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.style.cssText = 'padding:40px;max-width:700px;line-height:1.7';
  message.textContent = String(error instanceof Error ? error.message : error);
  root.replaceChildren(message);
});
