// Bump the version whenever an app file changes, so phones pick up the update.
// Every file the app loads must be listed here, or it won't work offline.
const CACHE = 'matzpen-v3';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/main.js',
  'js/util.js',
  'js/db.js',
  'js/claude.js',
  'js/nav.js',
  'js/checkin.js',
  'js/tasks.js',
  'js/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
