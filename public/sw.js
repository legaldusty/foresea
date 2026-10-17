const SHELL = 'giveway-shell-v1';
const TILES = 'giveway-tiles-v1';
const TILE_URL = '/tiles/harbor.pmtiles';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/captain'])).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, TILES]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function cachedTiles() {
  const cache = await caches.open(TILES);
  return cache.match(TILE_URL);
}

async function fillTiles() {
  const cache = await caches.open(TILES);
  if (await cache.match(TILE_URL)) return;
  const res = await fetch(TILE_URL);
  if (res.ok) await cache.put(TILE_URL, res);
}

async function rangeFromCache(request) {
  const full = await cachedTiles();
  if (!full) {
    fillTiles().catch(() => undefined);
    return fetch(request);
  }
  const header = request.headers.get('range');
  const buf = await full.arrayBuffer();
  if (!header) return new Response(buf, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(buf.byteLength) } });
  const match = /bytes=(\d+)-(\d*)/.exec(header);
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), buf.byteLength - 1) : buf.byteLength - 1;
  const slice = buf.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${buf.byteLength}`,
      'content-length': String(slice.byteLength),
      'accept-ranges': 'bytes',
    },
  });
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || (await cache.match('/captain')) || (await cache.match('/')) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;
  if (url.pathname === TILE_URL) { event.respondWith(rangeFromCache(event.request)); return; }
  if (event.request.mode === 'navigate') { event.respondWith(networkFirst(event.request)); return; }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/fonts/')) { event.respondWith(cacheFirst(event.request)); return; }
  event.respondWith(networkFirst(event.request));
});

self.addEventListener('message', (event) => {
  if (event.data === 'cache-tiles') event.waitUntil(fillTiles());
});

self.addEventListener('push', (event) => {
  let msg = { title: 'GIVE WAY', body: 'New harbor notice', tag: 'giveway', url: '/captain', priority: 'P3', requireInteraction: false };
  try { msg = { ...msg, ...event.data.json() }; } catch { msg.body = event.data ? event.data.text() : msg.body; }
  const urgent = msg.priority === 'P1';
  event.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body,
    tag: msg.tag,
    renotify: true,
    requireInteraction: urgent || msg.requireInteraction,
    vibrate: urgent ? [400, 120, 400, 120, 400] : [200],
    icon: '/icons/icon-192.png',
    data: { url: msg.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/captain';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).pathname.startsWith('/captain')) { await c.focus(); c.postMessage({ type: 'open-notice', url: target }); return; }
    }
    await self.clients.openWindow(target);
  })());
});
