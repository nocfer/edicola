# 11 — Saved screen, Reading Position, per-Publication Unread, and Eviction

**What to build:** A Saved tab listing Saved Items with the same cards as
Today, never Evicted. The Reader remembers Reading Position per Article and
restores it on reopen. Unread counts per Publication are live in the
Publications screen and Today chips, with "mark all read". Eviction runs after
every Sync within Retention and never touches Saved Items.

**Blocked by:** 10 — merged into `main`.

**Status:** done

**Owns:** `src/views/saved.js`, `src/reading-position.js`, `src/evict.js`
(applies `planEviction` and `planItemTrim` against the store, deleting
Articles and images with their Items), `test/evict.test.js`, strings under
`saved.*`, styles under `/* Saved */`. May edit `sync.js` only to call the
Eviction step at the end of a run, `reader.js` only to wire Reading Position,
and `today.js`/`publications.js` only to read Unread counts.

- [x] Saved screen lists Saved Items newest-saved first, with unsave from the card; empty state explains what Saved means.
- [x] Reading Position: debounce-save the scroll ratio while reading; on open, restore after the Article renders and images have laid out; clear when the reader reaches the end.
- [x] Unread counts per Publication computed by an indexed query, updated after Sync and on read; "mark all read" per Publication in both screens.
- [x] `runEviction({ store, limits, now })` uses the planners from ticket 05, deletes Items with their Articles and images in one transaction per batch, and returns `{ deleted, bytesFreed }`. Tested with an in-memory store: Saved survive, age and size caps apply, images are removed with their Item.
- [x] Sync calls Eviction at the end of every run; the Settings storage line (ticket 12) reflects the result.
- [x] Gates green, stamp run.

## Integrator notes (read before starting)

- **Ticket 13 runs in parallel** on documentation only: `README.md`,
  `README.it.md`, `CONTRIBUTING.md`, `docs/self-hosted-proxy.md` and
  `tools/check-catalog.mjs`. You share no files with it.
- **The scroll container, from ticket 10:** the **window** scrolls, not an inner
  element. The Article sits in `<div class="reader__scroll" id="reader-scroll"
  data-item-id="…">` and `src/views/reader.js` exports `READER_SCROLL_ID` so you
  never hard-code the id. Read the scroll offset from the window.
- **Do not break Today's scroll restore.** It is wired on `hashchange` with a
  double `requestAnimationFrame` in `src/views/today.js`, and the Reader
  deliberately never scrolls the window itself. Your Reading Position restore
  must not fight it: restore only on the Reader route, and only after the
  Article has rendered and its images have laid out (they come from blobs, so
  they have real dimensions immediately, but lit renders first).
- **`items.saved` is `0 | 1`, not a boolean** — IndexedDB cannot index a boolean
  and the schema indexes it. Write `1` and `0`. `read` is a plain boolean.
  Ticket 10's Save toggle already writes `1`; match it.
- **Eviction:** `planEviction`, `planItemTrim` and `DEFAULT_RETENTION` are in
  `src/retention.js` and already unit tested — apply them, do not re-derive
  them. Ticket 12 left a named seam that Settings calls when Retention limits
  shrink; find it in `src/views/settings.js` and connect it rather than
  inventing a second entry point. Delete an Item together with its Article and
  its images in one transaction per batch, and never touch a Saved Item.
- **You may edit `src/sync.js` only** to call Eviction at the end of a run.
  Note that `runSync` now stamps `lastSyncAt` only when it actually had
  Publications to fetch; leave that alone.
- **Verify every visual change twice.** The service worker serves the Shell
  stale-while-revalidate, so the first browser run after editing CSS or JS still
  renders the previous file. This bit two earlier agents.
- **`tools/stamp-sw.mjs` parses the `SHELL` array by quote characters**, so a
  comment containing an apostrophe inside that array breaks the stamp. Keep
  comments in `SHELL` apostrophe-free.
- There is now a `test/styles-structure.test.js` guard asserting each screen
  block has top-level rules. Put your styles in one `/* Saved */` block at the
  top level and add an anchor selector to `SCREEN_ANCHORS` if you introduce a
  new block.

## Notes

### Files

- New: `src/evict.js`, `src/reading-position.js`, `src/item-state.js`,
  `test/evict.test.js`, `test/reading-position.test.js`,
  `test/item-state.test.js`.
- Rewritten: `src/views/saved.js` (was the placeholder).
- Extended: `src/views/reader.js` (Reading Position; the Save toggle now goes
  through `item-state.js`), `src/views/publications.js` (Unread counts and
  mark-all-read), `src/views/today.js` (mark-all-read through
  `item-state.js`, plus a read-state refresh on the way back from the Reader),
  `src/sync.js` (Eviction closes a run), `src/sync-client.js` (passes the
  reader's Retention limits into `runSync` — see below), `src/store.js` (the
  Eviction seam), `src/i18n.js` (`saved.*` in both dictionaries),
  `src/styles.css` (one `/* Saved */` and one `/* Unread */` block, both at the
  top level, appended after the `/* Reader */` block),
  `test/styles-structure.test.js` (two new anchors).
- `SHELL` in `sw.js` gained `./src/reading-position.js`,
  `./src/item-state.js` and `./src/evict.js`. **`CACHE` is now
  `edicola-1e4d89b4`.**

### `runEviction` — signature and return shape

`src/evict.js` imports only `retention.js`, so it loads under Node and is unit
tested with an in-memory store.

```js
export const EVICTION_BATCH_SIZE = 50;

export function canEvict(store): boolean
export async function runEviction({
  store,                 // EvictionStore
  limits = {},           // Partial<RetentionLimits>
  now = Date.now(),      // number (epoch ms) or Date
  batchSize = EVICTION_BATCH_SIZE,
}): Promise<EvictionResult>

/**
 * @typedef {object} EvictionStore
 * @property {() => Promise<ItemRow[]>} allItems
 * @property {() => Promise<Map<string, number>>} articleBytesByItem
 * @property {(itemIds: string[]) => Promise<void>} deleteItems
 */
/**
 * @typedef {object} EvictionResult
 * @property {string[]} deleted     Item ids, in the order they were deleted.
 * @property {number} bytesFreed    Article and image bytes those Items held.
 */
```

`deleted` is the **id list**, not a count, because ticket 12's seam already
reads `evicted.deleted.length`; that seam needed no change at all — dropping
`src/evict.js` in made it live, and its toast now reads "Retention saved — 20
Items removed" against real data.

Three passes, in this order: `planItemTrim` (the per-Publication window), then
`planEviction`'s age pass, then its size pass. **The trim runs first and its
Items are withheld from `planEviction`'s input**, so the size pass accounts for
the bytes the trim already frees instead of Evicting an extra Item to reclaim
space that was going anyway (tested). The final id list is filtered against the
Saved set once more before anything is deleted — the planners already exempt
Saved Items, but that promise is the one this app must not break.

### The Eviction seam on `SyncStore` (`src/store.js`)

`SyncStore` gained three methods, additively:

```js
allItems():             Promise<ItemRow[]>            // db.items.toArray()
articleBytesByItem():   Promise<Map<string, number>>  // Article html bytes + image bytes per Item id
deleteItems(itemIds):   Promise<void>                 // one transaction, Items + Articles + images
```

`articleBytesByItem` streams both tables with Dexie's `each`, so measuring the
images table never holds every blob in memory (ticket 12's call). The private
`deleteItems` helper inside `createSyncStore` was renamed
`deleteItemsWithContent`, so the public method can carry the plain name;
`trimItems` still uses it.

`canEvict(store)` exists because **test/sync.test.js's in-memory store
implements the Sync half of `SyncStore` only**, and that file is not this
ticket's. `runEviction` returns an empty result for a store without the seam,
so `runSync` can call it unconditionally without touching that test.

### Where Eviction is called from

1. `runSync`, inside the same `if (queue.length > 0)` guard as the
   `lastSyncAt` stamp — a run with nothing to fetch has nothing to Evict — and
   wrapped in try/catch: a failed Eviction is not a failed Sync.
2. `views/settings.js`'s existing `runEvictionIfAvailable`, unchanged.

**Eviction is deliberately not reported in `SyncSummary`.** One test in
test/sync.test.js asserts the whole summary object with `deepEqual`, and that
file is not this ticket's to edit. The Settings storage line re-measures the
tables after a Sync or a Retention save, which is the honest number anyway
(verified: Items 19 rows / 15 KB, Articles 18, Images 36, measured content
6.4 MB right after an Eviction).

### Reading Position — how it is stored and restored

`items.readingPosition` holds a **fraction of the Article container's own
scroll travel**, 0…1. Not a pixel offset: the same Article is 3000 px tall on a
phone and 1400 px on a tablet, and a stored offset lands in the wrong
paragraph. `src/reading-position.js` is the arithmetic, with no DOM and no
database:

```js
export const SAVE_DEBOUNCE_MS = 400;
export const END_POSITION = 0.98;
export const MIN_POSITION = 0.02;
export const RESTORE_ATTEMPTS_MS = Object.freeze([0, 120, 400]);
export const RESTORE_ABANDON_PX = 24;
export const RESTORE_SETTLE_MS = 150;

/** @typedef {{ scrollY: number, top: number, height: number, viewport: number }} ScrollMetrics */

export function clampPosition(position): number
export function scrollTravel(metrics): number            // max(0, height - viewport)
export function readingPositionOf(metrics): number       // 0…1
export function scrollTargetFor(position, metrics): number
export function isAtEnd(position, threshold = END_POSITION): boolean
export function isWorthRestoring(position): boolean
export function debounce(fn, waitMs, { setTimer?, clearTimer? }): { call, flush, cancel, isPending }
```

`src/views/reader.js` is the only file that knows the window scrolls. It reads
`document.getElementById(READER_SCROLL_ID)` (the exported id, never hard-coded)
and checks its `data-item-id` against the mounted Item, then:

- **Save**: a passive `window` `scroll` listener computes the fraction and
  writes it through `setReadingPosition` (`item-state.js`), debounced 400 ms on
  the trailing edge. Also flushed from `unmount()` and from `pagehide`, so
  leaving the Reader or closing the tab lands the last position.
- **Clear at the end**: at or past `END_POSITION` the listener writes **0**, not
  1. Reopening a finished Article at its last line is worse than opening it at
  the top. Verified: scrolling to the bottom stored 0 and the reopen landed at
  scrollY 0.
- **Restore**: two `requestAnimationFrame`s first, for the reason ticket 09
  gave for Today — `main.js` scrolls to the top on every path change and lit
  fills the Article in the same tick. Then the same offset is re-applied at
  `RESTORE_ATTEMPTS_MS`, because the Article's images are `loading="lazy"` and
  the container grows as they lay out, so the first target can be short. A
  reader who scrolls more than `RESTORE_ABANDON_PX` away from what we applied
  takes over and the sequence stops. The scroll listener is suppressed
  (`screen.restoring`) until `RESTORE_SETTLE_MS` after the last attempt, so the
  restore's own programmatic scrolls are never mistaken for progress — without
  that guard a half-laid-out container measures as position 1 and the position
  would be *cleared* on open.
- The position to restore is read off the row **before** `markRead` and the
  listener touch it.

Ticket 09's Today scroll restore is untouched and still works through this
screen (verified twice: Today at 1400 → Reader → back at 1400).

### The Unread count query

`src/item-state.js`, the reader's own fields on Items in one place, Dexie handle
as a parameter so it loads and tests under Node:

```js
export const SAVED = 1;
export const UNSAVED = 0;
export function isUnread(item): boolean                  // !item.read
export function savedAtOf(item): number
export function compareBySavedNewestFirst(a, b): number
export async function savedItems(db): Promise<ItemRow[]>
export async function setItemSaved(db, itemId, saved, now = Date.now()): Promise<{ saved: 0|1, savedAt: number|null }>
export async function setReadingPosition(db, itemId, position): Promise<number>
export async function countUnreadByPublication(db, publicationIds): Promise<Map<string, number>>
export async function markPublicationRead(db, publicationId): Promise<number>
```

The Unread count is one **indexed** range per Publication, counted while
streaming, so no Item row is materialized and no table is scanned:

```js
db.items.where("publicationId").equals(id).filter(isUnread).count()
```

`markPublicationRead` is the same range with `.modify({ read: true })` and
resolves with how many rows changed. It covers the Publication's whole range,
not only what a screen is showing — ticket 09's decision, now in one place
because both screens call it.

The Saved list is one indexed lookup on `saved`
(`db.items.where("saved").equals(1)`), which is exactly why that column is
`0 | 1` (db.js).

### `saved.*` keys added (both dictionaries, parity test green)

`saved.title` already existed and kept its meaning. **`saved.placeholder` was
removed** (both dictionaries) — it was the placeholder screen's only string and
nothing else referenced it; `saved.empty` + `saved.emptyBody` replace it with
copy that says what Saved means. Added: `saved.loading`, `.loadError`,
`.retry`, `.empty`, `.emptyBody`, `.toToday`, `.count` (`{count}`),
`.savedWhen` (`{when}`), `.unread`, `.summaryOnly`, `.unsave`, `.unsaveAria`
(`{title}`), `.unsavedToast`, `.unsaveFailed`, `.cardAria` (`{title}`,
`{publication}`, `{when}`).

The Publications screen **reuses** `today.unreadCount`, `today.markAllRead` and
`today.markedAllRead` rather than duplicating them under `pubs.*` — the same
call ticket 09 made when it reused `sync.*`. No `pubs.*` key was added, so
ticket 08's prefix is untouched.

### Decisions the ticket left open

- **`items.savedAt` is a new, non-indexed field on the `items` row.** "Newest-
  Saved first" is not answerable from `saved: 0 | 1` alone. Adding a field to
  an existing row needs no schema version (IndexedDB stores arbitrary
  properties; only *indexes* are declared), so ADR-0008's additive-only rule is
  satisfied without a `db.version(2)`. `savedAtOf` falls back to `publishedAt`
  for an Item Saved before the field existed, so a legacy row sorts among the
  Items it was published beside rather than jumping to either end.
  `setItemSaved` is the only writer, and unsaving clears the stamp rather than
  leaving a stale one. **If a later ticket wants the Saved list paged or
  sorted by the database, `savedAt` is the index to add in version 2.**
- **The Reader's Save toggle now writes through `item-state.js`** instead of
  its own `items.update`. That is one line outside "wire Reading Position" in a
  file this ticket may only touch for that, and it is load-bearing: without it
  an Item Saved from the Reader — the main way to save one — would carry no
  `savedAt` and the Saved list would order it by publication date.
- **`syncNow` now passes the reader's Retention limits into `runSync`**
  (`src/sync-client.js`, one new private `pageLimits()` plus one line). Found
  in the browser while proving Eviction: `runSync`'s `limits` defaulted to
  `DEFAULT_RETENTION` on every run, so the Retention card in Settings governed
  *nothing* a Sync did — not the per-Publication trim, not the Pre-fetch count,
  not the new Eviction. With `maxAgeDays: 1` stored, a Sync Evicted nothing;
  with the limits passed, 82 Items became 39 and every Saved Item stayed. This
  is the same two-line call ticket 12 made in this file for the Proxy template,
  for the same reason: a setting the pipeline never reads is decorative. It
  also makes ticket 12's honest fallback copy ("the smaller limits apply at the
  next Sync") true for the first time.
- **A Saved Item's own state is the one thing the Saved screen shows outside
  Retention.** Today bounds itself to the Retention window (ticket 09), so an
  ancient Saved Item is reachable *only* here. The screen reads **every**
  Publication row, not just the Enabled ones: switching a Publication off does
  not unsave what the reader kept from it, and an unlabelled card would be
  worse than a card from a Publication that is currently off.
- **The Saved card is Today's card with the text column as the link and the
  unsave button outside it.** A nested control inside an `<a>` is a mis-tap
  waiting to happen; this way tapping the card opens the Reader and unsaving
  takes a deliberate press. The card is rebuilt rather than imported from
  `views/today.js` (which exports only `todayView`), but it reuses `oneLine`
  from `today-model.js` so the Summary is collapsed by the same rule.
- **Unsaving says what it means.** `saved.unsavedToast` is "Unsaved. This Item
  can be removed again by Retention." — the counterpart to ticket 10's
  `reader.savedToast`, and the only honest thing to say when the reader has
  just given up an exemption.
- **Two style blocks, not one.** `/* Saved */` is the screen; `/* Unread */`
  holds `.unread__count` and `.unread__markread`, two primitives the
  Publications screen uses and any later screen may. Putting a Publications
  badge inside a `/* Saved */` block would be the kind of misfiling the
  structure test exists to prevent. Both anchors (`.saved__card`,
  `.unread__count`) are in `SCREEN_ANCHORS`. `.pub__unread` (ticket 08's dot
  placeholder) is now unused — it is that ticket's line to delete.
- **Today's Unread chips still come from `buildTodayModel`**, over the rows the
  screen already read with one `where('publicationId')` per Publication. They
  were not rewired to `countUnreadByPublication`: the model is ticket 09's and
  unit tested, and a second source for the same number would be worse than one.
  What was added there is `refreshReadState()` — on the way back from the
  Reader the rows already in memory are re-read with `bulkGet` and their `read`
  and `saved` fields refreshed **in place**, so `repeat`'s keys and the list's
  height do not move and ticket 09's scroll restore is not fought. Without it a
  chip stayed stale until the next Sync.
- **`markPublicationRead` writes `read: true`, a plain boolean.** Only `saved`
  is `0 | 1`.
- **The batch size is 50.** Small enough that one interrupted batch loses
  little, large enough that a 500-Item Eviction is ten transactions.
- **An image shared by two Articles is stored once**, under whichever Item
  fetched it first (ticket 10). Evicting that Item takes the blob with it and
  the other Article falls back to the network for that one picture. That is
  `deleteItemsWithContent`'s pre-existing behaviour, now documented where it
  lives; the alternative is reference counting, which ADR-0003's single store
  does not carry.
- **A Sync can still Pre-fetch an Article that Eviction then deletes in the
  same run**, because Eviction is the last step. With a sane `maxAgeDays` that
  is rare; with `maxAgeDays: 1` it is every run. Moving Eviction before the
  Article phase would trade that for Evicting Items the Feed is about to
  refresh, which is worse.

### Verified in the browser (screenshots live outside the repo)

Static server on :8090 from this worktree (killed afterwards), one Chrome
profile per data set, `tools/screenshot.mjs --eval` driving everything. Two
real Catalog Publications enabled over CDP (`bbc-news`, `nature`) and a real
Sync: `{"feedsOk":2,"feedsFailed":0,"itemsStored":109,"articlesOk":16,
"articlesSummaryOnly":4,"imagesStored":45,"bytesStored":7233306}` → 82 Items
(Nature's 52 and BBC's 57 capped to 50 each by the trim). Every check was run
twice.

**The stale Shell bit here in a new way and it is worth writing down**: ticket
12 removed `skipWaiting()` from `sw.js`, so a re-stamped Shell now sits in
`registration.waiting` until the reader confirms the update prompt — a primed
profile keeps serving the *old* CACHE however many times you re-run. The first
Eviction proof silently used the pre-fix `sync-client.js` and showed nothing
Evicted. **Use a throwaway profile after any `npm run stamp`,** or send
`{ type: 'skip-waiting' }`; running twice is no longer enough.

- **Saved with content, dark/en, dark/it, light/en, light/it**: "4 Saved" /
  "4 salvati", cards newest-Saved first with the Unread dot, the Publication
  name, "Saved 3 minutes ago" / "Salvato 3 minuti fa", real thumbnails from the
  Feed, and an "Unsave" / "Rimuovi" button per card.
- **The order is by `savedAt`, not `publishedAt`**: four Items were Saved a
  second apart in a known order and came back in exactly the reverse of it.
- **Unsave from the card**: clicking the first card's button took the row out
  (4 cards → 3), wrote `saved: 0` and `savedAt: null`, and toasted "Unsaved.
  This Item can be removed again by Retention." `aria-label` read "Unsave
  Landmark pancreatic cancer drug shows potential against lung cancer too".
- **The empty state, all four combinations** (a fresh profile with no data):
  "Nothing Saved yet. Save an Item from the Reader and it stays here. A Saved
  Item and its Article are never removed, however old they get or how full
  storage becomes." with a "Go to Today" / "Vai a Oggi" button.
- **Reading Position, twice on the final Shell**: the longest stored Article
  (Nature, 1522 words, an 8137 px container in an 844 px viewport). Scrolled to
  4084 → `readingPosition` 0.5433; left to Today; reopened → `window.scrollY`
  **4084**, pixel-exact, with `data-item-id` matching. Second pass: 4133 →
  0.5500 → 4133.
- **Cleared at the end**: walking to the bottom of the same Article stored
  `readingPosition: 0`, and reopening landed at scrollY 0.
- **Today's scroll restore still works through the Reader**: 1400 → open an
  Item (Reader at scrollY 0) → back → 1400.
- **Unread counts and mark-all-read on Publications**, all four combinations:
  badges "BBC News 32" and "Nature 49" matching
  `countUnreadByPublication` exactly; clicking "Mark all read" / "Segna tutto
  come letto" toasted "BBC News: everything marked read.", removed the badge,
  left the query at 0 for that Publication and 49 for the other, and left the
  Saved Items untouched.
- **Counts update on read**: opening one unread Nature Item and returning to
  Publications took its badge from 49 to 48.
- **Eviction at the end of a Sync**, twice: with `maxAgeDays: 1` stored,
  `syncNow()` left 82 Items → **39**, and **all four Saved Items survived**,
  including ones aged 3 and 6 days that the age pass would otherwise have
  taken. Saved count 4 before and after.
- **Eviction from Settings** (ticket 12's seam, unchanged): shrinking "Items
  per Publication" to 10 in the real input and pressing Save toasted
  **"Retention saved — 20 Items removed"**, took 39 Items → 19, and left all
  four Saved Items.
- **The Settings storage line reflects it**: right after that Eviction the card
  read "Reported by the browser 8.6 MB / Available to this site 10 GB /
  Measured content 6.4 MB / Persistent storage Not granted yet / Saved Items 4"
  with the breakdown "Publications 2 rows 414 B · Items 19 rows 15 KB ·
  Articles 18 rows 183 KB · Images 36 rows 6.2 MB".

### Not verified

- **The size pass (`maxTotalBytes`) against real data.** It is unit tested in
  four ways, but the real corpus never got near 500 MB and the bounds in
  Settings stop at 50 MB minimum, which two Publications do not reach in a few
  Syncs. The age pass and the per-Publication window were both exercised live.
- **A real touch device**, and therefore how a finger's own momentum scrolling
  composes with the restore's re-application. The `RESTORE_ABANDON_PX` guard is
  reasoned and the programmatic case is proven; iOS Safari's rubber-banding is
  not.
- **A very short Article's Reading Position.** An Article that fits the
  viewport has travel 0, so its position is always 0 by construction (unit
  tested); no such Article was opened in the browser.
- **Reduced motion** on the two new blocks. Neither introduces a transition or
  an animation, so there is nothing for the media query to switch off.
- **Offline reload of the Saved screen from the Shell cache.** All three new
  modules are in `SHELL` and stamped, but the run was not repeated with the
  server stopped.
- **`prefetchPerPublication` and `maxImageBytesPerArticle` now reaching the
  pipeline** as a side effect of the `sync-client.js` fix. Eviction and the
  trim were verified against a changed limit; the other two were not, and a
  reader who has saved an unusual Pre-fetch count will now get it. That is the
  intended behaviour, but it is newly live.
