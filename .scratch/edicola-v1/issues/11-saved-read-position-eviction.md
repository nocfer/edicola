# 11 — Saved screen, Reading Position, per-Publication Unread, and Eviction

**What to build:** A Saved tab listing Saved Items with the same cards as
Today, never Evicted. The Reader remembers Reading Position per Article and
restores it on reopen. Unread counts per Publication are live in the
Publications screen and Today chips, with "mark all read". Eviction runs after
every Sync within Retention and never touches Saved Items.

**Blocked by:** 10.

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
