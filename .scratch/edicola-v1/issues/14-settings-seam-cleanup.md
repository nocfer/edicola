# 14 — Collapse the two ways to read a setting

**What to build:** One settings layer. Tickets 08 and 12 ran in parallel and
each grew its own: `src/catalog.js` carries a stopgap pair of helpers over the
`settings` table, and `src/settings.js` is the real typed store. Both work
today, which is exactly why this needs doing before a third screen picks the
wrong one.

**Blocked by:** 09, 10, 11 — anything that might import from `src/catalog.js`.
Do this when no screen ticket is in flight.

**Status:** ready-for-agent

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

- [ ] `src/catalog.js` exports no settings helper and keeps only Catalog
      concerns: merging, grouping, inference, and the Publication row writes.
- [ ] Language is read and written in one place. Note that `src/i18n.js` also
      keeps the Language in `localStorage` for the pre-paint script in
      `index.html`; the database copy and the `localStorage` copy must not
      disagree. Decide which is authoritative, write it down, and make the
      other follow.
- [ ] Nothing imports a settings helper from `src/catalog.js`; grep to prove it.
- [ ] Existing tests still pass unchanged where they test behaviour rather than
      the helper names. Update only the tests that named the deleted functions.
- [ ] All five gates green.
