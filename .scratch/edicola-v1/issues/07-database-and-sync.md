# 07 — Database and the Sync pipeline

**What to build:** The Dexie schema (version 1, every table the spec names)
and the Sync pipeline that, given Enabled Publications, fetches Feeds, stores
new Items, Pre-fetches Articles and images within the caps, and records the
last Sync. The pipeline is tested at its seam with a fake fetcher, fixtures and
a fake store, and runs in the browser inside a module Web Worker. Today (ticket
09) will drive it; this ticket exposes the API and a minimal "Sync now" hook in
Settings to prove it end to end.

**Blocked by:** 01 (Shell), 02 (feed parsing), 03 (extraction), 04 (fetcher), 05 (planners).

**Status:** ready-for-agent

**Owns:** `src/db.js`, `src/store.js` (the storage interface the pipeline
consumes, implemented over Dexie), `src/sync.js`, `src/sync-worker.js`,
`src/sync-client.js`, `test/sync.test.js`, `test/fixtures/sync/**`. May add
its new files to `SHELL` in `sw.js` and run `npm run stamp`. May add a "Sync
now" button and last-Sync line to the Settings placeholder and strings to
`i18n.js`.

- [ ] `src/db.js` is the Dexie choke point (esm.sh, pinned) and defines version 1: `publications` (id, name, country, language, category, feedUrl, siteUrl, truncated, custom, enabled, lastSyncedAt, lastError), `items` (id, publicationId, title, link, publishedAt, summaryHtml [sanitized], summaryText, thumbnailUrl, read, saved, readingPosition, summaryOnly, summaryOnlyReason, hasArticle, fetchedAt; indexes on publicationId, publishedAt, saved, [publicationId+publishedAt]), `articles` (itemId, title, byline, html, wordCount, bytes, extractedAt), `images` (key = sha-256 of url, url, blob, bytes, itemId; index on itemId), `settings` (key, value), `meta` (key, value) holding `schemaVersion`, `appVersion`, `lastSyncAt`.
- [ ] `src/store.js` wraps Dexie in the small interface the pipeline needs (`getEnabledPublications`, `upsertItems`, `itemsNeedingArticles`, `putArticle`, `putImages`, `markSummaryOnly`, `setLastSynced`, `trimItems`) so tests can supply an in-memory implementation. Document the interface with a JSDoc typedef.
- [ ] `src/sync.js`: `runSync({ store, fetcher, parseFeed, extractArticle, sanitizeSummary, plan, now, limits, onProgress })`. Steps: plan Feed fetches; fetch and parse each (record `lastError` on failure, continue); sanitize Summaries; upsert Items; trim per Publication; plan Article fetches; for each, fetch the Original, extract, on `ok` fetch images through `fetchBlob` with the per-Article cap, store Article and images, set `hasArticle`; on not-ok mark Summary-only with the reason; one retry per fetch failure then move on; concurrency 4 via a small pool; write `lastSyncAt`. Returns a summary `{ feedsOk, feedsFailed, articlesOk, articlesSummaryOnly, bytesStored }`.
- [ ] `src/sync-worker.js` is a module worker that imports the browser choke points (`extract.js`, `fetcher.js`, `feed.js`, `db.js` via `store.js`) and runs `runSync` on message, posting progress and the summary. `src/sync-client.js` starts it, exposes `syncNow()` returning a promise and `onProgress`, and implements "sync on open if last Sync older than 15 minutes" and the `navigator.storage.persist()` request on first Sync (ADR-0003). Register Periodic Background Sync opportunistically behind a feature check (ADR-0007).
- [ ] `test/sync.test.js` drives `runSync` with an in-memory store, a fake fetcher serving fixtures by URL, the real `parseFeed`/`extractArticle` from tickets 02 and 03 with the Node DOM, and asserts: Items stored and sanitized; the cap of 10 Articles per Publication; round-robin order of Article fetches across two Publications; a thin Original yields Summary-only with `too-short`; a Feed that 500s records `lastError` and does not abort the run; images over the cap are skipped and the Article still stored.
- [ ] Settings shows "Sync now" and "Last synced: …" wired through `sync-client.js`; verified in the browser with at least one Catalog Feed via a CDP screenshot.
- [ ] New Shell files added to `SHELL`, `npm run stamp` run, all gates green.
