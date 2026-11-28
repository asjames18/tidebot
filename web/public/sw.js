// TideBot service worker: app-shell cache for fast standalone launches.
// API and preview traffic always go to the network; navigations fall back to the cached shell offline.
const CACHE = 'tidebot-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tidebot-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheable(res) {
  if (!res || !res.ok) return false;
  // Cache API rejects 206 Partial Content and opaque/error responses should not pollute the app cache.
  if (res.status !== undefined && res.status !== 200) return false;
  if (res.type !== undefined && res.type !== 'basic') return false;
  return true;
}

function isHtmlResponse(res) {
  const ct = res?.headers?.get?.('content-type');
  return typeof ct !== 'string' || ct.toLowerCase().includes('text/html');
}

function putSafe(e, key, res) {
  const copy = res.clone();
  const task = caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
  e.waitUntil?.(task);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (
    e.request.method !== 'GET' ||
    url.origin !== location.origin ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (isCacheable(res) && isHtmlResponse(res)) {
            putSafe(e, '/', res);
          }
          return res;
        })
        .catch(() => caches.match('/', {cacheName: CACHE})),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request, {cacheName: CACHE}).then((hit) => hit ?? fetch(e.request).then((res) => {
        if (isCacheable(res)) {
          putSafe(e, e.request, res);
        }
        return res;
      })),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, {cacheName: CACHE}).then((hit) => {
      const fresh = fetch(e.request).then((res) => {
        if (isCacheable(res)) {
          putSafe(e, e.request, res);
        }
        return res;
      });
      if (hit) {
        e.waitUntil?.(fresh.catch(() => {}));
        return hit;
      }
      return fresh;
    }),
  );
});
