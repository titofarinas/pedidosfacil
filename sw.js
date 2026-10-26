const CACHE = 'pedidos-v1';
const ASSETS = [
  './',
  './index.html',
  './panel.html',
  './manifest.json',
  './assets/css/styles.css',
  './assets/css/panel.css',
  './assets/js/app.js',
  './assets/js/panel.js',
  './assets/js/config.js',
  './assets/js/productos.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res.ok && url.origin === location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
