const CACHE = 'lost-js-v2';
const ASSETS = [
  './',
  './lost.css',
  './lost.js',
  './lost-ui.js',
  './vendor/lost/lost.css',
  './vendor/lost/lost.js',
  './vendor/lost/lost-ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      ASSETS.map(async (url) => {
        try {
          await cache.add(url);
        } catch (_) {
        }
      })
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    const url = new URL(request.url);
    let cacheKey = request;
    const cleanUrl = new URL(request.url);
    cleanUrl.search = '';
    cleanUrl.hash = '';
    cacheKey = cleanUrl.toString();

    const cached = await cache.match(cacheKey);

    const fetchPromise = fetch(request)
      .then(async (response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(cacheKey, response.clone());
        }
        return response;
      })
      .catch(() => undefined);

    if (request.mode === 'navigate') {
      const networkResponse = await fetchPromise;
      if (networkResponse) return networkResponse;
      if (cached) return cached;
      return new Response('', { status: 503, statusText: 'Offline' });
    }

    if (cached) {
      event.waitUntil(fetchPromise);
      return cached;
    }

    const networkResponse = await fetchPromise;
    if (networkResponse) return networkResponse;

    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  })());
});
