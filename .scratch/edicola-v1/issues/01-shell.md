# 01 — Shell: an installable, offline-capable app with five empty screens

**What to build:** Opening Edicola shows a bottom tab bar (Today, Saved,
Publications, Settings) and hash routes `#/`, `#/saved`, `#/publications`,
`#/settings`, plus `#/item/:id` for the Reader, each rendering a placeholder
screen with a localized title. Settings has a working theme toggle
(system/light/dark) and Language toggle (en/it). The app is installable and,
after one online load, opens and navigates with the network off. CI is green
on all four gates.

**Blocked by:** None — can start immediately.

**Status:** done

**Owns:** `index.html`, `manifest.webmanifest`, `icon.svg`, `sw.js`,
`src/styles.css`, `src/render.js`, `src/state.js`, `src/i18n.js`,
`src/router.js`, `src/main.js`, `src/views/*.js` (placeholder screens),
`src/globals.d.ts`, `test/imports.test.js`, `test/i18n.test.js`,
`tools/screenshot.mjs`, `README.md` (a short stub).

- [x] `index.html` mirrors SkyHue's: inline pre-paint theme and lang scripts (`edicola.theme`, `edicola.lang` in localStorage), manifest and icon links, boot watchdog (self-heal on failed boot), service worker registration with `updateViaCache: 'none'`. Fallback copy in the HTML is Italian; `data-i18n` attributes translate it.
- [x] `src/render.js` is the single lit-html choke point (esm.sh, pinned 3.2.1, same reason as SkyHue: shared core across directives). Exports `html`, `render`, `nothing`, `unsafeHTML`, `repeat`.
- [x] `src/state.js`: single mutable `state`, `update(patch)` merges and notifies, `subscribe(fn)`; `render` is the sole subscriber wired in `main.js`.
- [x] `src/i18n.js`: `t(key)`, `setLang`, `getLang`, `en` and `it` dictionaries, `applyStaticI18n()` for `data-i18n` / `data-i18n-aria` / `data-i18n-ph` attributes. Dates via `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` helpers `formatDate`, `formatRelative` taking the current Language.
- [x] `src/router.js`: hash routing to the five screens; the Reader route hides the tab bar and shows a back control.
- [x] `src/styles.css`: token layer on `:root` and `:root[data-theme='light']`, no theme-scoped component rules (see CLAUDE.md). Primitives: `.tabbar`, `.screen`, `.card`, `.chip`, `.btn`, `.toast`. Typeface: system stack, no bundled fonts for now.
- [x] `sw.js`: `CACHE` stamped by `npm run stamp`, `SHELL` array with every shipped file, install/activate as SkyHue, cache-first for `esm.sh`, stale-while-revalidate for same-origin Shell, **no interception of any other origin** (ADR-0007).
- [x] `manifest.webmanifest`: name Edicola, standalone, `icon.svg` maskable.
- [x] `tools/screenshot.mjs`: a reusable CDP script from the recipe in CLAUDE.md: `node tools/screenshot.mjs <url> <out.png> [--theme light|dark] [--lang en|it] [--width 390 --height 844]`. Uses a throwaway profile under `/tmp`. Document usage at the top of the file.
- [x] Screenshots of Today and Settings in both themes and both Languages taken with it and checked for sanity (not committed).
- [x] `test/imports.test.js` runs `checkImports()` from `tools/check-imports.mjs` and asserts zero problems. `test/i18n.test.js` asserts every key in `en` exists in `it` and vice versa.
- [x] Offline verified: load once with the local server up, stop the server, reload in the same profile, app renders and navigates.
- [x] All four gates green, `npm run stamp` run, `README.md` stub says what Edicola is and how to run it.

## Notes

### Files that must be in `SHELL` (all present in `sw.js`)

`./`, `./index.html`, `./manifest.webmanifest`, `./icon.svg`,
`./src/styles.css`, `./src/main.js`, `./src/render.js`, `./src/state.js`,
`./src/i18n.js`, `./src/router.js`, `./src/views/layout.js`,
`./src/views/today.js`, `./src/views/saved.js`, `./src/views/publications.js`,
`./src/views/settings.js`, `./src/views/reader.js`, `./src/views/not-found.js`.
Add any new shipped file to `SHELL` and run `npm run stamp`; `stamp:check`
hashes the SHELL files (not `sw.js` itself).

### Exported interfaces

**`src/render.js`** — `html`, `render`, `nothing`, `unsafeHTML`, `repeat`
(lit-html 3.2.1 from esm.sh). Never import the CDN URL elsewhere.

**`src/state.js`**
- `state: State` — `{ route: Route, theme: 'system'|'light'|'dark', lang: 'en'|'it', online: boolean, toast: string|null }`. Later tickets add fields to this object and to the `State` typedef.
- `update(patch?)` — merges and notifies; bare `update()` redraws after an in-place mutation.
- `subscribe(fn)` → unsubscribe. `renderApp` in `main.js` is the only subscriber; do not add others, put reactions in the render.
- `showToast(message, duration = 2500)` — sets `state.toast`, cleared automatically; rendered by `main.js` as `.toast`.
- Never touches `document`/`localStorage` at import time (Node-importable).

**`src/router.js`**
- `Route` typedef: `{ name: 'today'|'saved'|'publications'|'settings'|'reader'|'not-found', params: { id? }, path }`.
- `TABS` — `['today','saved','publications','settings']` in display order.
- `parseRoute(hash)` — pure; `''`/`#/` → today, `#/item/:id` → reader with the id percent-decoded, unknown → `not-found`.
- `pathFor(name, params)`, `hrefFor(name, params)` — build `#/…` links (`hrefFor('reader', { id })` encodes the id). Use these in templates instead of hand-written hashes.
- `navigate(name, params)` — sets `location.hash`.
- `goBack()` — `history.back()` when the reader arrived from inside the app, else `navigate('today')`. The Reader's back button calls it.
- `currentRoute()`, `isTabRoute(route)`, `hidesTabBar(route)` (true only for `reader`).
- `startRouter(onChange)` — calls `onChange` once immediately and on every `hashchange`; `main.js` wires it to `update({ route })`.

**`src/i18n.js`**
- `en`, `it`, `DICTIONARIES = { en, it }`, `LANGS`, `LOCALES = { en: 'en-GB', it: 'it-IT' }`, `LANG_KEY = 'edicola.lang'`.
- `initLang()` (saved key, else browser: `it*` → it, else en), `getLang()`, `setLang(l)` (persists; unknown → en).
- `t(key, params?)` — falls back to `en`, then to the key; `{name}` interpolation.
- `applyStaticI18n(root = document)` — `data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-aria`.
- `formatDate(value, options = { dateStyle: 'medium' })`, `formatRelative(value, now = Date.now())` ("yesterday"/"ieri", "3 hours ago", "now").
- Key convention: `<screen>.<thing>`; shared chrome under `app.*` and `nav.*`. Every key in both tables (test enforces). Placeholder keys created here that screen tickets will extend or replace: `today.title/placeholder/choosePublications`, `saved.title/placeholder`, `pubs.title/placeholder`, `settings.title/appearance/theme/theme.{system,light,dark}/language/language.{en,it}`, `reader.title/back/placeholder`, `notFound.*`.

**`src/views/layout.js`** — `screenHeader(state, title, leading = nothing)` (title row with an Offline chip when `!state.online`) and `emptyState(text, action = nothing)`.

**Views** — each `src/views/<screen>.js` exports `<screen>View(state)` returning a lit template wrapped in `<section class="screen">` (`screen--reader` for the Reader). `main.js` maps route names to views in `SCREENS`; a new screen is a new entry there plus a router path.

### Conventions later screens must follow

- Views only write to the store (`update(...)`); side effects of a state change (theme attribute + `edicola.theme` persistence, `<html lang>`, `applyStaticI18n`, tab bar visibility and `aria-current`, scroll-to-top on path change, `theme-color` meta) live in `renderApp` in `main.js`. Ticket 12 should keep the theme/Language controls calling `update({ theme })` / `update({ lang })`.
- Theme preference is stored as `edicola.theme` = `'light'|'dark'`, or **absent** for "system" (the pre-paint script and `main.js` both treat anything else as system). `state.theme` holds the preference; `document.documentElement.dataset.theme` holds the resolved value the CSS keys on.
- Tab bar is static markup in `index.html` (Italian fallback + `data-i18n`), with `data-route` on each `<a>`; `main.js` toggles `hidden` and `aria-current`. `<main id="screen">` carries `app--with-tabbar` when the bar is visible (bottom padding).
- CSS: tokens only on `:root` and `:root[data-theme='light']`; add screen rules under a `/* <Screen> */` block using the existing tokens (`--bg --surface --card --hairline --text --muted --faint --accent --accent-ink --link --chip-bg`, spacing `--s-1..--s-8`, radii `--r-pill --r-control --r-card`, fonts `--font-ui --font-display --font-mono`).
- `index.html` posts `{ type: 'warm-cdn', urls }` to the active worker after `load` + `ready` with the esm.sh URLs the page loaded; `sw.js` caches any it misses. This is what makes "offline after one online load" independent of the HTTP cache. New CDN choke points (Dexie, Readability, DOMPurify via esm.sh) are covered automatically as long as they load during page load; a module imported lazily later is cached by the cache-first fetch handler on first use.
- `sw.js` still `skipWaiting()`s on install and `index.html` auto-reloads on `controllerchange`; ticket 12 replaces this with the update prompt (ADR-0008).
- Screenshots: `node tools/screenshot.mjs <url> <out.png> [--theme light|dark] [--lang en|it] [--width --height --scale --wait --profile <dir> --eval "<js>"]`. `--profile` reuses a Chrome profile (offline test: prime, stop the server, run again); `--eval` prints the awaited result of an expression to stderr, handy for asserting DOM state. Console errors and uncaught exceptions are echoed.

### Decisions the spec left open

- English is the fallback dictionary and the default Language when the browser is not Italian (ADR-0006 says infer from locale; the HTML fallback copy is Italian as the ticket requires).
- `LOCALES.en` is `en-GB` because the seed English Nation is the UK.
- Dark is the default token set on bare `:root`; the pre-paint script always sets `data-theme`, so bare `:root` is only seen if that script fails.
- Route change scrolls to top; ticket 10's Today scroll restoration will refine this.
- A `not-found` route with its own screen for unknown hashes (tab bar stays visible).
- Chip labels for Language show each language's own name ("English", "Italiano") in both dictionaries.

### Verified

- Screenshots (not committed) of Today and Settings in dark/light × en/it and of the Reader; toggles exercised by clicking through CDP (`data-theme`, `<html lang>`, localStorage, tab labels, `theme-color` meta all follow).
- Offline: fresh profile primed once (cache held 17 Shell entries + 8 esm.sh modules), server stopped, reload of `#/settings` booted and navigation to `#/saved` rendered. Only console line is the expected `reg.update()` warning because `sw.js` cannot be re-fetched offline.
- Not verified: installability prompt on a real device (manifest served as `application/manifest+json` by the Python server and links are in place), and `env(safe-area-inset-*)` on a notched phone.
