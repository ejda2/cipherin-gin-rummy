// sw.js - offline app shell for Cipherin Gin Rummy.
//
// Firestore's own persistentLocalCache (see firebase-init.js) handles
// offline data. This handles the other half: letting the page itself
// open with no network at all. Bump CACHE_NAME on future deploys if you
// want to force clients to drop stale cached files.

const CACHE_NAME = "gin-rummy-shell-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./firebase-init.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Network-first, falling back to cache. While online this always picks up
// a fresh deploy; the instant a fetch fails (no connection), whatever was
// last cached takes over so the game still loads.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

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
