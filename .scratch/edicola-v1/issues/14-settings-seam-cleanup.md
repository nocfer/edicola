# 14 — Collapse the two ways to read a setting

**What to build:** One settings layer. Tickets 08 and 12 ran in parallel and
each grew its own: `src/catalog.js` carries a stopgap pair of helpers over the
`settings` table, and `src/settings.js` is the real typed store. Both work
today, which is exactly why this needs doing before a third screen picks the
wrong one.

**Blocked by:** nothing. Verified on `main`: `src/catalog.js` is imported by
`src/views/publications.js` alone, and ticket 10 (the Reader, running in
parallel) has been told not to import it and not to touch your three files.

**Status:** done

**Owns:** `src/settings.js`, `src/catalog.js`, `src/views/publications.js`
(call sites only), and their tests.

The migration ticket 12's author specified, verbatim:

- add `nations: "nations"` to `SETTINGS_KEYS` and `nations: []` to
  `DEFAULT_SETTINGS`, and normalize it in `normalizeSettings`
- add `getNations` / `setNations` to `SettingsStore`
- replace the read with `await (await getSettingsStore()).getNations()` and the
  write with `await (await getSettingsStore()).setNations(nations)`
- delete `readSetting`, `writeSetting`, `readSelectedNations`,
  `writeSelectedNations`, `readLanguage` and `writeLanguage` from
  `src/catalog.js`

- [x] `src/catalog.js` exports no settings helper and keeps only Catalog
      concerns: merging, grouping, inference, and the Publication row writes.
- [x] Language is read and written in one place. Note that `src/i18n.js` also
      keeps the Language in `localStorage` for the pre-paint script in
      `index.html`; the database copy and the `localStorage` copy must not
      disagree. Decide which is authoritative, write it down, and make the
      other follow.
- [x] Nothing imports a settings helper from `src/catalog.js`; grep to prove it.
- [x] Existing tests still pass unchanged where they test behaviour rather than
      the helper names. Update only the tests that named the deleted functions.
- [x] All five gates green.

## Integrator notes (read before starting)

- **Ticket 10 runs in parallel** and owns `src/views/reader.js`,
  `src/article-render.js` and `src/fetch-one.js`. It will import
  `effectiveProxyTemplate` and `getSettingsStore` from `src/settings.js`, so
  **keep those two exports working with those names and signatures**. Anything
  else in that module is yours to reshape.
- `src/sync-client.js` also imports `effectiveProxyTemplate` and
  `getSettingsStore`. You may edit its import line if you rename something, but
  change nothing else in that file.
- The Language question is the substantive part of this ticket, not the
  mechanical move. `src/i18n.js` keeps the Language in `localStorage` because
  the pre-paint script in `index.html` must read it before any module loads, and
  ticket 08 also wrote it to the `settings` table. Two copies can disagree.
  Decide which is authoritative, make the other follow it, and write the
  decision into the ticket Notes. Do not add an ADR for it.
- This is a refactor: behaviour must not change. Prove it by running the
  Publications screen in a browser afterwards — toggle a Publication, change the
  Nation selection, reload, and confirm both survived.

## Notes

There is one settings layer now: `src/settings.js`. `src/catalog.js` no longer
touches the `settings` table at all, and the interface Language has exactly one
copy.

### `src/settings.js` — the interface after this ticket

Unchanged, and depended on by ticket 10 and `sync-client.js`:
`effectiveProxyTemplate(stored)` and `getSettingsStore()` keep their names,
signatures and behaviour. So do `SETTINGS_KEYS`, `PROXY_PLACEHOLDER`, `MIB`,
`PROXY_TEST_FEED_URL`, `PROXY_TEST_MAX_BYTES`, `DEFAULT_SETTINGS`,
`RETENTION_BOUNDS`, `RETENTION_FIELDS`, `EVICTING_FIELDS`,
`validateProxyTemplate`, `usesDefaultProxy`, `clampRetentionValue`,
`normalizeRetention`, `retentionShrank`, `retentionEquals`,
`testProxyTemplate` and `createSettingsStore(db)`.

Added:

```js
export const SETTINGS_KEYS;   // { proxyTemplate, retention, nations }
export const DEFAULT_SETTINGS; // { proxyTemplate: "", retention: DEFAULT_RETENTION, nations: [] }
export function normalizeNations(value): string[]
export function normalizeSettings(stored): Settings   // now also normalizes `nations`
```

```js
/** @typedef {{ proxyTemplate: string, retention: RetentionLimits, nations: string[] }} Settings */
/**
 * @typedef {object} SettingsStore   (the two new members; the rest is ticket 12's)
 * @property {() => Promise<string[]>} getNations
 * @property {(nations: readonly string[]) => Promise<string[]>} setNations
 */
```

- `nations` is stored as upper-case ISO 3166-1 alpha-2 codes, in the given
  order, deduplicated; anything that is not a Nation code is dropped.
  `normalizeNations` never throws and never returns its input array.
- **`[]` is the first-run signal**, exactly as the absence of ticket 08's
  `selectedNations` row was: `getNations()` answers `[]` until the reader has
  chosen, and that is what makes the Publications screen seed from the browser
  locale (ADR-0006).
- `setNations([])` — and anything that normalizes to nothing — throws
  `RangeError`, which is `writeSelectedNations`'s old contract kept: the Catalog
  needs at least one Nation, and an empty row would also erase the first-run
  signal. The guard lives in `write()`, so both entry points share it.

### `src/catalog.js` — what left, and the new seam

Deleted: `readSetting`, `writeSetting`, `readSelectedNations`,
`writeSelectedNations`, `readLanguage`, `writeLanguage` and the
`SETTING_KEYS` constant (its two keys now live in `SETTINGS_KEYS`, and
`language` no longer exists at all). The file's section 1 is gone; the two
remaining sections are renumbered.

`loadPublications` is the only function that was affected, and it now takes the
stored selection instead of reading it:

```js
export async function loadPublications(db, {
  languages = [], catalog, selectedNations = [],
}): Promise<PublicationsData>
```

`PublicationsData` gained one field:

```ts
inferredNations: string[] | null   // the seeded selection, non-null only when it
                                   // did not come from the stored one
```

That is what keeps the module honest: it reads and writes the `publications`
table only, takes the setting as data and hands the seeded value back for the
caller to persist. `inferredNations` is symmetric with `inferredLang` (both are
non-null only when there is something for the caller to apply), and the caller
writes the exact array it was given, so the two cannot drift.

`src/views/publications.js` is the Nation row's only writer. It has two
three-line helpers, `readNations()` and `saveNations(nations)`, over
`getSettingsStore()`, used by `load()`, `toggleNation()` and
`ensureNationSelected()`. Nothing else in the file changed.

### The Language decision: `localStorage['edicola.lang']` is authoritative

The database copy is **deleted**, not mirrored.

The pre-paint script in `index.html` has to set `<html lang>` before any module
loads, or the first paint is in the wrong language. It can only read
synchronous storage: IndexedDB is async and Dexie arrives from a CDN, so the
`settings` row can never serve the boot path. `localStorage` therefore cannot be
the follower — it is the only copy that can be the authority. `src/i18n.js`
already owns it (`initLang` reads it, `setLang` writes it, `LANG_KEY` is the
shared constant), and `src/main.js`'s `applyLang` is the single place that
persists a change, so the read/write path was already down to one owner.

That left ticket 08's `settings.language` row, which `views/publications.js`
re-wrote on every load and **nothing ever read** — `readLanguage` had no caller
outside its own test. A copy that is written but never read cannot be right; it
can only be a second thing to contradict the first. So the honest way to make
the two agree was to have one: the `language` key is gone from the schema, the
two helpers are deleted, and the `await writeLanguage(db, state.lang)` line at
the end of `load()` is gone with them. `theme` already works exactly this way
(`edicola.theme`, pre-paint, no database row), and `storage-usage.js` already
groups the two together in `PREFERENCE_KEYS`, so "Reset app" still forgets the
Language.

Nothing about the visible behaviour changes: the first-run inference still only
applies when `edicola.lang` is absent, which is still exactly "the reader has
not chosen yet".

No ADR was added, as the ticket asked. ADR-0006 is untouched and still true:
Language and Nation stay independent settings — they are simply stored in the
two different places each one's boot requirements demand.

### What the integrator must know

- **Nothing to add to `SHELL`.** No new files. `sw.js`'s `CACHE` was re-stamped
  because three Shell files changed: it is now **`edicola-816a8d8d`** (was
  `edicola-2af08973`). If this branch merges with another that also re-stamps,
  take either `sw.js` and run `npm run stamp` on the merged tree.
- **`src/sync-client.js` is untouched.** `effectiveProxyTemplate` and
  `getSettingsStore` kept their names, so its import line needed no edit. Same
  for ticket 10's Reader.
- **The row key changed name**: ticket 08 stored `selectedNations`, this stores
  `nations` (the name ticket 12 specified). A database that predates this branch
  keeps a dead `selectedNations` row and re-infers its Nations once, from the
  browser locale, on the next visit to Publications. Harmless before release
  and nothing reads the old key; a migration was deliberately not written for
  it (ADR-0008 is additive-only, and there are no shipped installs). If one is
  ever wanted, the place is `createSettingsStore`'s `read()`.
- **`test/catalog-merge.test.js`'s `fakeDb` lost its `settings` table**, since
  `src/catalog.js` no longer has one to fake. Its two settings round-trip tests
  moved to `test/settings.test.js` as five tests against the real store; the
  three `loadPublications` tests now pass `selectedNations` and assert
  `inferredNations`. 232 tests pass, up from 227.
- **A cosmetic knock-on:** the Settings Storage card's `settings` row count is
  one lower than before on a fresh database, because the Language row is no
  longer created.
- `.tokensave/` is present in the worktree as an untracked directory (an MCP
  index, not mine). Not committed, not in `.gitignore`.

### Verified in the browser (screenshots live outside the repo)

Static server on :8087 from this worktree, one reused Chrome profile,
`tools/screenshot.mjs --eval` driving real clicks. Every check was run after a
reload, and the reload checks were run twice because the worker serves the
Shell stale-while-revalidate.

- **First run** seeded `Italy=false, United Kingdom=true` from headless
  Chrome's `en-US` and wrote a single settings row, `nations`. **No `language`
  row was ever created** — the proof the second copy is gone.
- **All three survive a reload.** Switched BBC News on, clicked the "Italia"
  chip on, then picked "Italiano" in Settings. Two consecutive reloads read
  back `htmlLang: "it"`, `localStorage['edicola.lang']: "it"`,
  chips `Italia=true, Regno Unito=true`, `nations: ["IT","GB"]`, BBC News on.
- **Shrinking the selection persists too**: clicking "Italia" off left
  `nations: ["GB"]`, and both following reloads agreed. `setNations([])` threw
  `RangeError`, so the "at least one Nation" rule still holds at the storage
  layer.
- **Sync still runs through the reader's saved Proxy override.** Saving
  `http://localhost:8087/proxy?url={url}` (http is allowed on localhost) and
  running `syncNow({ publicationIds: ["bbc-news"] })` produced eleven
  `GET /proxy?url=https%3A%2F%2F…` hits in the static server's own log, all
  404, `feedsFailed: 1` — the relay was the path taken. Clearing the override
  and syncing again through the shipped default stored 34 Items, 10 Articles
  and 21 images.
- The Publications screen renders normally in Italian, dark theme.

### Gates on this branch

```
npm test                                                   0   (232 tests, 5 new)
biome@2 format --write . && biome@2 ci .                   0   (2 infos about biome.json, pre-existing)
npm run typecheck                                          0
node tools/check-imports.mjs                               0
npm run stamp && npm run stamp:check                       0   (CACHE edicola-816a8d8d)
grep -rn 'from "../catalog.js"' src/                       one hit, views/publications.js,
                                                           importing Catalog functions only
```
