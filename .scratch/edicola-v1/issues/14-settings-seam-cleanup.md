# 14 — Collapse the two ways to read a setting

**What to build:** One settings layer. Tickets 08 and 12 ran in parallel and
each grew its own: `src/catalog.js` carries a stopgap pair of helpers over the
`settings` table, and `src/settings.js` is the real typed store. Both work
today, which is exactly why this needs doing before a third screen picks the
wrong one.

**Blocked by:** nothing. Verified on `main`: `src/catalog.js` is imported by
`src/views/publications.js` alone, and ticket 10 (the Reader, running in
parallel) has been told not to import it and not to touch your three files.

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
