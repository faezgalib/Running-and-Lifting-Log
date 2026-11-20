// Offline cache. Bump VERSION whenever app files change so phones pick up the update.
// Cache-first: the app opens from the phone and uses no data. The browser only re-checks this
// small file (~1 KB); the full app (~120 KB) is downloaded again only when VERSION changes.
const VERSION = 'lrj-2.4';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/seed.js', 'js/recommend.js', 'js/hevy.js', 'js/charts.js', 'js/muscles.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      if (e.request.mode === 'navigate') return caches.match('index.html').then(r => r || fetch(e.request));
      return fetch(e.request);
    })
  );
});
