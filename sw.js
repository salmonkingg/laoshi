// sw.js — lets the installed app open without internet.
// It keeps a copy of the app's files on the device and uses the copy when offline.
// Change VERSION whenever the app files change, so devices fetch the new copy.
const VERSION = 'laoshi-v8';
const FILES = [
  './', 'index.html', 'style.css', 'questions.js', 'app.js', 'lib/hanzi-writer.min.js',
  'data/hsk1.json', 'data/strokes.json', 'data/extra-questions.json', 'data/radicals.json',
  'manifest.webmanifest', 'icons/favicon-64.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Try the network first so updates arrive; fall back to the saved copy when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes('fonts.g'))) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
