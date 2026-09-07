# 01 — Shell: an installable, offline-capable app with five empty screens

**What to build:** Opening Edicola shows a bottom tab bar (Today, Saved,
Publications, Settings) and hash routes `#/`, `#/saved`, `#/publications`,
`#/settings`, plus `#/item/:id` for the Reader, each rendering a placeholder
screen with a localized title. Settings has a working theme toggle
(system/light/dark) and Language toggle (en/it). The app is installable and,
after one online load, opens and navigates with the network off. CI is green
on all four gates.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Owns:** `index.html`, `manifest.webmanifest`, `icon.svg`, `sw.js`,
`src/styles.css`, `src/render.js`, `src/state.js`, `src/i18n.js`,
`src/router.js`, `src/main.js`, `src/views/*.js` (placeholder screens),
`src/globals.d.ts`, `test/imports.test.js`, `test/i18n.test.js`,
`tools/screenshot.mjs`, `README.md` (a short stub).

- [ ] `index.html` mirrors SkyHue's: inline pre-paint theme and lang scripts (`edicola.theme`, `edicola.lang` in localStorage), manifest and icon links, boot watchdog (self-heal on failed boot), service worker registration with `updateViaCache: 'none'`. Fallback copy in the HTML is Italian; `data-i18n` attributes translate it.
- [ ] `src/render.js` is the single lit-html choke point (esm.sh, pinned 3.2.1, same reason as SkyHue: shared core across directives). Exports `html`, `render`, `nothing`, `unsafeHTML`, `repeat`.
- [ ] `src/state.js`: single mutable `state`, `update(patch)` merges and notifies, `subscribe(fn)`; `render` is the sole subscriber wired in `main.js`.
- [ ] `src/i18n.js`: `t(key)`, `setLang`, `getLang`, `en` and `it` dictionaries, `applyStaticI18n()` for `data-i18n` / `data-i18n-aria` / `data-i18n-ph` attributes. Dates via `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` helpers `formatDate`, `formatRelative` taking the current Language.
- [ ] `src/router.js`: hash routing to the five screens; the Reader route hides the tab bar and shows a back control.
- [ ] `src/styles.css`: token layer on `:root` and `:root[data-theme='light']`, no theme-scoped component rules (see CLAUDE.md). Primitives: `.tabbar`, `.screen`, `.card`, `.chip`, `.btn`, `.toast`. Typeface: system stack, no bundled fonts for now.
- [ ] `sw.js`: `CACHE` stamped by `npm run stamp`, `SHELL` array with every shipped file, install/activate as SkyHue, cache-first for `esm.sh`, stale-while-revalidate for same-origin Shell, **no interception of any other origin** (ADR-0007).
- [ ] `manifest.webmanifest`: name Edicola, standalone, `icon.svg` maskable.
- [ ] `tools/screenshot.mjs`: a reusable CDP script from the recipe in CLAUDE.md: `node tools/screenshot.mjs <url> <out.png> [--theme light|dark] [--lang en|it] [--width 390 --height 844]`. Uses a throwaway profile under `/tmp`. Document usage at the top of the file.
- [ ] Screenshots of Today and Settings in both themes and both Languages taken with it and checked for sanity (not committed).
- [ ] `test/imports.test.js` runs `checkImports()` from `tools/check-imports.mjs` and asserts zero problems. `test/i18n.test.js` asserts every key in `en` exists in `it` and vice versa.
- [ ] Offline verified: load once with the local server up, stop the server, reload in the same profile, app renders and navigates.
- [ ] All four gates green, `npm run stamp` run, `README.md` stub says what Edicola is and how to run it.
