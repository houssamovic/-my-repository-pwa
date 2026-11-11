const CACHE = 'repository-shell-v1-14-rating-filters';
const SHELL = ['./', './index.html', './share.html', './share-receiver.css', './share-receiver.js', './styles.css', './classifier.js', './cloud-vault.js', './date-filter.js', './projects.js', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './favicon.ico'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),self.clients.claim()]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname === '/share.html' ? './share.html' : './index.html')));
  } else if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  } else {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  }
});
