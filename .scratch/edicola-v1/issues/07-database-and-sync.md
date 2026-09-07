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

**Status:** done

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

- [x] `src/db.js` is the Dexie choke point (esm.sh, pinned, `// @ts-expect-error` on the URL import as `src/extract.js` does) and defines version 1: `publications` (id, name, country, language, category, feedUrl, siteUrl, truncated, custom, enabled, lastSyncedAt, lastError), `items` (id = `publicationId:feedItemId`, publicationId, title, link, publishedAt [epoch ms; fetch time when the Feed had none], summaryHtml [sanitized], summaryText, thumbnailUrl, read, saved, readingPosition, summaryOnly, summaryOnlyReason, hasArticle, fetchedAt; indexes on publicationId, publishedAt, saved, [publicationId+publishedAt]), `articles` (itemId, title, byline, html, wordCount, bytes, extractedAt), `images` (key = sha-256 hex of url, url, blob, bytes, itemId; index on itemId), `settings` (key, value), `meta` (key, value) holding `schemaVersion`, `appVersion`, `lastSyncAt`. Comment block: migrations are additive only (ADR-0008).
- [x] `src/store.js` wraps Dexie in the small interface the pipeline needs (`getEnabledPublications`, `upsertItems`, `itemsNeedingArticles`, `putArticle`, `putImages`, `markSummaryOnly`, `setPublicationSynced(id, { at, error })`, `setLastSyncAt`, `trimItems`, `getMeta/setMeta`) so tests can supply an in-memory implementation. Document the interface with a JSDoc typedef `SyncStore`.
- [x] `src/sync.js`: `runSync({ store, fetcher, parseFeed, extractArticle, sanitizeSummary, DOMParser, now, limits, onProgress, yieldToUi })`, pure of globals. Steps: plan Feed fetches; fetch and parse each (record `lastError` on failure, continue); sanitize Summaries and derive `summaryText`; upsert Items keyed by Publication; trim per Publication; plan Article fetches; for each, fetch the Original, extract, on `ok` fetch images through `fetchBlob` with the per-Article cap (skip an image that fails or is too large; the Article is still stored), store Article and images, set `hasArticle`; on not-ok mark Summary-only with the reason; one retry per fetch failure then move on; concurrency 4 via a small pool; yield between units; write `lastSyncAt`. Returns `{ feedsOk, feedsFailed, articlesOk, articlesSummaryOnly, imagesStored, bytesStored }`. `onProgress` receives `{ phase: 'feeds'|'articles', done, total, publicationName }`.
- [x] `src/sync-client.js`: `syncNow({ publicationIds? })` returning the summary and guarding against concurrent runs; `syncIfStale(maxAgeMs = 15 min)`; the `navigator.storage.persist()` request on first Sync (ADR-0003), result stored in `meta`; Periodic Background Sync registration behind a feature check (ADR-0007; it can only post a message to open clients, so it triggers `syncIfStale` in the page when one is open). Publishes `sync: { running, phase, done, total, lastSyncAt, lastSummary }` into `state` via `update`.
- [x] `test/sync.test.js` drives `runSync` with an in-memory `SyncStore`, a fake fetcher serving fixtures by URL (reuse fixtures from `test/fixtures/feeds` and `test/fixtures/articles` where they fit), the real `parseFeed`/`extractArticle`/`sanitizeSummary` with the Node DOM from `tools/testing/dom.js`, and asserts: Items stored, keyed `publicationId:feedItemId`, Summaries sanitized; the cap of 10 Articles per Publication; round-robin order of Article fetches across two Publications; a thin Original yields Summary-only with `too-short`; a Feed that 500s records `lastError` and does not abort the run; an image over the cap is skipped and the Article still stored; the run yields (count `yieldToUi` calls > 0).
- [x] Settings shows "Sync now", a progress line while running, and "Last synced: …" wired through `sync-client.js`. To prove it end to end, temporarily seed one Enabled Publication by hand in the browser console (e.g. the BBC or ANSA feed) and take a CDP screenshot with `tools/screenshot.mjs` showing stored Items count in the progress line. Do not ship seed data; ticket 08 owns the Catalog.
- [x] New Shell files added to `SHELL`, `npm run stamp` run, all five gates green (test, stamp:check, Biome ci, typecheck, check-imports).

## Notes

### Files that must be in `SHELL` (all four added, `npm run stamp` run)

`./src/db.js`, `./src/store.js`, `./src/sync.js`, `./src/sync-client.js`.
`CACHE` is now `edicola-998337e4`.

### Exported interfaces

**`src/db.js`** — the Dexie choke point, `dexie@4.4.5` from esm.sh with
`// @ts-expect-error` on the URL import. `index.html`'s `warm-cdn` message
covers it automatically because `main.js` → `views/settings.js` →
`sync-client.js` → `db.js` loads it during page load.

```js
export const DB_NAME = "edicola";
export const SCHEMA_VERSION = 1;
export const APP_VERSION = "0.1.0";     // keep in step with package.json
export const META_KEYS = Object.freeze({
  schemaVersion: "schemaVersion", appVersion: "appVersion",
  lastSyncAt: "lastSyncAt", persistentStorage: "persistentStorage",
});
export function createDatabase(name = DB_NAME): EdicolaDb  // declares version 1
export function getDatabase(): EdicolaDb                   // the app's one handle
export async function imageKeyFor(url: string): Promise<string>  // sha-256 hex
```

Version 1 `stores({...})`, exactly as declared:

```
publications: "id, country, category"
items:        "id, publicationId, publishedAt, saved, [publicationId+publishedAt]"
articles:     "itemId"
images:       "key, itemId"
settings:     "key"
meta:         "key"
```

Row typedefs live in `db.js`: `PublicationRow`, `ItemRow`, `ArticleRow`,
`ImageRow`, `KeyValueRow`, `EdicolaDb`. `getDatabase()` stamps
`schemaVersion` and `appVersion` into `meta` on Dexie's `ready` event, so
ADR-0008's version guard (ticket 12) has something to compare against.

**`src/store.js`**

```js
export function createSyncStore(db = getDatabase()): SyncStore
export function getSyncStore(): SyncStore   // the app's one store
```

```js
/**
 * @typedef {object} SyncStore
 * @property {() => Promise<PublicationRow[]>} getEnabledPublications
 * @property {(items: ItemRow[]) => Promise<number>} upsertItems
 * @property {(publicationIds: string[]) => Promise<Map<string, ItemRow[]>>} itemsNeedingArticles
 * @property {(article: ArticleRow) => Promise<void>} putArticle
 * @property {(itemId: string, images: ImageInput[]) => Promise<number>} putImages
 * @property {(itemId: string, reason: string) => Promise<void>} markSummaryOnly
 * @property {(publicationId: string, status: PublicationSyncStatus) => Promise<void>} setPublicationSynced
 * @property {(at: number) => Promise<void>} setLastSyncAt
 * @property {(publicationId: string, limits?: { keepPerPublication?: number }) => Promise<string[]>} trimItems
 * @property {(key: string) => Promise<unknown>} getMeta
 * @property {(key: string, value: unknown) => Promise<void>} setMeta
 */
/** @typedef {{ url: string, blob: Blob, bytes?: number }} ImageInput */
/** @typedef {{ at: number, error?: string|null }} PublicationSyncStatus */
```

- `upsertItems` resolves with the number of rows written and **merges**: for an
  Item already stored it refreshes only `feedItemId`, `title`, `link`,
  `publishedAt`, `summaryHtml`, `summaryText`, `thumbnailUrl` and leaves
  `read`, `saved`, `readingPosition`, `summaryOnly`, `hasArticle`, `fetchedAt`
  alone. A Sync can never undo the reader's state.
- `putArticle` also flags its Item `hasArticle: true` and clears
  `summaryOnly`/`summaryOnlyReason` — that is where "set `hasArticle`" happens,
  since the ticket's interface list has no separate call for it.
- `putImages(itemId, images)` derives each primary key with `imageKeyFor(url)`,
  so the pipeline never computes a hash, and resolves with the bytes written.
- `itemsNeedingArticles` returns the Map **in the order the ids were given**;
  `planArticleFetches` round-robins that order, so the caller controls it.
- `trimItems` runs `planItemTrim` for one Publication and deletes what falls
  out with its Article and images, in one transaction.

**`src/sync.js`**

```js
export const DEFAULT_CONCURRENCY = 4;
export async function runSync({
  store, fetcher, parseFeed, extractArticle, sanitizeSummary, DOMParser,
  now = Date.now, limits = {}, onProgress = () => {}, yieldToUi = defaultYield,
  publicationIds = null, concurrency = DEFAULT_CONCURRENCY,
}): Promise<SyncSummary>
```

```js
/**
 * @typedef {object} SyncSummary
 * @property {number} feedsOk
 * @property {number} feedsFailed
 * @property {number} itemsStored          Item rows written (new and refreshed)
 * @property {number} articlesOk
 * @property {number} articlesSummaryOnly
 * @property {number} imagesStored
 * @property {number} bytesStored          Article HTML + image bytes this run
 */
/**
 * @typedef {object} SyncProgress
 * @property {'feeds'|'articles'} phase
 * @property {number} done
 * @property {number} total
 * @property {string|null} publicationName  null on a phase's opening event
 */
```

`extractArticle` is `(html, url) => Article` and `sanitizeSummary` is
`(html) => string`, so the page passes `extractArticleInBrowser` /
`sanitizeSummaryInBrowser` unchanged and tests pass the `extract-core`
functions bound to jsdom.

**`src/sync-client.js`**

```js
export const DEFAULT_STALE_MS = 15 * 60 * 1000;
export const PERIODIC_SYNC_TAG = "edicola-sync";
export const PERIODIC_SYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const PERIODIC_SYNC_MESSAGE = "periodic-sync";
export function syncNow({ publicationIds } = {}): Promise<SyncSummary>
export async function syncIfStale(maxAgeMs = DEFAULT_STALE_MS): Promise<SyncSummary | null>
export async function requestPersistentStorage(store = getSyncStore()): Promise<boolean | 'unsupported'>
export async function registerPeriodicSync(minInterval = PERIODIC_SYNC_MIN_INTERVAL_MS): Promise<boolean>
export function startSyncMessageListener(): () => void
export function initSyncClient(): void
```

### `state.sync` (added to `state` and to the `State` typedef in `src/state.js`)

```js
sync: {
  running: false,
  phase: null,      // 'feeds' | 'articles' | null
  done: 0,
  total: 0,
  lastSyncAt: null, // epoch ms
  lastSummary: null // SyncSummary
}
```

Only `sync-client.js` writes it, always through `update({ sync: {...} })`.
`lastSummary` is in memory only: after a reload `initSyncClient()` restores
`lastSyncAt` from `meta` and the progress line is empty until the next Sync.

### i18n keys added (`sync.*`, both dictionaries, parity test green)

`sync.title`, `sync.now`, `sync.running`, `sync.lastSynced`, `sync.never`,
`sync.feeds` (`{done}`, `{total}`), `sync.articles` (`{done}`, `{total}`),
`sync.summary` (`{items}`, `{articles}`, `{images}`), `sync.failed`
(`{count}`), `sync.error`.

### Decisions the ticket left open

- **`items.saved` is stored as `0 | 1`, not a boolean.** IndexedDB cannot index
  a boolean (valid keys are number, string, Date, ArrayBuffer, Array), and the
  ticket asks for an index on `saved`. Rows with a boolean would be invisible to
  that index. `0` and `false` are both falsy, so the pure planners read either.
  **Ticket 11 must write `1`/`0` and query `.where('saved').equals(1)`.** Every
  non-indexed flag (`read`, `hasArticle`, `summaryOnly`, `truncated`, `custom`,
  `enabled`) stays a real boolean.
- `publications` is indexed on `country` and `category` as well as `id`, so
  ticket 08 can list the Catalog by Nation and Category without a full scan.
  `enabled` is deliberately *not* indexed (boolean, and the table is at most a
  few dozen rows); `getEnabledPublications` filters in JS.
- **`SyncSummary` carries one field beyond the six the ticket named**:
  `itemsStored`. Settings needs a stored-Items count for its line, and the six
  named fields do not have one. Everything else matches.
- `summaryHtml` is `sanitizeSummary(item.summaryHtml || item.contentHtml || "")`
  — the Summary first, the Feed's full `content` only as a fallback — and
  `summaryText` is derived from the **sanitized** markup, so the two can never
  disagree. A Feed that carries the whole Article in `content:encoded` is still
  Pre-fetched from the Original; using the Feed's own content as the Article is
  an optimisation ticket 09/10 can take.
- An undated Item is stamped with the fetch time (`publishedAt === fetchedAt`),
  as ticket 05's notes asked, so it is not Evicted by age on the first pass.
- `summaryOnlyReason` is one short token, never a sentence: the fetcher's
  `kind` (`blocked`, `not-found`, `offline`, `timeout`, `too-large`,
  `proxy-unconfigured`), Extraction's `reason` (`too-short`, `no-content`), or
  `no-link` when the Feed gave no link. `publications.lastError` uses the same
  vocabulary plus the Feed parser's `reason` (`unknown-root`, `malformed-xml`,
  …). Ticket 09/10 can map these to copy.
- **One retry, except when a retry cannot help**: `not-found` (404/410),
  `too-large` and `proxy-unconfigured` are final and fetched once. Everything
  else is attempted twice, then recorded and skipped.
- Images are fetched in document order against a running per-Article budget
  (`maxImageBytesPerArticle`, default 5 MiB) passed to `fetchBlob` as
  `maxBytes`, so an oversized image is aborted mid-body by the fetcher rather
  than downloaded and discarded. A failed or oversized image is skipped and the
  Article is stored regardless.
- `concurrency` is a `runSync` option (default 4) rather than part of `limits`,
  because `DEFAULT_RETENTION` is frozen and has no such field. The pipeline test
  passes `concurrency: 1` where it asserts an exact fetch order.
- `publicationIds` is a `runSync` option as well as a `syncNow` one, so a
  pull-to-refresh on a single-Publication view (ticket 09) can scope a run.
- `now` defaults to `Date.now` and `yieldToUi` to `scheduler.yield()` /
  `setTimeout` — the only two globals `sync.js` touches, both replaceable by a
  parameter, which is how the tests keep it deterministic.
- `requestPersistentStorage` records the answer in `meta.persistentStorage` and
  stops asking once it is `true`, but **does ask again after a refusal**:
  browsers grant persistence as a site earns engagement, so one "no" on first
  run must not be permanent. `'unsupported'` is stored where the API is absent.
- Three `/** @type {any} */` annotations in `sync.js` mark the two queues and the
  grouped-Items Map. `ItemRecord.saved` is a boolean in `retention.js` while the
  stored row holds `0 | 1`, so the row types and the planner types are not
  mutually assignable; the planners carry every other field through untouched,
  which is why typing the queues loosely is safe and field-by-field casts were
  not worth it.

### Verified end to end (not committed: screenshots live outside the repo)

Static server on :8071 from this worktree, throwaway then reused Chrome
profile, one Enabled Publication (`bbc-news`, the Catalog's real
`https://feeds.bbci.co.uk/news/rss.xml`) inserted over CDP, then the **"Sync
now" button clicked**:

```
{"buttonLabel":"Sync now",
 "sync":{"running":false,"phase":null,"done":0,"total":0,
         "lastSyncAt":1788786015628,
         "lastSummary":{"feedsOk":1,"feedsFailed":0,"itemsStored":32,
                        "articlesOk":8,"articlesSummaryOnly":2,
                        "imagesStored":3,"bytesStored":388636}},
 "lastError":null,
 "counts":{"publications":1,"items":32,"articles":8,"images":3},
 "persistentStorage":false,"schemaVersion":1,
 "sampleItemIds":["bbc-news:https://www.bbc.co.uk/iplayer/episode/m000crhq?…#6", …],
 "tables":["publications","items","articles","images","settings","meta"]}
```

Settings then read `Last synced  now` with `32 Items, 8 Articles, 3 images`;
mid-run the same line read `Articles 3 of 10` with the button showing
`Syncing…`; a reload of the same profile restored `Last synced  ora` in
Italian from `meta`, with no Sync. Every Feed and Original went through the
default Proxy (BBC answers no CORS header to a direct fetch), which is the
expected console noise.

### Not verified

- **Periodic Background Sync end to end.** The page side is done — the tag is
  registered behind a feature *and* permission check, and
  `startSyncMessageListener()` runs `syncIfStale` on a `{ type:
  'periodic-sync' }` message — but the worker half is missing, because this
  ticket may only touch the `SHELL` array in `sw.js`. Whoever owns the next
  `sw.js` change (ticket 12) should add:

  ```js
  self.addEventListener("periodicsync", (event) => {
    if (event.tag !== "edicola-sync") return;
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage({ type: "periodic-sync" });
      }),
    );
  });
  ```

  Nothing in `sync-client.js` needs to change when it lands.
- `navigator.storage.persist()` returning `true`: headless Chrome refused
  (`false`), which is the documented behaviour without site engagement.
- `main.js` does not call `initSyncClient()` or `syncIfStale()` at boot — this
  ticket does not own `main.js`. `settingsView` calls `initSyncClient()` on
  render (idempotent) so the screen works today. **Ticket 09 should move that
  call to `main.js`'s boot and add `syncIfStale()` there** (spec story 29).
- Eviction (`planEviction`) is not wired: `runSync` trims per Publication but
  does not run the age/size pass. Ticket 11 owns Eviction.
- Dexie itself is untested in Node (the spec says so: no IndexedDB there); it is
  covered only by the browser run above. `dexie@4.4.5` is pinned in `db.js`
  alone and is deliberately **not** in `tools/ensure-test-deps.mjs`, which this
  ticket does not own and which only needs the packages the tests import.
