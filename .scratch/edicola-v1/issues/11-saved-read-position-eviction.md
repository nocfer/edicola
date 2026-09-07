# 11 — Saved screen, Reading Position, per-Publication Unread, and Eviction

**What to build:** A Saved tab listing Saved Items with the same cards as
Today, never Evicted. The Reader remembers Reading Position per Article and
restores it on reopen. Unread counts per Publication are live in the
Publications screen and Today chips, with "mark all read". Eviction runs after
every Sync within Retention and never touches Saved Items.

**Blocked by:** 10 — merged into `main`.

**Status:** ready-for-agent

**Owns:** `src/views/saved.js`, `src/reading-position.js`, `src/evict.js`
(applies `planEviction` and `planItemTrim` against the store, deleting
Articles and images with their Items), `test/evict.test.js`, strings under
`saved.*`, styles under `/* Saved */`. May edit `sync.js` only to call the
Eviction step at the end of a run, `reader.js` only to wire Reading Position,
and `today.js`/`publications.js` only to read Unread counts.

- [ ] Saved screen lists Saved Items newest-saved first, with unsave from the card; empty state explains what Saved means.
- [ ] Reading Position: debounce-save the scroll ratio while reading; on open, restore after the Article renders and images have laid out; clear when the reader reaches the end.
- [ ] Unread counts per Publication computed by an indexed query, updated after Sync and on read; "mark all read" per Publication in both screens.
- [ ] `runEviction({ store, limits, now })` uses the planners from ticket 05, deletes Items with their Articles and images in one transaction per batch, and returns `{ deleted, bytesFreed }`. Tested with an in-memory store: Saved survive, age and size caps apply, images are removed with their Item.
- [ ] Sync calls Eviction at the end of every run; the Settings storage line (ticket 12) reflects the result.
- [ ] Gates green, stamp run.

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
