# 09 — Today: one timeline across Enabled Publications, grouped by day

**What to build:** The home tab lists Items from all Enabled Publications,
newest first, grouped by day with sticky day headers. Each card shows the
Publication name, title, one-line Summary, relative time and a thumbnail when
present, plus an Unread marker. Filter chips narrow to one Publication. A
"last refreshed" line and pull-to-refresh (plus a refresh button) drive Sync.
Tapping a card navigates to the Reader route (ticket 10 renders it).

**Blocked by:** 07 (db/sync), 08 (Publications to enable).

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
