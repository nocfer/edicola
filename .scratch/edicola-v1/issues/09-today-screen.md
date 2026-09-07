# 09 — Today: one timeline across Enabled Publications, grouped by day

**What to build:** The home tab lists Items from all Enabled Publications,
newest first, grouped by day with sticky day headers. Each card shows the
Publication name, title, one-line Summary, relative time and a thumbnail when
present, plus an Unread marker. Filter chips narrow to one Publication. A
"last refreshed" line and pull-to-refresh (plus a refresh button) drive Sync.
Tapping a card navigates to the Reader route (ticket 10 renders it).

**Blocked by:** 07 (db/sync), 08 (Publications to enable). Both merged into `main`.

**Status:** done

**Owns:** `src/views/today.js`, `src/today-model.js` (pure: groups and
filters Items into the day sections), `test/today-model.test.js`, strings
under `today.*`, styles under `/* Today */`. May add files to `SHELL` and
stamp.

- [x] `buildTodayModel(items, publicationsById, { filterPublicationId, now, lang })` returns day sections with localized headers ("Today", "Yesterday", weekday + date) and cards; pure and unit tested including day boundaries around midnight in the local timezone.
- [x] Empty states: no Enabled Publications (link to Publications), Enabled but never Synced (button to Sync), offline with nothing stored.
- [x] Sync on open when the last Sync is older than 15 minutes; a progress indicator while the worker runs; the list updates live as Items arrive.
- [x] Pull-to-refresh on touch and a refresh button for desktop; both call `syncNow()`.
- [x] Filter chips: "All" plus one per Enabled Publication with an Unread count; a per-Publication "mark all read" action in the chip's long-press/context menu or an overflow button.
- [x] Cards are keyed with `repeat`; the thumbnail is the Feed's `thumbnailUrl` loaded from the network with `loading="lazy"` and hidden on error (thumbnails are not stored; Article images are, in ticket 10).
- [x] Bounded list: Items within Retention only, no infinite scroll into the past.
- [x] CDP screenshots in both themes and Languages with real Synced data.
- [x] Gates green, stamp run.

## Integrator notes (read before starting)

- **Ticket 12 is running in parallel** on Settings (`src/views/settings.js`,
  `src/settings.js`, `src/update.js`, `src/storage-usage.js`). Do not touch
  those. Your only shared files are `src/i18n.js` (use a `today.*` prefix) and
  `src/styles.css` (one `/* Today */` block) — keep your additions in their own
  region so the merge stays clean.
- **Sync is already wired at boot.** `src/main.js` calls `initSyncClient()` and
  `syncIfStale()`, so the criterion "Sync on open when the last Sync is older
  than 15 minutes" is done — do not add a second call in the view. Read
  `state.sync` (`{ running, phase, done, total, lastSyncAt, lastSummary }`) for
  the progress indicator and the last-refreshed line; only `sync-client.js`
  writes it.
- **`syncNow({ publicationIds })` now queues distinct scopes** and joins
  identical ones, so a refresh button and a per-Publication Sync no longer
  clobber each other. You do not need ticket 08's promise-queue workaround; if
  you see one in `src/views/publications.js`, leave it alone (not your file).
- **`items.saved` and any indexed flag are stored as `0 | 1`, not booleans**
  (IndexedDB cannot index a boolean). `read` is a plain boolean today — check
  `src/db.js` before assuming either way.
- **Item ids are `publicationId + ":" + feedItemId`** and contain colons and
  URLs, so they must be percent-encoded into the `#/item/:id` route. Verify a
  round trip: build the link, follow it, and confirm `parseRoute` hands back the
  exact id. This is the likeliest place for a subtle bug.
- **A Publication may be gone from the Catalog** but still Enabled (ticket 08
  flags those). Render its Items normally; do not assume a Catalog entry exists
  for every `publicationId`.
- Useful helpers already on `main`: `formatDate` and `formatRelative` in
  `src/i18n.js` (locale-aware, `en-GB` / `it-IT`), `screenHeader` and
  `emptyState` in `src/views/layout.js`, `toPlainText` in
  `src/extract-core.js`, and `repeat` from `src/render.js` for keyed lists.

## Notes

### Files

- New: `src/today-model.js`, `test/today-model.test.js`.
- Rewritten: `src/views/today.js` (was the placeholder).
- Extended: `src/i18n.js` (`today.*` in both dictionaries), `src/styles.css`
  (one `/* Today */` block, placed before the reduced-motion media query and
  after the `/* Publications */` block), `sw.js` (`SHELL` gained
  `./src/today-model.js`; `CACHE` is now `edicola-4436a8d2`).

### `buildTodayModel` — signature and model shape

`src/today-model.js`, named exports only, no DOM and no database. It imports
only `i18n.js` (for the dictionaries and `LOCALES`) and `retention.js` (for
`DEFAULT_RETENTION`, `timeOf`, `compareItemsNewestFirst`), so it imports under
Node and every rule in it is unit tested.

```js
export const SUMMARY_MAX_CHARS = 160;

export function buildTodayModel(items, publicationsById, {
  filterPublicationId = null,   // string|null — show one Publication
  now = Date.now(),             // number|Date — never read from the clock in a test
  lang = "en",                  // 'en'|'it' — day headers and the "All" chip
  limits = {},                  // { maxAgeDays?, keepPerPublication? }
} = {}): TodayModel

export function startOfLocalDay(value): number   // epoch ms of local midnight
export function localDayKey(value): string       // 'YYYY-MM-DD', local components
export function oneLine(text, max = SUMMARY_MAX_CHARS): string
```

`limits` is a fourth option the ticket did not name; it defaults to
`DEFAULT_RETENTION` and exists so the bound is testable without 30 days of
fixtures. `publicationsById` may be a `Map` **or** a plain object; a `Map`
keeps the caller's order, which is the order the chips appear in.

```ts
type TodayModel = {
  sections: DaySection[];            // newest day first; [] when nothing matches
  chips: FilterChip[];               // "All" first, then one per Publication
  filterPublicationId: string | null;
  filterName: string | null;         // the filtered Publication's display name
  cardCount: number;                 // cards in `sections`, after the filter
  itemCount: number;                 // Items inside the window, before the filter
  unreadCount: number;               // Unread inside the window, before the filter
  windowDays: number;                // the age bound, for the footer line
};
type DaySection = {
  key: string;                       // 'YYYY-MM-DD' local — the `repeat` key
  startedAt: number;                 // epoch ms of that day's local midnight
  kind: 'today' | 'yesterday' | 'other';
  label: string;                     // "Today" / "Yesterday" / "Monday 5 January"
  cards: TodayCard[];                // newest first, ties by id
};
type FilterChip = {
  publicationId: string | null;      // null = the "All" chip
  name: string;                      // localized for All, the Publication's own otherwise
  unread: number;
  total: number;
  active: boolean;
};
type TodayCard = {
  id: string; publicationId: string; publicationName: string;
  title: string;                     // collapsed to one line, elided at 200 chars
  summary: string;                   // collapsed to one line, elided at 160 chars
  publishedAt: number;
  thumbnailUrl: string | null;
  read: boolean; saved: boolean; summaryOnly: boolean;   // real booleans, 0|1 coerced
};
```

`src/views/today.js` still exports only `todayView(state)`.

### The day boundary

`startOfLocalDay` is the only place the app decides what a day is, and it means
the **reader's** day: `new Date(y, m, d)` is midnight in the runtime's timezone.
The distance between two days is `Math.round((nowStart - startedAt) / 86400000)`,
so a 23- or 25-hour day across a daylight-saving change cannot shift a label.
`localDayKey` is built from local components, never `toISOString()` (which would
name the UTC day and split a section in two east of Greenwich).

Tested boundaries, all with timestamps built from local date components so they
hold in any timezone: local midnight itself is the new day and one millisecond
earlier is the old one; 23:59:59.999 and 00:00:00.000 are two sections; an Item
at 23:59 reads "Today" at 23:59:30 and "Yesterday" at 00:00:30.

### The item id in the route

`hrefFor('reader', { id })` (ticket 01) already `encodeURIComponent`s the id, and
that is exactly what is needed: the id `publicationId + ":" + feedItemId` carries
`:`, `//`, `?`, `&`, `=` and `#`, and percent-encoding turns all of them into one
path segment with no literal `/`, which is what `parseRoute`'s
`/^\/item\/([^/]+)$/` needs. `parseRoute` then `decodeURIComponent`s it back.
**The view builds no hash by hand** — it calls `hrefFor` — and decoding is left
entirely to `parseRoute`.

Verified in the browser against the worst id the BBC Feed produced (an iPlayer
URL with thirteen query parameters and a `#6` fragment):

```
id    bbc-news:https://www.bbc.co.uk/iplayer/episode/m000crhq?at_mid=…&at_bbc_team=BBC#6
href  #/item/bbc-news%3Ahttps%3A%2F%2Fwww.bbc.co.uk%2Fiplayer%2F…%26at_bbc_team%3DBBC%236
→ location.hash set, state.route.params.id === the stored id, byte for byte
```

All 82 rendered cards were checked: every `href` parses to `reader` with an id
that is a key in the `items` table.

### `today.*` keys added (both dictionaries, parity test green)

`today.title`, `today.placeholder` and `today.choosePublications` already
existed and were kept with the meaning ticket 01 gave them (they are exactly the
"no Enabled Publications" empty state). Added:
`today.loading`, `today.loadError`, `today.retry`, `today.neverSynced`,
`today.offlineEmpty`, `today.empty`, `today.emptyFilter` (`{name}`, `{days}`),
`today.today`, `today.yesterday`, `today.all`, `today.refresh`,
`today.filters`, `today.filterTo` (`{name}`), `today.filterAll`,
`today.unreadCount` (`{count}`), `today.unread`, `today.moreAria` (`{name}`),
`today.markAllRead`, `today.markedAllRead` (`{name}`), `today.summaryOnly`,
`today.pull`, `today.release`, `today.refreshing`, `today.bounded` (`{days}`),
`today.cardAria` (`{title}`, `{publication}`, `{when}`).

The screen also **reuses** `sync.lastSynced`, `sync.never`, `sync.feeds`,
`sync.articles`, `sync.now`, `sync.running` and `sync.error` from ticket 07
rather than duplicating them under `today.*`. Day headers for older days come
from `Intl.DateTimeFormat`, not the dictionaries, so a weekday and month name is
right in any Language the app grows.

### What ticket 10 (Reader) must do about the Today scroll position

**Nothing.** Today restores its own offset. It records `window.scrollY` on a
passive `scroll` listener while the route is `today`, and on `hashchange` back
to `today` — after having left it — it re-applies the offset inside a double
`requestAnimationFrame`, which lands after `main.js`'s `window.scrollTo(0, 0)`
and after lit has filled the list. The Reader only needs to leave through
`goBack()` or a link to `#/`; it must **not** scroll the window itself on the way
out, and it must not reset Today's state.

The listener has to hang off `hashchange` rather than off the render: while the
Reader is open Today is not rendered at all, so a view-side route check never
sees the route leave. The first attempt did exactly that and silently restored
nothing — verified fixed (scrolled to 1400, opened an Item, went back, landed on
1400).

Ticket 11 will want the same trick for Saved.

### Decisions the ticket left open

- **The Retention bound is "the newest `keepPerPublication` Items per
  Publication published within `maxAgeDays`", applied uniformly** — Saved Items
  included. Mirroring `planItemTrim`'s Saved exemption would put a Saved Item
  from months ago in the middle of today's news; Saved Items outside the window
  are reachable on the Saved screen, which is what it is for. This is also
  what makes "no infinite scroll into the past" true by construction: there is
  no page two, and a footer line (`today.bounded`) says so honestly.
- **An Item whose Publication is not Enabled is dropped from the model.** A
  Publication switched off keeps its rows until the next trim, and Today is
  defined as a timeline across *Enabled* Publications. The view passes only the
  Enabled rows, so the model's rule and the query agree.
- **A Publication that has left the Catalog but is still Enabled renders
  normally**, since the view reads the `publications` table (through
  `getSyncStore().getEnabledPublications()`) and never the Catalog.
  `publicationName` falls back to the Publication id if the row's name is empty,
  so a card is never left unlabelled.
- **Chips appear only for Publications with Items inside the window**, plus the
  active filter, which stays visible even when it has nothing behind it (an
  invisible active filter is a trap). Unread counts are always computed over the
  whole window, so filtering to one Publication never changes another's count.
- **The chip's overflow button appears only when that Publication has something
  Unread** — "mark all read" with nothing to mark is noise. A `contextmenu` on
  the chip opens the same menu, which is what a long press sends on the
  platforms that send anything.
- **"Mark all read" writes the Publication's whole `items` range, not just the
  window.** Leaving older Items Unread would be a lie the next Retention pass
  exposes. It writes `read: true` (a plain boolean — only `saved` is `0 | 1`)
  through `db.items.where('publicationId').equals(id).filter(…).modify(…)`, and
  also updates the rows already in memory so the count drops immediately.
- **A refresh while a filter is on Syncs only that Publication**
  (`syncNow({ publicationIds: [id] })`), which is what ticket 07 built the
  scoped queue for. Unfiltered, it Syncs everything.
- **The list reloads on a signature of `state.sync`** (`running|phase|done|
  total|lastSyncAt`), debounced 250 ms. That is how "the list updates live as
  Items arrive" works without a second subscriber to the store, which CLAUDE.md
  forbids. The screen never writes `state.sync`.
- **Sync-on-open was not added.** `main.js` already calls `initSyncClient()` and
  `syncIfStale()` at boot, as the integrator notes said; a second call in the
  view would double every Sync.
- **The view reads Items straight off the Dexie handle**, one
  `where('publicationId')` per Enabled Publication, because `SyncStore` is
  deliberately the Sync pipeline's interface and has no read path for a screen.
  Publications still come from `getSyncStore().getEnabledPublications()` so the
  "Enabled" rule is not written twice. Bounding stays in the pure model rather
  than in the query: at most a few dozen rows per Publication, and one place
  for the rule is worth more than the round trips saved.
- **A broken thumbnail is hidden imperatively** (`img.hidden = true` in
  `@error`) and its URL is remembered in a `Set` so later renders skip it — with
  no `update()`, because the DOM is already right and one redraw per broken
  image would be wasteful. There is deliberately no `?hidden` binding on the
  element, which would undo the imperative hide on the next render.
  `referrerpolicy="no-referrer"` on the thumbnail keeps ADR-0009 honest: the
  publisher learns nothing about which reader loaded it.
- **The screen's transient state is one module-level `screen` object** in the
  view, exactly as ticket 08 settled it for Publications: `state.js` is
  untouched, so there is nothing for the integrator to merge there.
- **Pull-to-refresh** follows half the finger's travel, arms at 72 px, caps the
  indicator at 112 px, and only calls `preventDefault()` once it owns the
  gesture (downward, from `scrollY <= 0`), so a sideways swipe and the browser's
  own overscroll are left alone. The listeners are installed once on `window`
  from the first render, because a view renders a template and cannot own a
  handler across redraws.
- **Two empty states beyond the three the ticket named**: a filter with nothing
  behind it (`today.emptyFilter`), and "your Feeds answered but had nothing"
  (`today.empty`). "Never Synced" is decided by *no Enabled Publication having a
  `lastSyncedAt`* rather than by `state.sync.lastSyncAt`, because ticket 08's
  known wrinkle means a first boot with nothing Enabled already stamps
  `meta.lastSyncAt`.
- One `/** @type {any} */` in `today-model.js`, on the imported
  `compareItemsNewestFirst`: `retention.js` types `ItemRecord.saved` as a
  boolean while the stored `ItemRow` holds `0 | 1`, so the two row types are not
  mutually assignable even though the comparator reads neither field. Widening
  the comparator once is the same call ticket 07 made in `sync.js`.

### Verified in the browser (screenshots live outside the repo)

Static server on :8083 from this worktree, one reused Chrome profile,
`tools/screenshot.mjs` driving everything with `--eval`. Two real Catalog
Publications enabled over CDP (`bbc-news`, `nature`) and a real Sync run:

```
{"feedsOk":2,"feedsFailed":0,"itemsStored":34,"articlesOk":17,
 "articlesSummaryOnly":3,"imagesStored":46,"bytesStored":7412189}
publications 2, items 84 → 82 cards (Nature's 52 capped to 50)
chips: "All 82", "BBC News 32", "Nature 50"
days:  Today, Yesterday, Friday 4 September, Thursday 3 September, Wednesday 2 September
```

- **Today in dark/en, dark/it, light/en, light/it** with that data: sticky day
  headers, real thumbnails, the Unread dot, the "Summary only" flag, relative
  times ("19 minutes ago" / "20 minuti fa"), and "Last synced 1 minute ago" /
  "Ultima sincronizzazione 2 minuti fa".
- **The filter**: clicking "Nature" left 50 cards, all from Nature,
  `aria-pressed="true"`, and the footer line "Today keeps the last 30 days…".
- **Mark all read**: the chip's `⋯` menu opened with "Mark all read"; clicking it
  marked 50 Items, the chips went from `All 82 / Nature 50` to `All 32 / Nature`
  (badge gone), every card rendered muted with no Unread dot, and the toast read
  "Nature: everything marked read."
- **Pull-to-refresh** with synthetic `Touch`/`TouchEvent`s: 40 px showed "Pull
  to refresh", 112 px showed "Release to refresh", and the release started a
  Sync whose progress line read "Feeds 0 of 1" — one Feed, i.e. correctly scoped
  to the filtered Publication.
- **Thumbnail hide-on-error**, deliberately provoked: an Item pointed at
  `/icon.svg` rendered, an Item pointed at `/definitely-not-here.jpg` came back
  `hidden: true`.
- **All three empty states**: publications switched off → "Nothing here yet…"
  with a "Choose Publications" button linking to `#/publications`; Items cleared
  and `lastSyncedAt` nulled → "Your Publications are on. Refresh to fetch the
  first Items." with a "Sync now" button; Items cleared and offline → "Sei
  offline e non è ancora stato scaricato nulla…" with the Offline chip in the
  header.
- **The item-id round trip** and **the scroll restore**, both above.

One real layout bug was found this way and fixed: with the "Summary only" flag
alongside it on a single-line meta row, the Publication name was squeezed to one
clipped glyph. `.today__meta` now wraps.

### Not verified

- **A real touch device.** The pull gesture was exercised with synthetic
  `TouchEvent`s in headless Chrome, which proves the listener logic and the
  indicator but not the feel, and not how iOS Safari's own rubber-banding
  composes with it.
- **A long press opening the chip menu.** The `contextmenu` path is wired and
  the same handler is proven through the `⋯` button, but no platform long press
  was sent.
- **Offline reload of this screen from the Shell cache.** `today-model.js` is in
  `SHELL` and stamped, but the run was not repeated with the server stopped.
- `formatDate` from `i18n.js` ended up unused: `formatRelative` covers the card
  timestamps and `Intl.DateTimeFormat` the day headers.
- Note the service worker's stale-while-revalidate bit twice during
  verification: after editing CSS or JS, the **first** run still renders the
  previous file. Run any check twice, or use a throwaway profile.
