# 12 — Settings: Proxy, Retention, storage, and safe updates

**What to build:** The Settings tab exposes Language, theme, the Proxy URL
(default shown, override editable, "test" button), Retention limits, storage
usage with a clear button, and the app version. A new version is announced
with an update prompt and applied on confirmation; a Shell older than the
database forces a reload (ADR-0008).

**Blocked by:** 07 (db/meta) — merged. Ticket 08 runs **in parallel** with
this one; its only overlap is shared copy, so do not wait for it and do not
read its files.

**Status:** ready-for-agent

**Owns:** `src/views/settings.js`, `src/settings.js` (typed get/set over the
`settings` table with `DEFAULT_RETENTION` defaults), `src/update.js` (service
worker update prompt and version guard), `src/storage-usage.js`,
`test/settings.test.js`, strings under `settings.*`, styles under
`/* Settings */`. May edit `index.html` and `sw.js` for the update flow
(`skipWaiting` on message), and `db.js` to stamp `appVersion` in `meta`
during `on('ready')`.

- [ ] Proxy: shows the default template and service name, an input for a custom template containing `{url}`, validation, and a "Test" button that fetches a known Feed through it and reports the fetcher's `kind` on failure. Link to the README section on self-hosting (ticket 13 writes it; link to the anchor now).
- [ ] Retention: days kept, total size cap, per-Article image cap, Items per Publication, Pre-fetch per Publication; each with the default from `DEFAULT_RETENTION` and sane bounds; saving triggers Eviction if limits shrank.
- [ ] Storage: `navigator.storage.estimate()` plus a per-table byte count; whether persistent storage was granted; "Clear all content" (keeps Enabled Publications and settings) and "Reset app" (everything), each behind a confirm.
- [ ] Update prompt: detect `registration.waiting`, show a toast "New version available — Reload"; on confirm post `skipWaiting` to the worker and reload on `controllerchange`. Replace SkyHue's auto-reload behaviour from ticket 01 with this.
- [ ] Version guard: `APP_VERSION` constant stamped into `meta.appVersion` on db ready; if the running Shell's version is older than the stored one, unregister nothing, just `location.reload()` once (sessionStorage guard) to pick up the newer Shell. Migrations are additive only; add a comment block in `db.js` saying so with the ADR number.
- [ ] Settings model functions (defaults, bounds, template validation) are pure and unit tested.
- [ ] CDP screenshots in both themes and Languages.
- [ ] Gates green, stamp run.

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
