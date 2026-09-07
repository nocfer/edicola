# 10 — Reader: the full Article, images from storage, honest fallback

**What to build:** Opening an Item shows its Article in a full-screen Reader
with the Publication name, title, byline, date, a link to the Original, a Save
toggle and a Share action. Images render from stored blobs so the Article is
complete offline. A Summary-only Item shows its Summary, the honest fallback
message (ADR-0004), and the Original link; while online it triggers Extraction
immediately with a spinner. Opening marks the Item Read.

**Blocked by:** 09 (Today navigates here), 03 (rewriteImageSources). Both merged into `main`.

**Status:** ready-for-agent

**Owns:** `src/views/reader.js`, `src/article-render.js` (maps stored image
blobs to object URLs and revokes them on leave), `src/fetch-one.js` (on-demand
Extraction of a single Item reusing the pipeline's Article step), strings
under `reader.*`, styles under `/* Reader */`. May add files to `SHELL` and
stamp.

- [ ] Route `#/item/:id` hides the tab bar, shows a back control, and restores the Today scroll position on return.
- [ ] Article typography: comfortable measure (about 65 characters), readable line height, images constrained to the column with captions, code blocks scroll horizontally, the page never scrolls sideways.
- [ ] Images: for each `img` in the Article, look up the stored blob by URL hash, create an object URL, and rewrite via `rewriteImageSources`; revoke all object URLs when the Reader unmounts. Missing blob falls back to the network URL with `loading="lazy"`.
- [ ] Summary-only state: Summary, then the message "This publisher does not send the full article to non-subscribers" (localized) with the reason-specific variant for `no-content`, and an "Open original" button. If online, run on-demand Extraction with a spinner; on success swap to the Article in place.
- [ ] Opening marks `read = true`. Save toggle flips `saved` and shows a toast. Share uses `navigator.share` with the Original URL and title, falling back to copying the link.
- [ ] Always visible: Publication name and the link to the Original (ADR-0004).
- [ ] Reading Position is not this ticket (11), but the Reader exposes a scroll container with a stable id for it.
- [ ] CDP screenshots: a full Article with images offline (server and network off after Sync), a Summary-only Item, both themes.
- [ ] Gates green, stamp run.

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
