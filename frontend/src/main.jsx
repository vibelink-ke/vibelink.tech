import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { StoreProvider } from './state/store';
import './theme/global.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Registered from the app shell rather than left to the browser to notice
// on its own — makes the app installable (the manifest link alone is not
// enough without a controlling service worker) and is what push
// notifications arrive through even with no tab open. Skipped outside a
// secure context: an http:// dev server throws on register() rather than
// quietly doing nothing.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker not registered:', e.message));
  });
}
