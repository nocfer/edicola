# 10 — Reader: the full Article, images from storage, honest fallback

**What to build:** Opening an Item shows its Article in a full-screen Reader
with the Publication name, title, byline, date, a link to the Original, a Save
toggle and a Share action. Images render from stored blobs so the Article is
complete offline. A Summary-only Item shows its Summary, the honest fallback
message (ADR-0004), and the Original link; while online it triggers Extraction
immediately with a spinner. Opening marks the Item Read.

**Blocked by:** 09 (Today navigates here), 03 (rewriteImageSources).

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
