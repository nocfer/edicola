---
status: accepted
---
# The service worker caches only the Shell and CDN modules

The service worker precaches the Shell, runtime-caches pinned esm.sh modules
cache-first, and does not intercept Feed, Original or Proxy requests at all.
Sync runs on the page thread when the app opens or on demand, yielding between Items (a Web Worker was rejected: `DOMParser` and DOMPurify are unavailable there, and both parsing and Extraction need them), and
Periodic Background Sync is registered only as an opportunistic enhancement
where the browser supports it. We chose this over service-worker-driven sync
because content belongs in the database (ADR-0003), background sync is
Chromium-only and browser-throttled, and a service worker that fetches content
is much harder to debug than one that serves files.

## Consequences

- The UI shows when content was last refreshed, because the app cannot promise
  freshness on open.
- The Shell cache name is content-hashed by `npm run stamp`; CI fails when it is
  stale.
