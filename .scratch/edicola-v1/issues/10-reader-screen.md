# 10 — Reader: the full Article, images from storage, honest fallback

**What to build:** Opening an Item shows its Article in a full-screen Reader
with the Publication name, title, byline, date, a link to the Original, a Save
toggle and a Share action. Images render from stored blobs so the Article is
complete offline. A Summary-only Item shows its Summary, the honest fallback
message (ADR-0004), and the Original link; while online it triggers Extraction
immediately with a spinner. Opening marks the Item Read.

**Blocked by:** 09 (Today navigates here), 03 (rewriteImageSources). Both merged into `main`.

**Status:** done

**Owns:** `src/views/reader.js`, `src/article-render.js` (maps stored image
blobs to object URLs and revokes them on leave), `src/fetch-one.js` (on-demand
Extraction of a single Item reusing the pipeline's Article step), strings
under `reader.*`, styles under `/* Reader */`. May add files to `SHELL` and
stamp.

- [x] Route `#/item/:id` hides the tab bar, shows a back control, and restores the Today scroll position on return.
- [x] Article typography: comfortable measure (about 65 characters), readable line height, images constrained to the column with captions, code blocks scroll horizontally, the page never scrolls sideways.
- [x] Images: for each `img` in the Article, look up the stored blob by URL hash, create an object URL, and rewrite via `rewriteImageSources`; revoke all object URLs when the Reader unmounts. Missing blob falls back to the network URL with `loading="lazy"`.
- [x] Summary-only state: Summary, then the message "This publisher does not send the full article to non-subscribers" (localized) with the reason-specific variant for `no-content`, and an "Open original" button. If online, run on-demand Extraction with a spinner; on success swap to the Article in place.
- [x] Opening marks `read = true`. Save toggle flips `saved` and shows a toast. Share uses `navigator.share` with the Original URL and title, falling back to copying the link.
- [x] Always visible: Publication name and the link to the Original (ADR-0004).
- [x] Reading Position is not this ticket (11), but the Reader exposes a scroll container with a stable id for it.
- [x] CDP screenshots: a full Article with images offline (server and network off after Sync), a Summary-only Item, both themes.
- [x] Gates green, stamp run.

## Integrator notes (read before starting)

- **Ticket 14 runs in parallel** and is refactoring `src/catalog.js`,
  `src/settings.js` and `src/views/publications.js`. Do not import
  `src/catalog.js` and do not edit any of those three. You need the Publication
  name and site URL: read the row from the `publications` table (see
  `src/store.js` and `src/db.js`), which is what `src/views/today.js` already
  does.
- **Scroll restore needs nothing from you.** Ticket 09 wired it on
  `hashchange` with a double `requestAnimationFrame`. Just leave via `goBack()`
  from `src/router.js` and never scroll the window yourself. Its first attempt
  hung off the Today render and could never fire, because Today is not rendered
  while you are open — do not reintroduce that.
- **Verify every visual change twice.** The service worker serves the Shell
  stale-while-revalidate, so the first browser run after editing CSS or JS still
  renders the previous file. This bit ticket 09 twice.
- **Images.** `imageKeyFor(url)` in `src/db.js` gives the sha-256 hex key rows
  in `images` are stored under. Map each `img src` through
  `rewriteImageSources(html, mapFn, { windowFor })` from
  `src/extract-core.js`, and revoke every object URL when you unmount — a
  Reader that leaks blob URLs will bloat memory across a session.
- **On-demand Extraction.** Use `extractArticleInBrowser` from
  `src/extract.js`. Build the fetcher with the reader's own Proxy:
  `createFetcher({ fetch, proxyTemplate: effectiveProxyTemplate(stored), onLine })`
  — `src/sync-client.js` shows the pattern, and `effectiveProxyTemplate` plus
  `getSettingsStore` come from `src/settings.js` (import them; do not edit that
  file).
- **Item ids** are `publicationId + ":" + feedItemId` and contain URLs.
  `hrefFor` in `src/router.js` percent-encodes them and ticket 09 proved the
  round trip, so read `state.route.params.id` and use it as-is.
- **`items.saved` is `0 | 1`, not a boolean** (IndexedDB cannot index a
  boolean). `read` is a plain boolean — check `src/db.js` rather than assuming.
- **Reading Position is ticket 11**, not yours. Just give the scroll container a
  stable id and say what it is in your Notes.
- The honest fallback copy is a product commitment, not filler: ADR-0004 says
  Edicola never claims to publish the content and never tries to obtain what a
  publisher withheld. Say plainly that the publisher does not send the full
  Article to non-subscribers, and always show the Publication name and a link
  to the Original.

## Notes

### Files

- New: `src/article-render.js`, `src/fetch-one.js`, `test/article-render.test.js`,
  `test/fetch-one.test.js`.
- Rewritten: `src/views/reader.js` (was the placeholder).
- Extended: `src/i18n.js` (`reader.*` in both dictionaries), `src/styles.css`
  (one `/* Reader */` block, appended at the end of the file — see the CSS
  warning below), `sw.js` (`SHELL` gained `./src/article-render.js` and
  `./src/fetch-one.js`; `CACHE` is now `edicola-091020c7`).

### Exported interfaces

`src/article-render.js` — pure apart from the parameters it is handed, so it
imports only `extract-core.js` and is unit tested under Node:

```js
export async function prepareArticle(html, { db, imageKeyFor, windowFor, createObjectURL })
  // -> Promise<PreparedArticle>
export function revokeObjectUrls(objectUrls, { revokeObjectURL })  // -> number revoked

/**
 * @typedef {object} PreparedArticle
 * @property {string} html         Article markup with stored images on `blob:` URLs
 * @property {string[]} objectUrls Every URL created; revoke these on unmount
 * @property {number} fromStorage  images served from the `images` table
 * @property {number} fromNetwork  images with no stored blob, left on their URL
 */
```

`src/fetch-one.js` — every dependency a parameter, as in `sync.js`:

```js
export async function fetchArticleNow(item, {
  store, fetcher, extractArticle, now = Date.now, limits = {},
}): Promise<FetchOneResult>

/**
 * @typedef {object} FetchOneResult
 * @property {boolean} ok
 * @property {ArticleRow|null} article  the row that was stored, ready to render
 * @property {number} images
 * @property {number} bytes            Article HTML + image bytes written
 * @property {string|null} reason      the `summaryOnlyReason` token, or null
 */
```

`src/views/reader.js`:

```js
export const READER_SCROLL_ID = "reader-scroll";
export function readerView(state)
```

### The scroll container for ticket 11

**The window is the scroll container**, exactly as on Today; the Reader never
calls `scrollTo` itself. The Article lives in

```html
<div class="reader__scroll" id="reader-scroll" data-item-id="<the Item id>">
```

and `READER_SCROLL_ID` is exported so ticket 11 imports the id rather than
hard-coding it. A Reading Position fraction is `window.scrollY` measured
against that element's `offsetTop` and `scrollHeight`; `data-item-id` says
which Item is on screen, which matters because the element survives a move to
another Item within the same route. Restoring a position must wait the same two
frames ticket 09 waits: `main.js` scrolls to the top on every path change and
the images are `loading="lazy"`, so the element's height grows as they arrive.

Verified that ticket 09's Today restore still works through this screen:
scrolled Today to 1400, opened an Item, clicked back, landed on 1400. The
Reader leaves only through `goBack()`.

### Images: how blobs are mapped and where the URLs are revoked

`prepareArticle` makes two DOM passes over the stored, already-sanitized
Article HTML:

1. **Mark and collect.** Every `img` gets `loading="lazy"`,
   `decoding="async"` and `referrerpolicy="no-referrer"` (the last one matters
   for the fallback case: a network image must tell the publisher nothing,
   ADR-0009), and every distinct `http(s)` `src` is collected in document
   order. `data:` images, which Extraction keeps inline when small, are marked
   and collected nowhere.
2. **Swap.** The collected URLs go through `imageKeyFor` into one
   `db.images.bulkGet`, and `rewriteImageSources(html, mapFn, { windowFor })`
   from `extract-core.js` swaps each `src` for a `blob:` URL. A URL with no row
   is left alone (`mapFn` returns `undefined`) and counted in `fromNetwork`.
   The same URL referenced twice yields **one** object URL.

Lookup is by URL hash rather than by `images.itemId` on purpose: an image
shared by two Articles is stored once, under whichever Item fetched it first,
so an `itemId` query would miss it for the other Article.

**Revocation** happens in `src/views/reader.js`, in `releaseObjectUrls()`,
called from four places: `unmount()` (the reader left the route, on
`hashchange`), `ensureMounted()` (the route names a different Item),
`mountArticle()` (a new Article replaces the one on screen, and again for the
prepared URLs of an Article whose reader has already left mid-read), and a
`pagehide` listener. Verified in the browser: the `blob:` URL of a rendered
image fetches fine while the Reader is open and fails with
`ERR_FILE_NOT_FOUND` after clicking back.

### `reader.*` keys added (both dictionaries, parity test green)

`reader.title` and `reader.back` already existed and kept their meaning.
Added: `reader.loading`, `.loadError`, `.retry`, `.missing`, `.toToday`,
`.original`, `.originalAria` (`{publication}`), `.source` (`{publication}`),
`.words` (`{count}`), `.save`, `.saved`, `.saveAria`, `.unsaveAria`,
`.savedToast`, `.unsavedToast`, `.saveFailed`, `.share`, `.shareCopied`,
`.shareFailed`, `.summaryTitle`, `.summaryOnly`, `.summaryOnlyBody`,
`.noSummary`, `.notFetched`, `.fetching`, `.fetchArticle`, `.fetchFailed`,
`.offline`, and one line per reason token:
`reader.reason.no-content`, `.too-short`, `.blocked`, `.not-found`,
`.offline`, `.timeout`, `.too-large`, `.proxy-unconfigured`, `.no-link`.

The reason keys are named after the token `items.summaryOnlyReason` holds
(ticket 07's vocabulary), so a new failure kind means one key pair and nothing
else. An unknown token renders no reason line rather than the raw key.

**`reader.placeholder` is now unused but kept**: `test/i18n.test.js` asserts on
it (`t("reader.placeholder", { id: "42" })`), and that file is not this
ticket's. Whoever owns that test next may delete the key pair and the
assertion together.

### Decisions the ticket left open

- **Which sentence the fallback card shows depends on the reason, and only
  `too-short` and `no-content` get the paywall line.** ADR-0004's copy — "this
  publisher does not send the full article to non-subscribers" — is true when
  Extraction ran on what an anonymous visitor was served and found a teaser or
  no article text. It is *false* when the request never got an answer
  (`offline`, `timeout`, `blocked`, `not-found`, `too-large`,
  `proxy-unconfigured`, `no-link`): those say "the full article could not be
  fetched", with the reason-specific line under it. An Item Extraction has
  simply not reached yet says "not fetched yet". This was found by capturing
  the screen with the network unavailable, where the first version claimed a
  paywall for a DNS failure.
- **The Reader does not use `screenHeader` from `views/layout.js`.** It needs a
  sticky bar carrying the Publication, the Original and the two Item actions,
  and `screenHeader` renders an `<h1>` title. The Reader's `<h1>` is the
  Article's own title, which is the right document outline; the header is
  built locally from the same `.screen__header` class and repeats the Offline
  chip. `emptyState` is still reused for the "Item is gone" and "storage would
  not answer" cards.
- **On-demand Extraction runs for any Item with no Article, not only a
  Summary-only one**, and at most **once per Item per session** (a module-level
  `Set`), plus an explicit "Try again" / "Fetch the full article" button. Any
  more would re-fetch a publisher's page on every open of an Item that is never
  going to extract; any less would leave an Item that a Sync had not reached
  showing a Summary with no way forward. It is skipped entirely while
  `state.online` is false.
- **`fetch-one.js` shares the store, not the code, with `sync.js`.** Both call
  `putArticle`/`putImages`/`markSummaryOnly`, which is where "set
  `hasArticle`, clear the Summary-only mark" lives (ticket 07). It repeats
  `sync.js`'s one-retry rule, the `FINAL_FAILURES` set and the `reasonOf`
  token, because `sync.js` exports none of them and this ticket does not own
  that file. If a fifth caller appears, those three belong in one module.
- **`fetch-one.js` and `article-render.js` take every dependency as a
  parameter** (the store, the fetcher, Extraction, the Dexie handle,
  `imageKeyFor`, `windowFor`, `createObjectURL`), so both import under Node and
  are unit tested; `views/reader.js` is the only file that binds them to the
  browser. That is also why `reader.js` repeats `sync-client.js`'s
  `pageFetcher()`: the Proxy template is read from the `settings` table on
  every attempt through `effectiveProxyTemplate(await (await
  getSettingsStore()).getProxyTemplate())`, so a relay saved in Settings
  applies to the next on-demand Extraction with no reload.
- **The screen's transient state is one module-level `screen` object**, as
  tickets 08 and 09 settled it, so `state.js` is untouched and there is nothing
  to merge there. Unmounting hangs off `hashchange`, not off the render, for the
  reason ticket 09 documented: a view that is no longer rendered cannot notice
  that it was left.
- **The header is sticky.** ADR-0004 asks for the Publication and the Original
  to be visible, and a header that scrolls away is only visible at the top of a
  1000-word Article. The Original also appears as a button in the Article's
  footer.
- **Article typography**: `max-width: 65ch` on the scroll container, the
  display serif at `--fs-lead` with `line-height: 1.65`. Images are
  `max-width: 100%; height: auto`, centred, with `figcaption` in the UI font;
  `pre` and `table` are `display: block; overflow-x: auto` so a wide table or
  code block scrolls inside itself; `overflow-wrap: break-word` handles a long
  unbroken URL, and `overflow-x: clip` on the Article is the safety net.
  Verified `document.documentElement.scrollWidth === clientWidth` (390) on a
  real BBC Article: the page does not scroll sideways.
- **Heading sizes inside the Article are `em` multiples** (1.3em, 1.1em), the
  one place in the file that is not a token: no token expresses "a little
  larger than the surrounding prose", and the four `--fs-*` steps are the app's
  chrome scale, not a prose scale.
- **Reading marks on open, before the Article is prepared**, so a slow image
  read cannot leave an opened Item Unread. `read` is written as a plain
  boolean, `saved` as `0 | 1` (db.js).
- **The Save toggle is a header icon with `aria-pressed`**, not a labelled
  button, and its toast says the Item is never removed — which is what Saved
  means (CONTEXT.md), and worth saying once.
- **Share prefers `navigator.share`, treats `AbortError` as "the reader
  changed their mind" (silence), and otherwise falls through to
  `navigator.clipboard.writeText` with a toast.** A failed clipboard write says
  so honestly rather than pretending.
- **`prepareArticle` swallows a failing `images` read** (warns, returns no
  blobs), so a broken database degrades to network images instead of a blank
  screen. Unit tested.

### Verified in the browser (screenshots live outside the repo)

Static server on :8086 from this worktree, one reused Chrome profile,
`tools/screenshot.mjs --eval` driving everything. Two real Catalog
Publications enabled over CDP (`bbc-news`, `nature`) and a real Sync:
`{"feedsOk":2,"feedsFailed":0,"itemsStored":34,"articlesOk":17,"articlesSummaryOnly":3,"imagesStored":39,"bytesStored":4381164}`.
Every check was run twice because of the Shell's stale-while-revalidate.

- **A full Article, dark/en and light/it** (BBC News, 973 words, 6 images):
  header with the Publication, "Open original", Save and Share; the Article in
  the serif at a 358 px column inside a 390 px viewport; images from storage
  with their captions. `scrollWidth === clientWidth`, so no sideways scroll.
  `read` was `true` in the row afterwards.
- **Offline, and this is the load-bearing one**: the static server killed *and*
  Chrome started with `--host-resolver-rules="MAP * ~NOTFOUND,EXCLUDE
  localhost"`, so every non-localhost host is unresolvable (a probe
  `fetch('https://www.bbc.co.uk/')` inside the page answered "unreachable").
  The same Article rendered complete from the Shell cache with all six `img`
  elements on `blob:` URLs and the visible ones decoded. The only external
  resource entries were the pinned esm.sh modules, served from the Shell cache.
- **A Summary-only Item, dark/en and light/it** (`too-short`): the Summary
  under a "Summary" label, then the card reading "Summary only / This publisher
  does not send the full article to non-subscribers. / The page carried only a
  teaser." with "Open original" and "Try again", and the Original repeated in
  the footer.
- **The Extraction spinner**, light/it: "Recupero dell'articolo completo…" with
  the Summary still visible under it and the fallback card hidden.
- **On-demand Extraction swapping the Article in place**: opening an Item that
  the Sync had not pre-fetched stored a 780-word Article and rendered it, with
  `hasArticle: true` and no fallback card.
- **Save**: clicking the bookmark wrote `saved: 1`, flipped `aria-pressed` and
  toasted "Saved. This Item and its Article are never removed."; the filled
  bookmark was still there on the next load.
- **Back**: the back control leaves through `goBack()`, Today came back at
  scroll 1400, and the Article's `blob:` URL was revoked (`ERR_FILE_NOT_FOUND`)
  once the Reader had gone.

### Not verified

- **A successful `navigator.share`, and a successful clipboard copy.** Headless
  Chrome refuses `share()` without a real user gesture (a CDP-driven `.click()`
  is not one) and refuses `clipboard.writeText` on an unfocused document, so
  what was observed is the *failure* path ending in "The link could not be
  shared." Both branches are wired and the AbortError case is reasoned, not
  observed. This wants one pass on a real phone.
- **An Article whose images had to come from the network** (a blob missing for
  an image that is still referenced). The fallback is unit tested and the
  attributes are asserted there, but every real Article in the sample had all
  its images stored.
- **A reader leaving mid-Extraction.** The guard (`screen.itemId !== id`) is
  there and the late-resolve path revokes what it prepared, but the race was
  not provoked in the browser.
- **Reduced motion.** The spinner has its own
  `@media (prefers-reduced-motion: reduce)` rule inside the `/* Reader */`
  block; it was not screenshotted with the media feature emulated.

### A pre-existing CSS bug the integrator should fix (not mine to touch)

`src/styles.css` on `main` has the whole `/* Settings */` block **inside** the
`@media (prefers-reduced-motion: reduce)` rule: the block was pasted between
`*, *::before, *::after {` and its `transition-duration: 0s !important; }`, so
the file now reads

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
/* Settings: … */
.input[aria-invalid='true'] { … }
…
.update__text { … }
    transition-duration: 0s !important;
  }
}
```

Chrome parses those as *nested* rules, so every Settings rule applies only
under reduced motion and only as a descendant selector. Measured in the
browser: `.input--number` computes `text-align: start` (should be `right`) and
`.settings__subtitle` computes `text-transform: none` (should be
`uppercase`) — the Settings screen is rendering largely unstyled today.

The fix is to move the two stray lines (`transition-duration: 0s !important;`
and the two closing braces) up so the reduced-motion rule closes before the
`/* Settings */` comment. I deliberately did not touch it: it is ticket 12's
block, another branch may be editing that region, and the fix is three lines.
My `/* Reader */` block is appended **after** the end of the file, outside the
media query, which is why it applies (confirmed by the screenshots and by
finding the `.reader__spinner` rule at the top level of the stylesheet).
