# 08 — Publications screen: pick Nations, toggle Publications, add a Custom one

**What to build:** The Publications tab shows the Catalog grouped by Nation
then Category with a toggle per Publication and a per-Publication Unread dot
placeholder. A Nation selector at the top controls which Nations are shown,
inferred from browser locale on first run. A "Add by URL" form at the bottom
runs feed autodiscovery and creates a Custom Publication. Toggles persist and
drive which Publications Sync.

**Blocked by:** 01, 02 (discoverFeeds), 06 (catalog), 07 (db/store). All merged into `main`.

**Status:** ready-for-agent

**Owns:** `src/views/publications.js`, `src/catalog.js` (loads
`data/catalog.json`, merges with `publications` table, first-run seeding),
`test/catalog-merge.test.js`, strings in `i18n.js` under the `pubs.*` prefix,
styles under a `/* Publications */` block in `styles.css`. May add
`data/catalog.json` and new files to `SHELL` and stamp.

- [ ] First run: infer Nations from `navigator.languages` (it → IT, en-GB → GB, other en → GB for now); infer Language similarly (ADR-0006). Persist in `settings`. Nothing is Enabled by default; the screen invites the reader to switch Publications on.
- [ ] Catalog load merges the shipped JSON with the `publications` table: new Catalog entries appear, removed ones stay if Enabled (flagged "no longer in Catalog"), Custom ones untouched. Pure merge function, unit tested.
- [ ] Nation selector: chips for every Nation present in the Catalog, multi-select, at least one required. Category groups collapse/expand; Publication rows show name, site domain, a `truncated` hint ("full text fetched from the site"), and a switch.
- [ ] Toggling writes `enabled` immediately and, when turning on while online, triggers a Sync for that Publication only (use `sync-client.js`).
- [ ] "Add by URL": paste a site or feed URL; the app fetches it through the fetcher, tries `parseFeed` first, else `discoverFeeds` and probes candidates; shows the found Feeds to pick from; creates a Custom Publication with `country`/`language` guessed from the Feed language and editable. Errors use the fetcher's `kind` for honest copy (offline vs blocked vs not found).
- [ ] Strings in `en` and `it`; the i18n parity test still passes.
- [ ] CDP screenshots of the screen in both themes and both Languages, including the add-by-URL result state.
- [ ] Gates green, stamp run.

## Integrator notes (read before starting)

- **`src/settings.js` does not exist and ticket 12 owns it.** Persist your
  Nation selection and Language choice through the `settings` table using the
  store, and keep the read/write in **one small pair of helpers at the top of
  `src/catalog.js`** (for example `readSelectedNations` / `writeSelectedNations`).
  Ticket 12 will move them into `src/settings.js` later. Do not create
  `src/settings.js` and do not restructure `src/views/settings.js`.
- **`items.saved` is stored as `0 | 1`, not a boolean** — IndexedDB cannot index
  a boolean and the schema indexes it. Same for any other indexed flag you add.
- **Item ids are `publicationId + ":" + feedItemId`.** Feed-level ids collide
  across Publications; never key on the raw Feed id.
- **A Custom Publication needs an `id`** that cannot collide with a Catalog
  slug. Derive it from the Feed URL (for example `custom:` plus a hash) and say
  what you chose in your Notes.
- **Known wrinkle you may fix if it is cheap, otherwise report it:** with no
  Enabled Publications, the boot-time `syncIfStale()` still writes `lastSyncAt`,
  so Settings reads "Last synced: now, 0 Items". Enabling a Publication should
  make the next Sync do real work regardless.
- The Catalog is at `data/catalog.json` (30 verified Publications, 15 IT and
  15 GB). `tools/check-catalog.mjs` exports `validateCatalog`, `CATEGORIES` and
  `feedKind`; reuse rather than re-deriving. `data/catalog.json` is **not** in
  the `SHELL` array yet — add it, since the app cannot show the Catalog offline
  without it, then run `npm run stamp`.
