// Service worker for offline use. Built into dist/sw.js by offline() in vite.config.ts, which fills
// in the lists below; see there for how caching works.
const VERSION = __VERSION__;
const SHELL = __SHELL__;
const START_MAPS = __START_MAPS__;
const KEEP = new Set(__KEEP__);
const SHELL_CACHE = 'shell-' + VERSION;
const MEDIA_CACHE = 'media';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await (await caches.open(SHELL_CACHE)).addAll(SHELL);
    // start-up maps: only the ones not cached yet (unchanged files keep their URL between releases)
    const media = await caches.open(MEDIA_CACHE);
    for (const url of START_MAPS) {
      if (!(await media.match(url))) {
        try {
          const res = await fetch(url);
          if (res.ok) await media.put(url, res);
        } catch (e) {
          // offline during install: they will be cached when used
        }
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('shell-') && key !== SHELL_CACHE) await caches.delete(key);
    const media = await caches.open(MEDIA_CACHE);
    for (const req of await media.keys()) {
      const u = new URL(req.url);
      if (!KEEP.has(u.pathname + u.search)) await media.delete(req);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // pages: fresh from the network; offline, the app's page (it finds the body from the address)
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  if (/^\/(assets|textures|models|voice|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest')
    event.respondWith(cached(req, url));
});

async function cached(req, url) {
  const key = url.pathname + url.search;
  let res = await caches.match(key);
  if (!res) {
    res = await fetch(key); // the whole file, even if the browser asked for a part
    if (res.ok && KEEP.has(key)) await (await caches.open(MEDIA_CACHE)).put(key, res.clone());
  }
  const range = req.headers.get('range');
  if (!range || !res.ok) return res;
  // Safari's audio element reads in byte ranges and plays nothing from a plain 200
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = 0, end = size - 1;
  if (m && m[1]) {
    start = Number(m[1]);
    if (m[2]) end = Math.min(Number(m[2]), size - 1);
  } else if (m && m[2]) {
    start = Math.max(0, size - Number(m[2]));
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
