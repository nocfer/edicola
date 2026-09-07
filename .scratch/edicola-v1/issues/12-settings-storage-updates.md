# 12 — Settings: Proxy, Retention, storage, and safe updates

**What to build:** The Settings tab exposes Language, theme, the Proxy URL
(default shown, override editable, "test" button), Retention limits, storage
usage with a clear button, and the app version. A new version is announced
with an update prompt and applied on confirmation; a Shell older than the
database forces a reload (ADR-0008).

**Blocked by:** 07 (db/meta), 08 (Settings layout shares Language/Nation
copy).

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
