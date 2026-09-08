// sw.js — service worker: the Shell offline, and nothing else (ADR-0007).
// The CACHE version is a content hash of the SHELL files, stamped by
// `npm run stamp` (tools/stamp-sw.mjs). Do NOT edit it by hand — CI's
// `npm run stamp:check` fails the build if it is stale.
const CACHE = "edicola-dc921bce";

// Shell files to pre-cache (paths relative to the scope). Every shipped file
// belongs here; add yours and run `npm run stamp`.
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./src/styles.css",
  "./src/main.js",
  "./src/render.js",
  "./src/state.js",
  "./src/i18n.js",
  "./src/router.js",
  "./src/views/layout.js",
  "./src/views/today.js",
  "./src/views/saved.js",
  "./src/views/publications.js",
  "./src/views/settings.js",
  "./src/views/reader.js",
  "./src/views/story.js",
  "./src/views/not-found.js",
  "./src/feed.js",
  "./src/extract-core.js",
  "./src/extract.js",
  "./src/fetcher.js",
  "./src/retention.js",
  "./src/sync-plan.js",
  "./src/db.js",
  "./src/store.js",
  "./src/sync.js",
  "./src/sync-client.js",
  "./src/catalog.js",
  "./src/today-model.js",
  // The Catalog itself: without it the Publications screen is empty offline.
  "./data/catalog.json",
  "./src/settings.js",
  "./src/storage-usage.js",
  "./src/update.js",
  "./src/article-render.js",
  "./src/fetch-one.js",
  "./src/reading-position.js",
  "./src/item-state.js",
  "./src/evict.js",
  "./src/cover.js",
  "./src/item-actions.js",
];

// CDN hosts whose pinned modules the app loads at runtime (lit-html, and later
// Dexie, Readability, DOMPurify, all via esm.sh). Runtime-cached cache-first so
// they work offline after the first load. Transitive dependencies are covered
// because each fetched sub-module is cached on the way in.
const CDN_HOSTS = ["esm.sh"];

// Pre-cache the Shell and then WAIT. `skipWaiting()` is deliberately absent
// (ADR-0008): a new worker sits in `registration.waiting` until the reader
// confirms the update prompt, which posts `{ type: 'skip-waiting' }` below.
// A first install has no existing controller, so it activates immediately
// anyway and the very first visit is not held up.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The page posts the esm.sh URLs it loaded before this worker controlled it
// (see index.html), so the first online load leaves a complete offline cache.
self.addEventListener("message", (event) => {
  const data = event.data;
  // The reader confirmed the update prompt (src/update.js posts this exact
  // type). Activate now; `clients.claim()` in `activate` fires
  // `controllerchange` in every open tab, which is what reloads them together.
  if (data?.type === "skip-waiting") {
    self.skipWaiting();
    return;
  }
  if (data?.type !== "warm-cdn" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => {
    try {
      return CDN_HOSTS.includes(new URL(u).hostname);
    } catch {
      return false;
    }
  });
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          urls.map((u) =>
            cache.match(u).then((hit) => (hit ? undefined : cache.add(u))),
          ),
        ).catch(() => {}),
      ),
  );
});

// Cache-first: serve the cached copy if present, otherwise fetch and cache it.
// Used for immutable, versioned CDN modules.
function cacheFirst(request) {
  return caches.match(request).then(
    (cached) =>
      cached ||
      fetch(request).then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }),
  );
}

// Periodic Background Sync (Chromium, installed apps only; ADR-0007 treats it
// as an enhancement that is never relied upon). The worker cannot parse a Feed
// or sanitize HTML — no DOMParser, no DOMPurify — so it does not sync itself.
// It only wakes any open client, whose page thread runs syncIfStale().
self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "edicola-sync") return;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: "periodic-sync" });
      }
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isCdn = CDN_HOSTS.includes(url.hostname);
  const sameOrigin = url.origin === self.location.origin;

  if (isCdn) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Any other origin — Feeds, Originals, the Proxy, thumbnails — is content.
  // Content lives in IndexedDB (ADR-0003); the worker never intercepts or
  // caches it (ADR-0007).
  if (!sameOrigin) return;

  // Shell: stale-while-revalidate. Serve the cached copy immediately and, in the
  // background, refresh the cache from the network so the *next* load is fresh
  // even if the CACHE version was not bumped. On a cache miss, await the network.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => cached);
      // Keep the worker alive until the background refresh settles (best-effort).
      if (cached) event.waitUntil(network.catch(() => {}));
      return cached || network;
    }),
  );
});
