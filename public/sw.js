const SHELL = 'foresea-shell-v4';
const TILES = 'giveway-tiles-v3';
const PMTILES_MAGIC = 'PMTiles';
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

function u64(view, at) {
  return view.getUint32(at, true) + view.getUint32(at + 4, true) * 4294967296;
}

async function isTileFile(res) {
  if (!res || !res.ok || res.status !== 200) return false;
  if ((res.headers.get('content-type') || '').includes('text/html')) return false;
  const buf = await res.clone().arrayBuffer();
  if (buf.byteLength < 127) return false;
  const head = new Uint8Array(buf, 0, PMTILES_MAGIC.length);
  if (String.fromCharCode(...head) !== PMTILES_MAGIC) return false;
  const view = new DataView(buf);
  const needed = Math.max(u64(view, 8) + u64(view, 16), u64(view, 24) + u64(view, 32), u64(view, 40) + u64(view, 48), u64(view, 56) + u64(view, 64));
  return buf.byteLength >= needed;
}

let goodBlob = null;

async function tileBlob() {
  if (goodBlob) return goodBlob;
  const cache = await caches.open(TILES);
  const hit = await cache.match(TILE_URL);
  if (!hit) return null;
  if (!(await isTileFile(hit))) { await cache.delete(TILE_URL); return null; }
  goodBlob = await hit.blob();
  return goodBlob;
}

let filling = null;

async function fillTiles() {
  if (filling) return filling;
  filling = (async () => {
    if (await tileBlob()) return;
    const cache = await caches.open(TILES);
    const res = await fetch(TILE_URL, { cache: 'no-store' });
    if (await isTileFile(res)) { await cache.put(TILE_URL, res); goodBlob = null; }
  })().finally(() => { filling = null; });
  return filling;
}

async function tilesNetworkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) return res;
    throw new Error('bad tile response');
  } catch {
    return rangeFromCache(request);
  }
}

async function rangeFromCache(request) {
  const blob = await tileBlob();
  if (!blob) return fetch(request);
  const header = request.headers.get('range');
  if (!header) return new Response(blob, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(blob.size) } });
  const match = /bytes=(\d+)-(\d*)/.exec(header);
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), blob.size - 1) : blob.size - 1;
  const slice = blob.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${blob.size}`,
      'content-length': String(slice.size),
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
  if (hit && !(hit.headers.get('content-type') || '').includes('text/html')) return hit;
  const res = await fetch(request);
  if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;
  if (url.pathname === TILE_URL) { event.respondWith(tilesNetworkFirst(event.request)); return; }
  if (event.request.mode === 'navigate') { event.respondWith(networkFirst(event.request)); return; }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/fonts/')) { event.respondWith(cacheFirst(event.request)); return; }
  event.respondWith(networkFirst(event.request));
});

self.addEventListener('message', (event) => {
  if (event.data === 'cache-tiles') event.waitUntil(fillTiles());
});

self.addEventListener('push', (event) => {
  let msg = { title: 'Foresea', body: 'New harbor notice', tag: 'giveway', url: '/captain', priority: 'P3', requireInteraction: false };
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
