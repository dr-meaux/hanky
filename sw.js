/* HANKY service worker — bump VERSION to ship a new build. */
const VERSION = 'v8';
const CACHE = 'hanky-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './game/style.css',
  './game/sim.js',
  './game/render.js',
  './game/story.js',
  './game/input.js',
  './game/net.js',
  './game/main.js',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* The page and the code that runs it have to arrive as a set: serving a new
   index.html next to a cached older script leaves buttons that do nothing and
   elements with no styling. So the shell is network-first, falling back to the
   cache when offline. Icons and images, which never change under the same
   name, stay cache-first. */
const SHELL = /\.(?:html|js|css|webmanifest)$/i;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const shell = req.mode === 'navigate' || SHELL.test(new URL(req.url).pathname);

  if (shell) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? './index.html' : req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html', { ignoreSearch: true }) : undefined)))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit =>
      hit ||
      fetch(req).then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
    )
  );
});
