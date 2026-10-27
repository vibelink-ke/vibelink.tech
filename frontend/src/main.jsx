import React from 'react';
import { createRoot } from 'react-dom/client';
import CookieBanner from './ui/CookieBanner';
import './theme/global.css';

/**
 * Pages a customer opens from a link on their phone — their own page, a shared invoice, a staff badge scan, a website client's page — need none of the staff app: no
 * sidebar, no store, no router. They are loaded on their own, so a customer downloads a small page instead of the whole admin app. Everything else loads the app.
 */
const standalone = (() => {
  const p = window.location.pathname;
  if (p.startsWith('/customer')) return () => import('./screens/CustomerPortal');
  if (p.startsWith('/invoice/')) return () => import('./screens/InvoiceView');
  if (p.startsWith('/verify-staff/')) return () => import('./screens/VerifyStaff');
  if (p.startsWith('/web/')) return () => import('./screens/WebClientPortal');
  return null;
})();

const root = createRoot(document.getElementById('root'));
if (standalone) {
  standalone().then(({ default: Page }) => root.render(<React.StrictMode><Page /><CookieBanner /></React.StrictMode>));
} else {
  Promise.all([import('./App'), import('./state/store'), import('react-router-dom')]).then(([{ default: App }, { StoreProvider }, { BrowserRouter }]) => root.render(
    <React.StrictMode>
      <BrowserRouter>
        <StoreProvider>
          <App />
        </StoreProvider>
        <CookieBanner />
      </BrowserRouter>
    </React.StrictMode>
  ));
}

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
