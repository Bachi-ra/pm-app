const CACHE_NAME = 'pm-app-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './js/app.js',
  './js/api.js',
  './js/dashboard.js',
  './js/tasks.js',
  './js/gantt.js',
  './js/members.js',
  './js/memos.js',
  './js/links.js',
  './js/utils.js',
  './js/firebaseClient.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
