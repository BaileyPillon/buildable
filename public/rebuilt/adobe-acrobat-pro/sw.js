/* Service worker generated at build time (scripts/sw-plugin.ts). Offline cache for the app shell.
   Nothing here ever stores user documents: only the application's own static files. */
const VERSION = '603f18100fe5';
const CACHE = 'pdf-toolkit-' + VERSION;
const PRECACHE = [
  "./",
  "./_headers",
  "./assets/index-BwiIIvIM.js",
  "./assets/index-D8ZQFYTs.css",
  "./assets/pdf.worker.min-CIqJB0yW.mjs",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./manifest.webmanifest",
  "./vendor/pdfjs/iccs/CGATS001Compat-v2-micro.icc",
  "./vendor/pdfjs/iccs/LICENSE",
  "./vendor/pdfjs/standard_fonts/FoxitDingbats.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitFixed.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSerif.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSymbol.pfb",
  "./vendor/pdfjs/standard_fonts/LICENSE_FOXIT",
  "./vendor/pdfjs/standard_fonts/LICENSE_LIBERATION",
  "./vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
  "./vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
  "./vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
  "./vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pdf-toolkit-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
