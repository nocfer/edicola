# 05 — Planners: what a Sync fetches, in what order, and what Eviction removes

**What to build:** Two pure modules with no I/O. One turns Enabled
Publications and their current Items into an ordered fetch plan for a Sync;
the other turns stored Item records and Retention limits into the list of
Items to Evict. Both fully unit tested. No UI.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Owns:** `src/sync-plan.js`, `src/retention.js`, `test/sync-plan.test.js`,
`test/retention.test.js`.

- [ ] `planFeedFetches(enabledPublications)` returns the Publications to fetch, stable order by last-synced ascending then name, so a stalled Publication is not starved.
- [ ] `planArticleFetches(itemsByPublication, { prefetchPerPublication = 10 })` takes, per Publication, the Items that have no Article and are not marked Summary-only, and returns one interleaved round-robin queue, newest first within each Publication, capped per Publication. Ties broken by Publication order. Test that with three Publications of sizes 1, 5 and 20 the queue alternates and respects the cap.
- [ ] `planItemTrim(items, { keepPerPublication = 50 })` returns ids of Items beyond the per-Publication count, oldest first, never Saved.
- [ ] `planEviction(items, articlesSizeById, { maxAgeDays = 30, maxTotalBytes = 500 * 2 ** 20 }, now)` returns `{ deleteItemIds, bytesFreed }`: first every unsaved Item older than `maxAgeDays`; then, if the remaining total still exceeds `maxTotalBytes`, more unsaved Items oldest first until under the cap. Saved Items are never returned. Deterministic for equal dates (tie by id).
- [ ] `describeRetention(limits, lang)` is NOT here; formatting belongs to the UI. Keep these modules free of i18n and DOM.
- [ ] Export the default limits as a single `DEFAULT_RETENTION` object so Settings (ticket 12) reads them from one place.
- [ ] JSDoc typedefs for the record shapes you consume (`ItemRecord`, `PublicationRecord`) so ticket 07 can align its schema to them. Keep fields minimal: `id`, `publicationId`, `publishedAt`, `saved`, `hasArticle`, `summaryOnly`, `lastSyncedAt`, `name`.
- [ ] Gates green.
