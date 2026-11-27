/* Service worker.
   1) Image cache: sprites/backgrounds from the image host are saved the first time they load, so later visits need no network.
   2) App shell cache: the site's own files are kept so the installed app opens instantly and still opens offline
      (stale-while-revalidate: you get the saved copy immediately and the fresh one is stored for next time).
   Supabase / Discord and every other API request is never touched. Bump SHELL / CACHE to force a refresh. */
const CACHE = 'pokedex-images-v5';
const SHELL = 'pokedex-shell-v20261126a';
const IMG_PATH = /^\/(rinfinitely\/pokedex\/main\/(sprites|backgrounds)|Normal|Shiny|Backgrounds|normal|shiny|backgrounds|icons?)\//i;
const PRECACHE = ['/', '/index.html', '/styles.css', '/theme.css', '/pgtrade.css', '/more.css', '/manifest.webmanifest', '/favicon.svg', '/favicon.png', '/icon-192.png', '/icon-512.png', '/shadow-aura.png', '/lucky-aura.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith('pokedex-images-') && k !== CACHE) || (k.startsWith('pokedex-shell-') && k !== SHELL)).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // same-origin: the app itself
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {          // pages: network first (always fresh when online), saved copy when offline
      e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(SHELL).then(c => c.put('index.html', copy)).catch(() => {}); return res; })
        .catch(() => caches.match('index.html').then(r => r || caches.match('./'))));
      return;
    }
    /* Versioned JS/CSS (…js?v=123): the URL changes whenever the file changes, so the saved copy is always the right one.
       Serve it straight from cache (no network wait); a new ?v= number is simply a cache miss and gets downloaded once. */
    if (/\.(js|css)$/i.test(url.pathname) && url.searchParams.has('v')) {
      e.respondWith(caches.open(SHELL).then(async c => {
        const hit = await c.match(req);
        if (hit) return hit;
        try { const res = await fetch(req); if (res && res.ok) c.put(req, res.clone()).catch(() => {}); return res; }
        catch { return Response.error(); }
      }));
      return;
    }
    if (/\.(js|css|png|svg|json|webmanifest|txt|woff2?)$/i.test(url.pathname)) {
      /* Network-first for JS/CSS so code updates always apply; fall back to cache offline */
      e.respondWith(caches.open(SHELL).then(async c => {
        try {
          const res = await fetch(req);
          if (res && res.ok) c.put(req, res.clone()).catch(() => {});
          return res;
        } catch {
          return (await c.match(req)) || Response.error();
        }
      }));
    }
    return;
  }

  // cross-origin: only the sprite/background host
  if (!IMG_PATH.test(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url.href);
    if (hit) return hit;
    try {
      const res = await fetch(url.href, { mode: 'cors', credentials: 'omit' });   // CORS copy = normal (not opaque) response, small to store
      if (res.ok) cache.put(url.href, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      return fetch(req);   // CORS not available: just load it normally, uncached
    }
  })());
});

/* ---- Web Push (sent by the push-notify edge function) ---- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'GO Dex', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'GO Dex', { body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || 'godex', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return (c.navigate ? c.navigate(url).then(x => (x || c).focus()) : c.focus()).catch(() => c.focus());
    return self.clients.openWindow(url);
  }));
});
