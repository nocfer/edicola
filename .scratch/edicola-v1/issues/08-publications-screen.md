# 08 — Publications screen: pick Nations, toggle Publications, add a Custom one

**What to build:** The Publications tab shows the Catalog grouped by Nation
then Category with a toggle per Publication and a per-Publication Unread dot
placeholder. A Nation selector at the top controls which Nations are shown,
inferred from browser locale on first run. A "Add by URL" form at the bottom
runs feed autodiscovery and creates a Custom Publication. Toggles persist and
drive which Publications Sync.

**Blocked by:** 01, 02 (discoverFeeds), 06 (catalog), 07 (db/store). All merged into `main`.

**Status:** done

**Owns:** `src/views/publications.js`, `src/catalog.js` (loads
`data/catalog.json`, merges with `publications` table, first-run seeding),
`test/catalog-merge.test.js`, strings in `i18n.js` under the `pubs.*` prefix,
styles under a `/* Publications */` block in `styles.css`. May add
`data/catalog.json` and new files to `SHELL` and stamp.

- [x] First run: infer Nations from `navigator.languages` (it → IT, en-GB → GB, other en → GB for now); infer Language similarly (ADR-0006). Persist in `settings`. Nothing is Enabled by default; the screen invites the reader to switch Publications on.
- [x] Catalog load merges the shipped JSON with the `publications` table: new Catalog entries appear, removed ones stay if Enabled (flagged "no longer in Catalog"), Custom ones untouched. Pure merge function, unit tested.
- [x] Nation selector: chips for every Nation present in the Catalog, multi-select, at least one required. Category groups collapse/expand; Publication rows show name, site domain, a `truncated` hint ("full text fetched from the site"), and a switch.
- [x] Toggling writes `enabled` immediately and, when turning on while online, triggers a Sync for that Publication only (use `sync-client.js`).
- [x] "Add by URL": paste a site or feed URL; the app fetches it through the fetcher, tries `parseFeed` first, else `discoverFeeds` and probes candidates; shows the found Feeds to pick from; creates a Custom Publication with `country`/`language` guessed from the Feed language and editable. Errors use the fetcher's `kind` for honest copy (offline vs blocked vs not found).
- [x] Strings in `en` and `it`; the i18n parity test still passes.
- [x] CDP screenshots of the screen in both themes and both Languages, including the add-by-URL result state.
- [x] Gates green, stamp run.

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

## Notes

### Files

- New: `src/catalog.js`, `test/catalog-merge.test.js`.
- Rewritten: `src/views/publications.js` (was the placeholder).
- Extended: `src/i18n.js` (`pubs.*` in both dictionaries), `src/styles.css`
  (one `/* Publications */` block before the reduced-motion media query),
  `sw.js` (`SHELL` gained `./src/catalog.js` and `./data/catalog.json`;
  `CACHE` is now `edicola-9f82e4f4`).

### Exported interface (`src/catalog.js`, named exports only)

```js
export const CATALOG_URL;                       // new URL("../data/catalog.json", import.meta.url).href
export const SETTING_KEYS;                      // { selectedNations: "selectedNations", language: "language" }
export const CUSTOM_GROUP = "custom";           // the group key Custom Publications render under

// 1. The settings seam — ticket 12 moves these four (and `readSetting` /
//    `writeSetting`) into `src/settings.js` unchanged.
export async function readSetting(db, key): Promise<unknown>
export async function writeSetting(db, key, value): Promise<void>
export async function readSelectedNations(db): Promise<string[] | null>   // null = first run
export async function writeSelectedNations(db, nations): Promise<void>    // throws RangeError on []
export async function readLanguage(db): Promise<'en'|'it'|null>
export async function writeLanguage(db, lang): Promise<void>

// 2. Pure
export function inferPreferences(languages, availableNations): { nations: string[], lang: 'en'|'it' }
export function mergeCatalog(catalog, rows = []): CatalogEntry[]
export function nationsOf(entries): string[]
export function groupByNation(entries, categories = []): NationGroup[]
export function customPublicationId(feedUrl): string
export function guessOrigin(feedLanguage, fallback = {}): { country: string, language: string }
export function normalizeFeedInput(input): string        // throws FeedLookupError('invalid-url')

// 3. Database and network glue (the Dexie handle is always a parameter)
export async function loadCatalog(fetchImpl?): Promise<Catalog>
export async function loadPublications(db, { languages?, catalog? }): Promise<PublicationsData>
export async function setPublicationEnabled(db, entry, enabled): Promise<PublicationRow>
export async function addCustomPublication(db, input): Promise<PublicationRow>
export async function removeCustomPublication(db, id): Promise<void>
export class FeedLookupError extends Error { name: 'FeedLookupError'; kind; url }
export async function findFeeds(input, { fetcher, DOMParser, limit = 4, maxProbes = 6 }): Promise<FeedFinding[]>
```

Shapes:

```ts
type CatalogEntry = PublicationRow & { inCatalog: boolean, note: string | null };
type CategoryGroup = { category: string, publications: CatalogEntry[] };
type NationGroup   = { country: string, groups: CategoryGroup[] };
type PublicationsData = {
  catalog: Catalog, entries: CatalogEntry[], nations: string[],
  selectedNations: string[],          // always at least one
  inferredLang: 'en' | 'it' | null,   // non-null only on first run
};
type FeedFinding = {
  feedUrl: string, title: string, siteUrl: string | null,
  description: string | null, language: string | null,
  format: 'rss2'|'atom'|'rdf'|'json', itemCount: number, truncated: boolean,
};
```

`src/views/publications.js` still exports only `publicationsView(state)`.

### The merge

`mergeCatalog(catalog, rows)` is pure and total (it tolerates a null Catalog
and missing rows). Resolution rules, in `test/catalog-merge.test.js`:

- A Catalog entry is shown with the **Catalog's** own fields — a renamed or
  re-categorised Publication updates itself — plus the reader's `enabled`,
  `lastSyncedAt` and `lastError` from the stored row.
- A stored Catalog Publication that has left the Catalog stays while it is
  Enabled, with `inCatalog: false` (the row shows "no longer in the Catalog");
  once switched off it disappears with the entry.
- A Custom Publication passes through untouched, on or off.
- Order is the Catalog's own, then leftover rows in table order.

The merge is display data only: it never writes. A row is written the moment
the reader toggles something (`setPublicationEnabled` writes the whole row, so
a Catalog entry nobody has touched is created on the spot).

### Custom Publication id scheme

`custom:` + a 32-bit FNV-1a hash of the trimmed Feed URL as eight lower-case
hex digits, e.g. `custom:3f1a92b7`. A Catalog id is a slug
(`^[a-z0-9]+(-[a-z0-9]+)*$`), which can never contain a colon, so collision is
impossible; and the same Feed added twice lands on the same row instead of a
duplicate. The Item id rule is unchanged (`publicationId + ":" + feedItemId`),
so a Custom Publication's Items read `custom:3f1a92b7:<feed id>`.

### The settings seam (for ticket 12)

Two rows in the `settings` table, keys in `SETTING_KEYS`:

- `selectedNations` — `string[]`, the Nations the chips show. Its **absence is
  the first-run signal**; `writeSelectedNations` refuses an empty array so the
  "at least one Nation" rule cannot be violated through storage.
- `language` — `'en' | 'it'`, written on first run from the inference and
  re-written on every load of this screen so it tracks `state.lang`.

`localStorage['edicola.lang']` is still the authority the app boots from
(`initLang` in i18n.js): the settings row is the durable copy ADR-0006 asks
for, and the row ticket 12 should read once it owns Settings. The inferred
Language is applied (`update({ lang })`) **only when `edicola.lang` is absent**,
which is exactly "the reader has not chosen yet" — `main.js` writes that key
only when `state.lang` diverges from `getLang()`, i.e. after a real choice.

Ticket 12 should move `readSetting`, `writeSetting`, `readSelectedNations`,
`writeSelectedNations`, `readLanguage` and `writeLanguage` into
`src/settings.js` verbatim and have `catalog.js` import them; they are the top
section of the file, marked with a comment, and take the Dexie handle as their
first parameter.

### i18n keys added (`pubs.*`, both dictionaries, parity test green)

`pubs.intro`, `pubs.loading`, `pubs.loadError`, `pubs.retry`,
`pubs.placeholder` (repurposed: the Catalog is empty), `pubs.nations`,
`pubs.needNation`, `pubs.enabledCount` (`{enabled}`, `{total}`),
`pubs.truncated`, `pubs.notInCatalog`, `pubs.toggleAria` (`{name}`),
`pubs.groupAria` (`{category}`, `{count}`), `pubs.syncStarted` (`{name}`),
`pubs.remove`, `pubs.removedToast` (`{name}`);
`pubs.category.{news,politics,business,technology,science,culture,sport,local,custom}`;
`pubs.add.{title,hint,placeholder,find,looking,found,items,use,cancel,confirm,name,nation,language,added}`;
`pubs.error.{invalidUrl,offline,blocked,notFound,timeout,tooLarge,proxy,noFeed,unknown}`.
`pubs.title` was already there. Nation names are **not** in the dictionaries:
they come from `Intl.DisplayNames(LOCALES[lang], { type: 'region' })`, so a
Custom Publication from any Nation gets a real name for free.

### Decisions the ticket left open

- **`src/catalog.js` imports no Dexie.** Every database function takes the
  handle as a parameter and the view passes `getDatabase()`. That is what lets
  `test/catalog-merge.test.js` import the module under Node (the Dexie CDN URL
  cannot resolve there) and test the settings helpers against a fake table.
- **The screen's transient state lives in `src/views/publications.js`**, in one
  module-level `screen` object (collapsed groups, the add-by-URL form, the
  loaded entries), not in `state.js`. Nothing outside the screen reads it and
  it does not survive a reload; every mutation still ends in a bare `update()`,
  so main.js's single subscriber is what redraws. This also keeps `state.js`
  (ticket 01's file) untouched, one less merge conflict for the integrator.
- **Nation inference** uses `navigator.languages` in order: a tag contributes
  its region subtag when the Catalog has that Nation (`en-GB` → GB), else the
  Nation its Language points at (`it` → IT, any other `en` → GB, from a
  `LANGUAGE_NATION` map that grows with the Catalog). A locale that points
  nowhere in the Catalog (`fr-FR`) selects **every** Nation rather than showing
  an empty screen. A saved Nation the Catalog no longer has falls back to the
  inference without touching the Language.
- **Custom Publications are grouped apart**, under `CUSTOM_GROUP` ("Added by
  you" / "Aggiunte da te"), last inside their Nation, rather than being filed
  into a curated Category. They are stored with `category: "news"` so the row
  satisfies the schema; the grouping keys off `custom`, not the Category. Each
  Custom row carries a "Remove" button (`removeCustomPublication` refuses
  anything that is not Custom — Catalog entries are switched off, never
  deleted).
- **Category groups default to expanded** and collapse per Nation+Category
  (`country/category` keys); the state is in memory only, deliberately, since a
  reader who collapses Sport once has not made a setting.
- **`findFeeds` probes at most six candidates and returns at most four Feeds.**
  A URL that parses as a Feed is used as-is with no extra request. Otherwise
  `discoverFeeds` supplies candidates: advertised ones are all probed, but the
  six conventional guesses stop at the first that parses (they only appear when
  a site advertises nothing, and each probe is a real round trip). A candidate
  that fetches but does not parse is skipped, not reported.
- **`FeedLookupError.kind`** is the fetcher's vocabulary (`offline`, `blocked`,
  `not-found`, `timeout`, `too-large`, `proxy-unconfigured`) plus `invalid-url`
  (refused before any request; a bare domain gets `https://` first) and
  `no-feed` (everything fetched, nothing parsed). The view maps kinds to
  `pubs.error.*`; a kind with no honest short sentence (a Feed parser reason
  such as `malformed-xml`) falls back to `pubs.error.unknown` in the form and
  is **silent** on a Publication row rather than guessing.
- **`truncated` for a Custom Publication** is "no Item carries full content",
  and an empty Feed counts as Truncated (the conservative guess).
- **The Nation and Language of a Custom Publication** are guessed from the
  Feed's declared language (`en-US` → US/en, `it` → IT/it) and editable in two
  short fields; on confirm the edited values go back through `guessOrigin`, so
  a typo normalizes instead of storing nonsense.
- **Per-Publication Syncs are queued in the view.** `syncNow` joins a run
  already in flight instead of starting a second one, so switching three
  Publications on in a row would have Synced only the first; each waits for the
  previous. A Sync started from a toggle refreshes the rows when it finishes,
  which is how `lastError` reaches the row.
- The Unread dot is a placeholder: a small accent dot (`.pub__unread`) rendered
  for Enabled Publications only. Tickets 09 and 11 should drive it from a real
  Unread count.
- `data/catalog.json` is fetched with plain `fetch` (same-origin Shell data
  served through the worker's Shell cache), not through the content fetcher —
  ADR-0001 governs Feeds and Originals. It is now in `SHELL`, so the Catalog is
  browsable offline.

### The known wrinkle (`syncIfStale` with nothing Enabled)

Not fixed, and not fixable from this ticket: `runSync` calls `setLastSyncAt`
unconditionally and `sync.js`, `store.js` and `main.js` all belong to other
tickets. So a first boot with nothing Enabled still leaves Settings reading
"Last synced: now, 0 Items". What the ticket asked for does hold: enabling a
Publication does real work regardless, because the toggle calls
`syncNow({ publicationIds: [id] })` directly rather than waiting for
`syncIfStale`. The cheap fix for whoever owns `sync.js` next (ticket 11 or 12)
is to skip `setLastSyncAt` when the run had no Enabled Publications.

### Verified in the browser (screenshots live outside the repo)

Static server on :8081 from this worktree, throwaway Chrome profile per run,
`tools/screenshot.mjs` driving the clicks with `--eval`:

- The Catalog in **dark/en, dark/it, light/en, light/it**: 30 Publications, two
  Nation chips (Italy off, United Kingdom on — headless Chrome reports `en-US`,
  which is the "other en → GB" rule), eight Category groups per Nation, the
  Truncated hint on the Publications whose Catalog entry says so.
- Nation chips: clicking "Italia" added Italy and both Nations rendered with
  their groups in Italian (`Notizie`, `Politica`, `Economia`, …).
- Collapse/expand: clicking every group head collapsed all sixteen groups.
- **Add by URL against the live network** (through the default Proxy, since
  neither site answers CORS): `wordpress.org/news/` autodiscovered three Feeds
  (`WordPress News`, `Comments for WordPress News`, `WordPress Briefing`, 10/10/86
  Items) and picking the first filled the form with `WordPress News` / `US` /
  `en`; `https://www.smashingmagazine.com/feed/` parsed directly (40 Items) and
  filled `GB` / `en`.
- Error copy, all three from the real fetcher: `http://localhost:8081/nope` →
  "There is nothing at that address." (`not-found`), `mailto:…` → "That does not
  look like a web address." (`invalid-url`, no request made),
  `http://localhost:8081/icon.svg` → "No Feed was found at that address."
  (`no-feed`, after the six guesses 404ed).
- **Two real Catalog Publications enabled** (BBC News, Nature): both rows
  written, both Syncs ran, and the database held `publications 2, items 84,
  articles 17, images 40, settings 2`. The rows showed the switch on, the
  Unread dot and "1 of 4 on" / "1 of 2 on" / "2 of 30 on".

Not verified: the offline reload of this screen from the Shell cache (the
Catalog is in `SHELL` and stamped, but the run was not repeated with a primed
profile and the server stopped), and a Publication that leaves the Catalog
while Enabled — the merge covers it in the unit test, but no real Catalog entry
has been removed to see the flag in the UI.

### Gates on this branch

```
npm test                                                      0   (163 tests, 33 new)
npx -y @biomejs/biome@2 format --write . && biome@2 ci .       0   (2 infos about biome.json, pre-existing)
npm run typecheck                                             0
node tools/check-imports.mjs                                  0
npm run stamp && npm run stamp:check                          0   (CACHE edicola-9f82e4f4)
```

`.tokensave/` appeared in the worktree as an untracked directory (the MCP index,
not mine); it is not committed and is not in `.gitignore`.
