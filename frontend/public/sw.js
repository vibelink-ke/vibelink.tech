// Bumped on every deploy that changes what needs caching — a stale cache
// name is how an installed PWA keeps serving yesterday's app shell forever,
// since the browser only checks for a new service worker file, never
// re-evaluates what an unchanged one already cached.
const CACHE = 'vibelink-shell-v1';

// The app shell only — never API responses. Caching a GET to /api/... would
// mean a customer's own billing data survives in a service worker cache
// across sessions/devices in a way nothing here is designed to invalidate
// correctly; the shell (this file's own scope) is static per deploy and
// safe to keep offline.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.json'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, falling back to the cached shell only when genuinely
// offline — a stale cached page silently masking a real deploy would be
// worse than just failing, for an app whose whole job is showing live
// billing/network state.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((r) => r ?? caches.match('/')))
  );
});

// A router-down/SLA/payment alert, pushed from jobs.js's notifyOwner via
// push.js — shown even with no tab open, which is the entire reason this
// file exists rather than relying on an in-app toast.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* non-JSON payload, show generic */ }
  const title = data.title || 'Vibelink';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/favicon.svg',
    data: { url: data.url || '/' },
  }));
});

// Focus an already-open tab on this origin rather than always opening a new
// one — a staff member with the app already open should land back on it,
// not accumulate a fresh tab per alert.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) return existing.focus().then(() => existing.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});
