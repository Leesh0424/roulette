// Minimal offline cache so the installed app still opens without a
// network connection. All app logic lives inline in index.html, so
// there's nothing else to precache.
const CACHE_NAME = "roulette-cache-v2";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  // Only ever serve this app's own files from the cache. Anything else --
  // above all the Google Sheet sync calls -- must go straight to the
  // network, or a stale snapshot could be replayed as if it were current.
  if (url.origin !== self.location.origin) return;

  const remembering = (response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  };

  // The page itself is network-first, so a deploy reaches everyone on their
  // next load rather than one load later; the cache is the offline fallback.
  if (event.request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(event.request)
        .then(remembering)
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Icons and the manifest barely change, so cache-first is fine for them.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then(remembering).catch(() => cached);
      return cached || network;
    })
  );
});
