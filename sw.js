// Service worker: precaches the whole app so it works fully offline.
// BUMP CACHE_VERSION ON EVERY CHANGE so the new files reach the phone.
const CACHE_VERSION = 'dayos-v1';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/codes.js',
  './js/examples.js',
  './js/planner.js',
  './js/report.js',
  './js/storage.js',
  './js/tracker.js',
  './js/ui.js',
  './js/util.js',
  './js/workout.js',
  './js/views/common.js',
  './js/views/more.js',
  './js/views/now.js',
  './js/views/paste.js',
  './js/views/today.js',
  './js/views/tracker-view.js',
  './js/views/workout-view.js',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // cache: 'reload' skips the HTTP cache so a new version gets fresh files.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dayos-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: always answer with the cached app shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((hit) => hit || fetch(req).catch(() => caches.match('./'))),
    );
    return;
  }

  // Everything else: cache first, then network (and keep a copy).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
