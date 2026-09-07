# 05 — Planners: what a Sync fetches, in what order, and what Eviction removes

**What to build:** Two pure modules with no I/O. One turns Enabled
Publications and their current Items into an ordered fetch plan for a Sync;
the other turns stored Item records and Retention limits into the list of
Items to Evict. Both fully unit tested. No UI.

**Blocked by:** None — can start immediately.

**Status:** done

**Owns:** `src/sync-plan.js`, `src/retention.js`, `test/sync-plan.test.js`,
`test/retention.test.js`.

- [x] `planFeedFetches(enabledPublications)` returns the Publications to fetch, stable order by last-synced ascending then name, so a stalled Publication is not starved.
- [x] `planArticleFetches(itemsByPublication, { prefetchPerPublication = 10 })` takes, per Publication, the Items that have no Article and are not marked Summary-only, and returns one interleaved round-robin queue, newest first within each Publication, capped per Publication. Ties broken by Publication order. Test that with three Publications of sizes 1, 5 and 20 the queue alternates and respects the cap.
- [x] `planItemTrim(items, { keepPerPublication = 50 })` returns ids of Items beyond the per-Publication count, oldest first, never Saved.
- [x] `planEviction(items, articlesSizeById, { maxAgeDays = 30, maxTotalBytes = 500 * 2 ** 20 }, now)` returns `{ deleteItemIds, bytesFreed }`: first every unsaved Item older than `maxAgeDays`; then, if the remaining total still exceeds `maxTotalBytes`, more unsaved Items oldest first until under the cap. Saved Items are never returned. Deterministic for equal dates (tie by id).
- [x] `describeRetention(limits, lang)` is NOT here; formatting belongs to the UI. Keep these modules free of i18n and DOM.
- [x] Export the default limits as a single `DEFAULT_RETENTION` object so Settings (ticket 12) reads them from one place.
- [x] JSDoc typedefs for the record shapes you consume (`ItemRecord`, `PublicationRecord`) so ticket 07 can align its schema to them. Keep fields minimal: `id`, `publicationId`, `publishedAt`, `saved`, `hasArticle`, `summaryOnly`, `lastSyncedAt`, `name`.
- [x] Gates green.

## Notes

Both modules are pure: no I/O, no DOM, no i18n, no imports outside
`src/retention.js` <- `src/sync-plan.js`. Named exports only. Every planner is
deterministic; equal dates tie by id (string `<` comparison, ascending). Inputs
are never mutated. Records are returned by reference, so extra fields survive.

### Exported signatures

`src/retention.js`

```js
export const DEFAULT_RETENTION = Object.freeze({
  maxAgeDays: 30,
  maxTotalBytes: 500 * 2 ** 20,
  maxImageBytesPerArticle: 5 * 2 ** 20,
  keepPerPublication: 50,
  prefetchPerPublication: 10,
});

export function planItemTrim(items, { keepPerPublication = 50 } = {}): string[]
export function planEviction(
  items,
  articlesSizeById,                 // Map<string, number> | Record<string, number>, bytes per Item id
  { maxAgeDays = 30, maxTotalBytes = 500 * 2 ** 20 } = {},
  now = Date.now(),                 // number (epoch ms) or Date
): { deleteItemIds: string[], bytesFreed: number }

// Shared helpers (also used by sync-plan.js; ticket 08 may reuse them):
export function timeOf(value): number          // epoch ms; -Infinity when missing/invalid
export function compareItemsOldestFirst(a, b): number
export function compareItemsNewestFirst(a, b): number
export function groupByPublication(items): Map<string, ItemRecord[]>  // first-seen order
```

`src/sync-plan.js`

```js
export function planFeedFetches(enabledPublications): PublicationRecord[]
export function planArticleFetches(
  itemsByPublication,               // Map<string, ItemRecord[]> | ItemRecord[][] | ItemRecord[] (flat, grouped by publicationId in first-seen order)
  { prefetchPerPublication = 10 } = {},
): ItemRecord[]
```

### Typedefs (ticket 07 aligns the Dexie schema to these)

```js
/**
 * @typedef {object} ItemRecord
 * @property {string} id                 Stable id, unique across Publications.
 * @property {string} publicationId      Id of the Publication whose Feed listed it.
 * @property {number} publishedAt        Epoch milliseconds. ISO strings and Dates are
 *                                       tolerated; missing or invalid sorts oldest.
 * @property {boolean} [saved]           Never trimmed or Evicted.
 * @property {boolean} [hasArticle]      An Article is stored for this Item.
 * @property {boolean} [summaryOnly]     Extraction failed or yielded too little.
 */

/**
 * @typedef {object} PublicationRecord
 * @property {string} id                 Catalog slug or generated id for a Custom Publication.
 * @property {string} name               Display name; tie-breaker only.
 * @property {number | null} [lastSyncedAt]  Epoch ms of the last Sync of this Feed; null/missing = never.
 */

/**
 * @typedef {object} RetentionLimits
 * @property {number} maxAgeDays
 * @property {number} maxTotalBytes
 * @property {number} maxImageBytesPerArticle
 * @property {number} keepPerPublication
 * @property {number} prefetchPerPublication
 */
```

### Decisions the spec left open

- `planFeedFetches` sorts only; it does not filter on an `enabled` flag (the
  field is not in the minimal typedef). The caller passes Enabled Publications.
  Never-synced Publications sort first (`lastSyncedAt` null = -Infinity).
- `planItemTrim`: Saved Items do not take up a slot in the per-Publication
  window, so saving never pushes an unsaved Item out. Result is merged across
  Publications, oldest first.
- `planEviction` size pass: the stored total includes Saved Items' bytes (they
  occupy space) but only unsaved Items are deleted. Items whose Article takes
  no bytes (no entry, or 0) are skipped in the size pass since deleting them
  frees nothing; they are still subject to the age pass. If Saved Items alone
  exceed the cap, every unsaved Item with bytes is removed and the planner
  stops.
- `articlesSizeById` is keyed by **Item id** (not Article id); the Dexie layer
  should sum Article HTML plus its images per Item before calling.
- An Item with no `publishedAt` is treated as the oldest, so it is Evicted by
  age; the Sync pipeline should stamp undated Items with the fetch time.
- `maxImageBytesPerArticle` lives in `DEFAULT_RETENTION` for Settings but is
  enforced by Extraction (ticket 04/08), not by these planners.

### Not verified

- Nothing outside unit tests; there is no UI or Dexie integration in this
  ticket. No Shell files were touched, so `SHELL` in `sw.js` needs no change
  until the Sync worker (ticket 08) imports these modules.
