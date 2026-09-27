/*
 * Offline support for Logbook PrepOS. Pages: network first, falling back to the last copy. Built assets (/_next/static,
 * content-hashed) and fonts: cache first. The API (/api/*) is never cached; account sync and AI simply wait until online.
 * Your data never goes through this cache: it lives in the browser copy and in your preparation file.
 */
const VERSION = 'prepos-v2';
const PAGES = VERSION + '-pages', ASSETS = VERSION + '-assets';

self.addEventListener('install', e => { e.waitUntil(caches.open(PAGES).then(c => c.addAll(['/'])).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(PAGES).then(c => c.put(url.pathname === '/' ? '/' : req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('/'))));
    return;
  }
  const isStatic = url.origin === self.location.origin && (url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg' || url.pathname === '/manifest.webmanifest');
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isStatic && !isFont) return;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(ASSETS).then(c => c.put(req, copy)); }
    return res;
  })));
});
