# 07 — Database and the Sync pipeline

**What to build:** The Dexie schema (version 1, every table the spec names)
and the Sync pipeline that, given Enabled Publications, fetches Feeds, stores
new Items, Pre-fetches Articles and images within the caps, and records the
last Sync. The pipeline is tested at its seam with a fake fetcher, fixtures and
a fake store. It runs on the page thread, yielding between units of work, and
a minimal "Sync now" control in Settings proves it end to end against a real
Feed. Today (ticket 09) will drive it later.

**Blocked by:** 01 (Shell), 02 (feed parsing), 03 (extraction), 04 (fetcher),
05 (planners). All merged into `main`.

**Status:** ready-for-agent

**Owns:** `src/db.js`, `src/store.js` (the storage interface the pipeline
consumes, implemented over Dexie), `src/sync.js`, `src/sync-client.js`,
`test/sync.test.js`, `test/fixtures/sync/**`. Must add its new files to
`SHELL` in `sw.js` and run `npm run stamp`. May add a "Sync now" button,
progress line and last-Sync line to `src/views/settings.js`, strings under
`sync.*` to `src/i18n.js`, and a `/* Sync */` block to `src/styles.css`. May
add `sync` fields to `state` in `src/state.js`.

**Constraint discovered by ticket 03:** `DOMParser` and DOMPurify do not exist
in Web Workers, and both Feed parsing and Extraction need them. There is no
worker in this design. The pipeline runs on the page and yields to the event
loop between Feeds and between Articles (`await new Promise(r =>
setTimeout(r))` or `scheduler.yield()` where available) so rendering stays
responsive. Fetches are already asynchronous; Readability on one page is tens
of milliseconds.

**Interfaces already on `main` (read them, do not re-implement):**
`parseFeed`/`discoverFeeds` in `src/feed.js` (Items are raw, ids are per-Feed:
key stored Items by `publicationId + ":" + item.id`); `extractArticleInBrowser`,
`sanitizeSummaryInBrowser`, `toPlainText`, `rewriteImageSources` in
`src/extract.js` / `src/extract-core.js`; `createFetcher`, `FetchFailure`,
`DEFAULT_PROXY_TEMPLATE` in `src/fetcher.js`; `planFeedFetches`,
`planArticleFetches` in `src/sync-plan.js`; `planItemTrim`, `planEviction`,
`DEFAULT_RETENTION` and the `ItemRecord`/`PublicationRecord` typedefs in
`src/retention.js`; `state`/`update`/`subscribe`/`showToast` in
`src/state.js`; `t`/`setLang` in `src/i18n.js`. Read each ticket's `## Notes`
in this folder for decisions the authors recorded.

- [ ] `src/db.js` is the Dexie choke point (esm.sh, pinned, `// @ts-expect-error` on the URL import as `src/extract.js` does) and defines version 1: `publications` (id, name, country, language, category, feedUrl, siteUrl, truncated, custom, enabled, lastSyncedAt, lastError), `items` (id = `publicationId:feedItemId`, publicationId, title, link, publishedAt [epoch ms; fetch time when the Feed had none], summaryHtml [sanitized], summaryText, thumbnailUrl, read, saved, readingPosition, summaryOnly, summaryOnlyReason, hasArticle, fetchedAt; indexes on publicationId, publishedAt, saved, [publicationId+publishedAt]), `articles` (itemId, title, byline, html, wordCount, bytes, extractedAt), `images` (key = sha-256 hex of url, url, blob, bytes, itemId; index on itemId), `settings` (key, value), `meta` (key, value) holding `schemaVersion`, `appVersion`, `lastSyncAt`. Comment block: migrations are additive only (ADR-0008).
- [ ] `src/store.js` wraps Dexie in the small interface the pipeline needs (`getEnabledPublications`, `upsertItems`, `itemsNeedingArticles`, `putArticle`, `putImages`, `markSummaryOnly`, `setPublicationSynced(id, { at, error })`, `setLastSyncAt`, `trimItems`, `getMeta/setMeta`) so tests can supply an in-memory implementation. Document the interface with a JSDoc typedef `SyncStore`.
- [ ] `src/sync.js`: `runSync({ store, fetcher, parseFeed, extractArticle, sanitizeSummary, DOMParser, now, limits, onProgress, yieldToUi })`, pure of globals. Steps: plan Feed fetches; fetch and parse each (record `lastError` on failure, continue); sanitize Summaries and derive `summaryText`; upsert Items keyed by Publication; trim per Publication; plan Article fetches; for each, fetch the Original, extract, on `ok` fetch images through `fetchBlob` with the per-Article cap (skip an image that fails or is too large; the Article is still stored), store Article and images, set `hasArticle`; on not-ok mark Summary-only with the reason; one retry per fetch failure then move on; concurrency 4 via a small pool; yield between units; write `lastSyncAt`. Returns `{ feedsOk, feedsFailed, articlesOk, articlesSummaryOnly, imagesStored, bytesStored }`. `onProgress` receives `{ phase: 'feeds'|'articles', done, total, publicationName }`.
- [ ] `src/sync-client.js`: `syncNow({ publicationIds? })` returning the summary and guarding against concurrent runs; `syncIfStale(maxAgeMs = 15 min)`; the `navigator.storage.persist()` request on first Sync (ADR-0003), result stored in `meta`; Periodic Background Sync registration behind a feature check (ADR-0007; it can only post a message to open clients, so it triggers `syncIfStale` in the page when one is open). Publishes `sync: { running, phase, done, total, lastSyncAt, lastSummary }` into `state` via `update`.
- [ ] `test/sync.test.js` drives `runSync` with an in-memory `SyncStore`, a fake fetcher serving fixtures by URL (reuse fixtures from `test/fixtures/feeds` and `test/fixtures/articles` where they fit), the real `parseFeed`/`extractArticle`/`sanitizeSummary` with the Node DOM from `tools/testing/dom.js`, and asserts: Items stored, keyed `publicationId:feedItemId`, Summaries sanitized; the cap of 10 Articles per Publication; round-robin order of Article fetches across two Publications; a thin Original yields Summary-only with `too-short`; a Feed that 500s records `lastError` and does not abort the run; an image over the cap is skipped and the Article still stored; the run yields (count `yieldToUi` calls > 0).
- [ ] Settings shows "Sync now", a progress line while running, and "Last synced: …" wired through `sync-client.js`. To prove it end to end, temporarily seed one Enabled Publication by hand in the browser console (e.g. the BBC or ANSA feed) and take a CDP screenshot with `tools/screenshot.mjs` showing stored Items count in the progress line. Do not ship seed data; ticket 08 owns the Catalog.
- [ ] New Shell files added to `SHELL`, `npm run stamp` run, all five gates green (test, stamp:check, Biome ci, typecheck, check-imports).
