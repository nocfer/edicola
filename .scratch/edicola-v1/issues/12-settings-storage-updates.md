# 12 — Settings: Proxy, Retention, storage, and safe updates

**What to build:** The Settings tab exposes Language, theme, the Proxy URL
(default shown, override editable, "test" button), Retention limits, storage
usage with a clear button, and the app version. A new version is announced
with an update prompt and applied on confirmation; a Shell older than the
database forces a reload (ADR-0008).

**Blocked by:** 07 (db/meta) — merged. Ticket 08 runs **in parallel** with
this one; its only overlap is shared copy, so do not wait for it and do not
read its files.

**Status:** done

**Owns:** `src/views/settings.js`, `src/settings.js` (typed get/set over the
`settings` table with `DEFAULT_RETENTION` defaults), `src/update.js` (service
worker update prompt and version guard), `src/storage-usage.js`,
`test/settings.test.js`, strings under `settings.*`, styles under
`/* Settings */`. May edit `index.html` and `sw.js` for the update flow
(`skipWaiting` on message), and `db.js` to stamp `appVersion` in `meta`
during `on('ready')`.

- [x] Proxy: shows the default template and service name, an input for a custom template containing `{url}`, validation, and a "Test" button that fetches a known Feed through it and reports the fetcher's `kind` on failure. Link to the README section on self-hosting (ticket 13 writes it; link to the anchor now).
- [x] Retention: days kept, total size cap, per-Article image cap, Items per Publication, Pre-fetch per Publication; each with the default from `DEFAULT_RETENTION` and sane bounds; saving triggers Eviction if limits shrank.
- [x] Storage: `navigator.storage.estimate()` plus a per-table byte count; whether persistent storage was granted; "Clear all content" (keeps Enabled Publications and settings) and "Reset app" (everything), each behind a confirm.
- [x] Update prompt: detect `registration.waiting`, show a toast "New version available — Reload"; on confirm post `skipWaiting` to the worker and reload on `controllerchange`. Replace SkyHue's auto-reload behaviour from ticket 01 with this.
- [x] Version guard: `APP_VERSION` constant stamped into `meta.appVersion` on db ready; if the running Shell's version is older than the stored one, unregister nothing, just `location.reload()` once (sessionStorage guard) to pick up the newer Shell. Migrations are additive only; add a comment block in `db.js` saying so with the ADR number.
- [x] Settings model functions (defaults, bounds, template validation) are pure and unit tested.
- [x] CDP screenshots in both themes and Languages.
- [x] Gates green, stamp run.

## Integrator notes (read before starting)

- **Ticket 08 is running in parallel** on `ticket/08-publications-screen`. It
  owns `src/views/publications.js` and `src/catalog.js`; you must not create or
  edit either. It is keeping a small pair of Nation-selection helpers at the top
  of `src/catalog.js` as a stopgap. **You own `src/settings.js`**: design it as
  the real typed layer over the `settings` table. Do not try to move 08's
  helpers (they do not exist on your branch); instead list in your Notes the
  exact call the integrator should swap them for.
- **You own the Settings screen wholesale.** `src/views/settings.js` currently
  has Appearance, Language and a Sync card from ticket 07. Keep all three
  working, and note that it calls `initSyncClient()` on render, which is now
  redundant because `src/main.js` calls it at boot — remove the call from the
  view.
- **A real wrinkle to fix, since you own this screen:** with no Enabled
  Publications, the boot-time `syncIfStale()` still writes `lastSyncAt`, so
  Settings reads "Last synced: now, 0 Items". Make the Sync card honest when
  nothing is enabled (for example "No Publications enabled yet" with a link to
  the Publications tab), and if the fix belongs in `sync-client.js` instead,
  say so in your Notes rather than editing a file you do not own.
- **`items.saved` is stored as `0 | 1`, not a boolean** (IndexedDB cannot index
  a boolean). Count Saved Items accordingly in the storage breakdown.
- **The default Proxy is fragile and this screen is the mitigation.** Verified
  on 2026-09-07: `corsproxy.io` now requires an API key, `allorigins` and
  `codetabs` returned Cloudflare 522, `cors.lol` rate-limits every request. The
  default is a small community Cloudflare Worker whose service name is exported
  as `DEFAULT_PROXY_SERVICE`. Make the override prominent, not buried, and note
  that proxied responses have their `content-type` rewritten to `text/plain`.
- **Migrations are additive only** (ADR-0008). `src/db.js` already exports
  `APP_VERSION`, `SCHEMA_VERSION` and `META_KEYS`; extend rather than redefine.
- `sw.js` already handles `message` and `periodicsync`. Add the `skipWaiting`
  path to the existing message handler rather than a second listener, and
  replace the auto-reload in `index.html` with the prompt (ticket 01 left it
  auto-reloading on `controllerchange` and flagged it as yours).

## Notes

### Files that must be in `SHELL` (all three added, `npm run stamp` run)

`./src/settings.js`, `./src/storage-usage.js`, `./src/update.js`.
`CACHE` is now `edicola-30ae993e`.

### Exported interfaces

**`src/settings.js`** — the typed layer over the `settings` table plus the
pure model the screen renders. Imports only `retention.js` and `fetcher.js`
(neither touches Dexie or the DOM), so the whole module is importable and
testable under Node.

```js
export const SETTINGS_KEYS = Object.freeze({ proxyTemplate, retention });   // row keys
export const PROXY_PLACEHOLDER = "{url}";
export const MIB = 2 ** 20;
export const PROXY_TEST_FEED_URL = "https://feeds.bbci.co.uk/news/rss.xml";
export const PROXY_TEST_MAX_BYTES = 256 * 1024;
export const DEFAULT_SETTINGS = Object.freeze({ proxyTemplate: "", retention: DEFAULT_RETENTION });
export const RETENTION_BOUNDS   // { [field]: { min, max, step, unit: 'days'|'bytes'|'items' } }
export const RETENTION_FIELDS   // display order
export const EVICTING_FIELDS    // ['maxAgeDays','maxTotalBytes','keepPerPublication']

export function validateProxyTemplate(template): ProxyTemplateCheck
export function effectiveProxyTemplate(stored): string
export function usesDefaultProxy(stored): boolean
export function clampRetentionValue(field, value): number
export function normalizeRetention(partial): RetentionLimits
export function normalizeSettings(stored): Settings
export function retentionShrank(before, after): boolean
export function retentionEquals(a, b): boolean
export async function testProxyTemplate(template, { fetch?, feedUrl?, onLine? }): Promise<ProxyTestResult>
export function createSettingsStore(db): SettingsStore
export async function getSettingsStore(): Promise<SettingsStore>
```

```js
/** @typedef {{ proxyTemplate: string, retention: RetentionLimits }} Settings */
/**
 * @typedef {object} ProxyTemplateCheck
 * @property {boolean} valid            may be saved ("" is valid: use the default)
 * @property {null|'missing-placeholder'|'malformed'|'insecure-scheme'} problem
 * @property {boolean} usesDefault      the template is empty
 * @property {string} template          trimmed
 */
/**
 * @typedef {object} ProxyTestResult
 * @property {boolean} ok               a document that looks like a Feed came back
 * @property {string|null} kind         the fetcher's failure kind, or 'not-a-feed',
 *                                      or 'direct' (the relay was never exercised)
 * @property {number|null} status
 * @property {'direct'|'proxy'|null} via
 * @property {number} bytes
 * @property {string} template
 */
/**
 * @typedef {object} SettingsStore
 * @property {() => Promise<Settings>} read
 * @property {(patch: Partial<Settings>) => Promise<Settings>} write
 * @property {() => Promise<string>} getProxyTemplate
 * @property {(template: string) => Promise<string>} setProxyTemplate
 * @property {() => Promise<RetentionLimits>} getRetention
 * @property {(limits: Partial<RetentionLimits>) => Promise<RetentionLimits>} setRetention
 * @property {() => Promise<void>} clear
 */
```

`createSettingsStore(db)` takes the handle as a **required parameter** (unlike
`createSyncStore`, whose default calls `getDatabase()`) so that importing
`settings.js` never pulls the Dexie CDN URL into Node. The app's singleton is
`getSettingsStore()`, which is `async` because it reaches `db.js` through a
lazy `await import("./db.js")`. Two rows are stored, one per key in
`SETTINGS_KEYS`; anything missing, out of bounds or hand-edited reads back as
the default, so a corrupt row cannot brick the screen (tested).

**`src/storage-usage.js`** — the measurement and the two destructive actions.
Takes the handle, the estimate function and the `meta` reader as parameters,
so it too is Node-testable.

```js
export const STORAGE_TABLES   // ['publications','items','articles','images','settings','meta']
export const PREFERENCE_KEYS  // ['edicola.theme', LANG_KEY]
export function estimateValueBytes(value): number
export function estimateRowBytes(row): number
export function formatBytes(bytes, locale = 'en'): string
export async function readStorageUsage({ db, estimate?, getMeta?, persistentStorageKey?, now? }): Promise<StorageUsage>
export async function countEnabledPublications(db): Promise<number>
export async function clearContent(db, { lastSyncAtKey? }): Promise<{ items, articles, images }>
export async function resetApp(db, { local?, session?, keys? }): Promise<void>
```

```js
/**
 * @typedef {object} StorageUsage
 * @property {number|null} usage        navigator.storage.estimate().usage
 * @property {number|null} quota
 * @property {TableUsage[]} tables      { table, rows, bytes } in STORAGE_TABLES order
 * @property {number} tablesBytes       sum of tables[].bytes — content only
 * @property {boolean|'unsupported'|null} persistent   meta.persistentStorage
 * @property {number} enabledPublications
 * @property {number} savedItems        counts `saved === 1` (ticket 07's 0|1 rule)
 * @property {number} measuredAt
 */
```

**`src/update.js`** — ADR-0008, both halves. Imports only `state.js`, so the
comparison and guard logic are unit-tested.

```js
export const SKIP_WAITING_MESSAGE = "skip-waiting";
export const RELOAD_GUARD_KEY = "edicola.versionReload";
export const CONTROLLER_CHANGE_TIMEOUT_MS = 4000;
export function compareAppVersions(a, b): -1 | 0 | 1
export function shouldReloadForVersion({ running, stored, alreadyReloaded }): boolean
export function runVersionGuard({ runningVersion, storedVersion, session?, reload? }): boolean
export function watchForWaitingWorker({ registration, onWaiting }): void
export async function applyUpdate({ container?, reload?, timeoutMs? }): Promise<boolean>
export function dismissUpdate(): void
export function initUpdates(): void
```

**`src/db.js`** (extended, not redefined) — one new export:

```js
export function readVersionsBeforeStamp(): Promise<{ appVersion: string|null, schemaVersion: number|null }>
```

The `on('ready')` handler now **reads `meta.appVersion` and
`meta.schemaVersion` before overwriting them** and resolves that promise with
the pre-stamp values. Without this the version guard had nothing to compare
against: the stamp ran first and every boot looked current. The additive-only
comment block with the ADR number was already at the top of the file and is
unchanged.

**`src/views/settings.js`** — exports `settingsView(state)` (unchanged
signature) and `loadSettings()` (idempotent; the render calls it, so the
screen paints with defaults and fills in when the database answers).

### The exact call to swap ticket 08's stopgap helpers for

Ticket 08 is keeping a pair of Nation-selection helpers at the top of
`src/catalog.js`. Whatever their names, they are reading and writing a
reader preference, which is what `src/settings.js` is for. The integrator
should:

1. add the key to `SETTINGS_KEYS` in `src/settings.js`
   (`nations: "nations"`), give it a default in `DEFAULT_SETTINGS`
   (`nations: []`), normalize it in `normalizeSettings` (an array of
   upper-case ISO 3166-1 alpha-2 strings, deduplicated), and add
   `getNations` / `setNations` to `SettingsStore` alongside
   `getProxyTemplate` / `setProxyTemplate`;
2. replace 08's read helper with

   ```js
   const nations = await (await getSettingsStore()).getNations();
   ```

   and its write helper with

   ```js
   await (await getSettingsStore()).setNations(nations);
   ```

3. delete the helpers from `src/catalog.js` and let `views/publications.js`
   keep the selection in `state` the way `views/settings.js` does
   (`patchSettings`-style: one writer per state slice).

Nothing else in ticket 12 depends on those helpers, so the swap can happen
after both branches merge with no coordination.

### i18n keys added (`settings.*`, both dictionaries, parity test green)

`settings.proxy`, `.proxy.about`, `.proxy.default`, `.proxy.defaultNote`,
`.proxy.inUse`, `.proxy.usingDefault`, `.proxy.usingCustom`, `.proxy.custom`,
`.proxy.hint`, `.proxy.save`, `.proxy.useDefault`, `.proxy.test`,
`.proxy.testing`, `.proxy.testOk` (`{bytes}`), `.proxy.testDirect`,
`.proxy.testFailed` (`{kind}`), `.proxy.saved`, `.proxy.selfHost`,
`.proxy.invalid.missing-placeholder`, `.proxy.invalid.malformed`,
`.proxy.invalid.insecure-scheme`.

`settings.retention`, `.retention.about`, one label per limit
(`.retention.maxAgeDays`, `.maxTotalBytes`, `.maxImageBytesPerArticle`,
`.keepPerPublication`, `.prefetchPerPublication`), `.retention.unit.days`,
`.unit.bytes`, `.unit.items`, `.retention.default` (`{value}`),
`.retention.save`, `.retention.reset`, `.retention.saved`,
`.retention.evicted` (`{count}`), `.retention.evictionPending`.

`settings.storage`, `.storage.about`, `.storage.used`, `.storage.quota`,
`.storage.content`, `.storage.unknown`, `.storage.persistent` plus
`.granted` / `.denied` / `.unsupported` / `.unknown`, `.storage.savedItems`,
`.storage.tables`, `.storage.rows` (`{rows}`), `.storage.measure`,
`.storage.measuring`, one `.storage.table.<name>` per table,
`.storage.clear` + `.clear.hint` / `.clear.confirm` / `.clear.done`,
`.storage.reset` + `.reset.hint` / `.reset.confirm`.

`settings.sync.noPublications`, `settings.sync.choose`.
`settings.update.available`, `.update.reload`, `.update.applying`,
`.update.later`. `settings.about`, `.about.version`, `.about.schema`,
`.about.shell`. `settings.error`.

The invalid-template keys are named after the `problem` code
(`settings.proxy.invalid.${check.problem}`), so adding a validation rule
means adding one key pair and nothing else.

### How the Sync card was made honest

The fix is in the view, not in `sync-client.js`. `runSync` stamps
`meta.lastSyncAt` at the end of every run whether or not there was anything
to fetch, and that is correct — a Sync did happen, and `syncIfStale` needs
the stamp to avoid hammering the relay on every open. What was wrong was the
*copy*: "Last synced: now" with nothing enabled is true and useless.

So `loadSettings()` also runs `countEnabledPublications(getDatabase())` into
`state.settings.enabledPublications`, and the Sync card renders "No
Publications enabled yet" with a `.btn` link to `hrefFor('publications')`
instead of the last-Sync line and the "Sync now" button while that count is
0. Once a Publication is Enabled the card is exactly as ticket 07 left it.
Verified both ways (screenshots and a real Sync of `bbc-news`).

`initSyncClient()` was removed from the view as the ticket asked; `main.js`
already calls it and `syncIfStale()` at boot.

### The Eviction seam

Ticket 11 owns `src/evict.js`, which does not exist on this branch, so
`saveRetention()` calls it through a named seam in `views/settings.js`:

```js
const EVICT_MODULE = "../evict.js";        // widened to string so tsc skips it
async function runEvictionIfAvailable(limits) {
  try {
    const module = await import(EVICT_MODULE);
    if (typeof module.runEviction !== "function") return null;
    return await module.runEviction({ store: getSyncStore(), limits, now: Date.now() });
  } catch {
    return null;
  }
}
```

The integrator needs to change **nothing**: dropping ticket 11's
`src/evict.js` in makes the call live. With the module present the toast
reads `settings.retention.evicted` with the deleted count; without it, the
honest `settings.retention.evictionPending` ("the smaller limits apply at the
next Sync", which is true — `runSync` trims per Publication). Verified both
branches: with a temporary stub returning three ids the toast read "Retention
saved — 3 Items removed"; without it, the pending message, plus one expected
404 for `/src/evict.js` in the console.

`runEviction`'s signature is taken from ticket 11's own acceptance criterion
(`runEviction({ store, limits, now })` → `{ deleted, bytesFreed }`); if
ticket 11 ships a different shape, `runEvictionIfAvailable` is the one place
to change.

### Decisions the ticket left open

- **The Proxy override now actually takes effect.** `sync-client.js`'s
  `pageFetcher()` was hard-coded to the default and flagged "ticket 12 will
  pass the reader's own template". It is now `async` and builds the fetcher
  with `effectiveProxyTemplate(await (await getSettingsStore()).getProxyTemplate())`
  on every run, so a Proxy saved in Settings applies at the next Sync with no
  reload. That is a two-line edit to a file ticket 12 does not own; it was the
  difference between a real setting and a decorative one.
- **An empty template means "use the default", and is valid.** A stored value
  that no longer validates falls back to the default rather than disabling the
  Proxy, because a disabled Proxy looks like a broken app. The screen writes
  `""` for an invalid template, so the fallback is never silently sticky.
- **`https` is required; `http` is allowed only on `localhost`/`127.0.0.1`.**
  A plain-http relay is mixed content on any real deployment and the browser
  blocks it, so accepting one would be a validation that lies.
- **The "Test" button follows the same path a Sync does** — direct, then the
  relay — rather than hitting the relay in isolation. A green Test is then a
  promise about the next Sync. The test Feed (`feeds.bbci.co.uk`) answers no
  CORS header, so in a browser the relay is what decides; if a Feed *is*
  directly reachable the result says `kind: "direct"` and the copy says the
  relay was not tested, instead of crediting it for someone else's work.
  Verified live: the default relay returned 26 KB of real RSS; a relay wired
  to `httpbin.org/status/503` reported `blocked`.
- **Retention bounds** (in each limit's canonical unit; the two byte limits
  are edited in MB): days 1–365, total 50 MB–5 GB step 10 MB, images per
  Article 0–50 MB step 1 MB, Items per Publication 10–500 step 10, Pre-fetch
  0–50. Chosen to stay sane rather than maximal: 5 GB is already more than a
  phone grants, and fewer than ten Items per Publication makes Today feel
  broken. `DEFAULT_RETENTION` sits inside every range (asserted by a test).
- **Values are clamped on save, not while typing**, so typing "5" on the way
  to "50" is not fought by the input; `min`/`max`/`step` are on the element so
  the browser still hints. A non-finite or empty value falls back to the
  default rather than to the minimum.
- **Only `maxAgeDays`, `maxTotalBytes` and `keepPerPublication` trigger
  Eviction when they shrink** (`EVICTING_FIELDS`).
  `prefetchPerPublication` only bounds the next Sync, and
  `maxImageBytesPerArticle` is applied by Extraction when an Article is
  fetched (ticket 05's notes), never retroactively.
- **Two storage numbers are shown side by side, not reconciled.** The
  browser's `estimate()` is padded for privacy and includes the Shell cache;
  the per-table breakdown is measured from the rows. Pretending they are the
  same figure would be a lie. Live example: browser 5.5 MB, measured content
  4.6 MB (of which images 4.5 MB) for 34 Items / 8 Articles / 13 images.
- **Per-table bytes are an estimate** (`estimateRowBytes`): strings as UTF-8,
  Blobs by `size`, numbers as 8 bytes, objects recursively with a couple of
  bytes per key. IndexedDB's own encoding is not observable and the reader
  needs an order of magnitude, not an audit. Rows are streamed with Dexie's
  `each` and never retained, so measuring the images table does not hold every
  blob in memory.
- **"Clear all content" also forgets `meta.lastSyncAt` and each
  Publication's `lastSyncedAt`/`lastError`**, so the next Sync refills the
  newsstand instead of deciding the content is fresh. It keeps
  `publications` (with the `enabled` flags), `settings` and the rest of
  `meta`. It does remove Saved Items — they are content, and the confirm says
  so explicitly.
- **"Reset app" deletes the database and the localStorage preferences, then
  reloads, but deliberately leaves the Shell cache alone.** The Shell is the
  app's own files, not reader data (ADR-0007), and deleting it would leave the
  app unable to open offline until the next online load. The confirm and the
  hint both say the app stays installed.
- **`sw.js` no longer calls `skipWaiting()` on install.** That single line was
  what made a waiting worker impossible, so ADR-0008's prompt could never
  appear. A first install still activates immediately (no existing
  controller), so a first visit is not held up. The `skip-waiting` message
  path was added to the existing `message` handler, not a second listener.
- **`index.html` no longer auto-reloads on `controllerchange`.** Registration
  stays in that classic script (so it runs even if the modules fail to link and
  the self-heal watchdog has to step in); the reload now belongs to
  `applyUpdate()` and happens only after the reader confirms. `applyUpdate`
  also reloads after `CONTROLLER_CHANGE_TIMEOUT_MS` in case the event never
  reaches the page, and reloads immediately if the prompt has gone stale.
- **The prompt is a card above the tab bar, not a toast**, because it must
  wait for an answer rather than disappear; it carries "Reload" and "Later".
  "Later" hides it for the session only (`dismissUpdate`). It is rendered in
  `main.js` beside the `.toast`, so it shows on every screen — that is a
  three-line addition to a file ticket 12 does not own, and it is the only
  way a prompt can be app-wide with one render subscriber.
- **`state.js` gained two slices**, `settings` (`SettingsState`) and
  `appUpdate` (`UpdateState`), the same way ticket 07 added `sync`. Only
  `views/settings.js` writes the first and only `update.js` the second.
  The field is `appUpdate`, not `update`, so it never reads as the `update()`
  writer.
- **The version guard never unregisters anything**, as the ticket asked: it
  sets `sessionStorage['edicola.versionReload']` and calls
  `location.reload()` once. A `sessionStorage` that throws (private mode,
  storage disabled) means *no* reload, because a guard that cannot be
  recorded is a reload loop. A missing stored version (first run) and an
  equal or older one do nothing.
- **`.input`, `.input--number`, `.btn--danger` and `.update` are new
  primitives** living in the `/* Settings */` block. They use tokens only and
  a later screen may use them as they are; whoever needs them elsewhere
  should move them up into §4.
- **`settings.about.shell` exists but is unused.** It was added for a Shell
  cache line in the About card and left out because `CACHE` is not readable
  from the page without asking the worker. Either wire it or drop the key
  pair.
- **`settings.storage.rows` is not pluralized** ("1 rows", "1 righe"). The
  i18n layer has no plural rule and adding one for a debug line was not worth
  a new mechanism; a later ticket that needs plurals should fix it there.

### Verified (screenshots not committed; they live outside the repo)

Static server on :8082 from this worktree, throwaway and reused Chrome
profiles, `tools/screenshot.mjs` with `--eval`.

- Settings in dark × en, dark × it, light × en, light × it: every card
  renders, tokens follow the theme, both dictionaries read naturally.
- Proxy: the default template and `cors-get-proxy (Cloudflare Worker)` are
  shown in full. Validation live in the browser —
  `https://relay.example/fetch` → "The template must contain {url}",
  `http://relay.example/?url={url}` → "Use https…", `nonsense{url}` →
  "That is not a valid address", each with `aria-invalid="true"` and Save
  disabled. "Test" against the default relay: `Works: a real Feed came back
  (26 KB)` (the direct BBC fetch is CORS-blocked first, which is the expected
  console noise). Saving a custom relay flipped "In use" to "Your own relay"
  and persisted; testing it (`httpbin.org/status/503`) reported `blocked`;
  "Use the default" + Save cleared the row back to `""`.
- Retention: Save disabled until a value changes; saving 7 days / 5 Items per
  Publication / 100 MB stored `maxAgeDays: 7`, `keepPerPublication: 10`
  (clamped up from 5, and the input redrew as 10) and
  `maxTotalBytes: 104857600`. Shrinking a governing limit produced the
  Eviction toast (both with and without `src/evict.js` present, see above);
  "Restore defaults" + Save put `DEFAULT_RETENTION` back.
- Storage: after a real Sync of `bbc-news`, the card read browser 5.5 MB /
  quota 10 GB / measured content 4.6 MB / "Not granted yet" / 0 Saved Items,
  with the breakdown `publications 1 · items 34 (28 KB) · articles 8 (46 KB)
  · images 13 (4.5 MB) · settings 0 · meta 4`. "Clear all content" asked its
  confirm, then left `items/articles/images` at 0, the Publication still
  Enabled with `lastSyncedAt: null`, `meta.lastSyncAt` gone and a saved
  Retention value untouched. "Reset app" asked its confirm, deleted the
  database and reloaded; the next load found 0 publications, 0 items and 0
  settings rows.
- Update prompt: primed a profile (cache `edicola-30ae993e`), changed a SHELL
  file and re-stamped (`edicola-58cd8624`), reloaded the same profile. The
  prompt appeared ("New version available / Reload / Later") with
  `registration.waiting` true and both caches present. Clicking "Reload"
  activated the waiting worker and reloaded: the next load had no waiting
  worker, no prompt and only `edicola-58cd8624` in `caches.keys()`. The
  temporary SHELL change was reverted and `stamp:check` is green.
- Version guard: `readVersionsBeforeStamp()` returned the pre-stamp
  `{ appVersion: "0.1.0", schemaVersion: 1 }` against the real Dexie handle
  while `meta.appVersion` already read the freshly stamped value.
  `runVersionGuard` reloaded once and refused the second time with the guard
  set. End to end: seeding `meta.appVersion = "9.9.9"` and reloading left
  `sessionStorage['edicola.versionReload'] === "1"` and `meta.appVersion`
  back at `"0.1.0"` (re-stamped by the Shell the reload picked up), with the
  self-heal watchdog untouched.

### Not verified

- **`navigator.storage.persist()` returning `true`.** Headless Chrome refuses
  without site engagement, so the card only ever showed "Not granted yet".
  The `unsupported` and `granted` labels are unit-tested but never rendered
  from a real answer.
- **The update prompt on a second tab.** `clients.claim()` fires
  `controllerchange` in every open client and `applyUpdate` reloads on it, but
  the screenshot harness drives one tab, so "all tabs reload together" is
  reasoned, not observed.
- **`localStorage` clearing by "Reset app".** The harness re-seeds
  `edicola.theme` and `edicola.lang` on every run, so the post-reset read
  cannot distinguish "cleared then re-seeded" from "never cleared". It is
  covered by a unit test with a `Storage` double.
- **The self-hosting link target.** `views/settings.js` links to
  `./README.md#self-hosting-the-proxy`. Ticket 13 must add a
  `## Self-hosting the Proxy` heading to `README.md` (that heading is exactly
  what produces the anchor) and may point it at `docs/self-hosted-proxy.md`.
  Nothing checks the anchor today.
- **`estimateRowBytes` against IndexedDB's real on-disk size.** It is an
  estimate by design; the browser's own `estimate()` is shown beside it.
