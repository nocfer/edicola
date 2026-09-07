# Working agreement for agents on Edicola tickets

Read first: `CLAUDE.md`, `CONTEXT.md`, the ADRs in `docs/adr/`, `spec.md` in
this folder, and your ticket file. Use the glossary's terms in code, tests and
commits.

## Scope discipline

- Build only what your ticket says. Each ticket lists the files it **owns**.
  Create and edit those; do not touch files owned by another ticket. Tickets run
  in parallel on separate branches and are merged afterwards, so an edit outside
  your ownership list is a merge conflict for someone else.
- Never edit `package.json`, `biome.json`, `jsconfig.json`, `.github/`, or
  `tools/` unless your ticket owns them.
- Only ticket 01 creates or edits `index.html`, `sw.js`, `manifest.webmanifest`,
  `src/styles.css`, `src/render.js`, `src/state.js`, `src/i18n.js`, `src/main.js`.
  Later tickets extend them once merged.
- If you need something another ticket owns, write against the interface
  described in that ticket and stub it in your tests. Do not create the file.

## Code rules (from CLAUDE.md, repeated because they matter)

- No build step. Plain ES modules, named imports and named exports only.
- CDN libraries only through the designated choke point files, pinned to the
  versions in `tools/ensure-test-deps.mjs`. Modules that must be testable in
  Node take their DOM, Readability, DOMPurify, fetch and store as parameters.
- DOMPurify on all third-party HTML before storage or render.
- Everything in the codebase is English. Italian only in the `it` dictionary.
- JSDoc types on exported functions; `checkJs` runs in CI.

## Tests

- `npm test` runs `node --test` after installing jsdom, Readability and
  DOMPurify on demand. Helpers live in `tools/testing/dom.js`, not under
  `test/` (Node runs everything under `test/` as a test file).
- Fixtures are real documents under `test/fixtures/<area>/`. Fetch real feeds
  and pages with `curl` where the network allows; trim them but keep them
  real. Name each fixture for what it exercises.
- Tests assert external behaviour at the seam, never internals.

## Gates before you commit

```
npm test ; echo $?                       # 0
npx -y @biomejs/biome@2 format --write . && npx -y @biomejs/biome@2 ci . ; echo $?   # 0
npm run typecheck ; echo $?              # 0
node tools/check-imports.mjs ; echo $?   # 0
```

`npm run stamp:check` applies only once `sw.js` exists (ticket 01 and later);
if it is present in your branch, run `npm run stamp` after any Shell change.

## Finishing

- Commit on your branch with a clear message. Do not push. Do not merge.
- Update your ticket file: tick the acceptance criteria you met, set
  `Status: done`, and add a `## Notes` section with anything the integrator
  must know: new files that must be added to the `SHELL` array in `sw.js`,
  interfaces you exported, decisions you made that the spec left open,
  anything you could not verify.
- Your final message is the only thing the coordinator reads. Lead with what
  works and what does not, list the files you created, and name the exported
  interfaces.
