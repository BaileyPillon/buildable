/* Generated into dist/sw.js at build time. Cache-first app shell; all user data lives in IndexedDB. */
const VERSION = 'f24cec41e7';
const CACHE = 'flashcards-plus-' + VERSION;
const PRECACHE = [
 "./",
 "apple-touch-icon.png",
 "assets/index-Bp-rvwN7.js",
 "assets/index-q0SEn4m7.css",
 "icon-192.png",
 "icon-512.png",
 "icon-maskable-512.png",
 "icon.svg",
 "index.html",
 "manifest.webmanifest"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((p) => new URL(p, self.registration.scope).href)),
    ),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('flashcards-plus-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') {
          const shell = await cache.match(new URL('./index.html', self.registration.scope).href);
          if (shell) return shell;
        }
        throw err;
      }
    }),
  );
});
