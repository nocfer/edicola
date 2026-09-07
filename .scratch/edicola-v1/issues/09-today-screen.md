# 09 — Today: one timeline across Enabled Publications, grouped by day

**What to build:** The home tab lists Items from all Enabled Publications,
newest first, grouped by day with sticky day headers. Each card shows the
Publication name, title, one-line Summary, relative time and a thumbnail when
present, plus an Unread marker. Filter chips narrow to one Publication. A
"last refreshed" line and pull-to-refresh (plus a refresh button) drive Sync.
Tapping a card navigates to the Reader route (ticket 10 renders it).

**Blocked by:** 07 (db/sync), 08 (Publications to enable). Both merged into `main`.

**Status:** ready-for-agent

**Owns:** `src/views/today.js`, `src/today-model.js` (pure: groups and
filters Items into the day sections), `test/today-model.test.js`, strings
under `today.*`, styles under `/* Today */`. May add files to `SHELL` and
stamp.

- [ ] `buildTodayModel(items, publicationsById, { filterPublicationId, now, lang })` returns day sections with localized headers ("Today", "Yesterday", weekday + date) and cards; pure and unit tested including day boundaries around midnight in the local timezone.
- [ ] Empty states: no Enabled Publications (link to Publications), Enabled but never Synced (button to Sync), offline with nothing stored.
- [ ] Sync on open when the last Sync is older than 15 minutes; a progress indicator while the worker runs; the list updates live as Items arrive.
- [ ] Pull-to-refresh on touch and a refresh button for desktop; both call `syncNow()`.
- [ ] Filter chips: "All" plus one per Enabled Publication with an Unread count; a per-Publication "mark all read" action in the chip's long-press/context menu or an overflow button.
- [ ] Cards are keyed with `repeat`; the thumbnail is the Feed's `thumbnailUrl` loaded from the network with `loading="lazy"` and hidden on error (thumbnails are not stored; Article images are, in ticket 10).
- [ ] Bounded list: Items within Retention only, no infinite scroll into the past.
- [ ] CDP screenshots in both themes and Languages with real Synced data.
- [ ] Gates green, stamp run.

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
