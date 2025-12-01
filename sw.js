const CACHE = 'wheel-of-choices-v2';
const ASSETS = [
  './',
  './lost.css',
  './lost.js',
  './lost-ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=> self.skipWaiting())
  );
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
    //if (url.pathname === '/' || url.pathname.endsWith('/index.html')) {
      const cleanUrl = new URL(request.url);
      cleanUrl.search = '';
      cleanUrl.hash = '';
      cacheKey = cleanUrl.toString();
    //}

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
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
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
