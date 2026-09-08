# Contributing to Edicola

Edicola is a no-build, no-backend PWA: plain HTML, CSS and ES modules served
statically, with everything the reader keeps in one IndexedDB database. What is
deployed is exactly what is committed, so most of the rules below exist to
replace the safety net a bundler and a test pipeline would otherwise give us.

Adding a Publication to the Catalog needs no JavaScript at all. If that is why
you are here, skip to [The Catalog](#the-catalog).

## Read these first

- [CONTEXT.md](CONTEXT.md) is the vocabulary. Publication, Catalog, Nation,
  Item, Summary, Article, Extraction, Sync, Pre-fetch, Retention, Eviction,
  Shell: each has one name, and that name is used in code, tests, commit
  messages and issues. The glossary also lists the words to avoid, which is the
  half people skip. "Feed" is not "channel", an Item is not an "article", and
  the Shell is not "the bundle".
- [docs/adr/](docs/adr/) records every architectural decision, with the options
  that were rejected and why. Read the ADRs that touch what you are changing.
  If your change contradicts one, say so in the pull request and propose a new
  ADR rather than quietly overriding it. Ten decisions are recorded; the ones
  that bite most often are ADR-0001 (no backend), ADR-0002 (no build),
  ADR-0004 (Extraction is reader mode, never paywall circumvention) and
  ADR-0009 (nothing leaves the device).
- [CLAUDE.md](CLAUDE.md) is the working notes: commands, architecture, and a
  list of gotchas inherited from [SkyHue](https://github.com/nocfer/skyhue),
  which is this project's reference implementation for conventions.

## The five gates

All five must exit 0 before you commit. CI runs four of them; `check-imports`
also runs inside `npm test`, so a red gate there fails the build too.

```
npm test                                    # node --test, installs jsdom etc. on demand
npx -y @biomejs/biome@2 format --write .    # then:
npx -y @biomejs/biome@2 ci .                # lint AND format; warnings are OK
npm run typecheck                           # tsc --checkJs, lenient
node tools/check-imports.mjs                # every relative named import resolves
npm run stamp:check                         # sw.js CACHE matches the Shell files
```

`npm run ci:local` chains the first four in CI order. `npm run install:hooks`
installs `tools/pre-push.sh` as a pre-push hook so you cannot push a red tree
by accident; do it once per clone.

Two of these fail in ways that are not obvious:

- **`stamp:check`** compares `CACHE` in `sw.js` against a hash of the files
  listed in `SHELL`. After any change to a Shell file, run `npm run stamp`. If
  you add or remove a Shell file, edit `SHELL` first, then stamp. A stale stamp
  means readers keep an old app. **Format before you stamp.** `biome format
  --write` rewrites Shell files, so a stamp taken first is stale again by the
  time you reach `stamp:check`, and the two gates fail each other in turn.
- **`check-imports`** exists because a committed module once imported a named
  export nothing provided, ES module linking threw, and the whole deployed app
  showed a blank page. `node --check` cannot see that, and there is no bundler
  to catch it. This is also why the codebase uses **only named imports and
  named exports** — no default exports, no namespace imports, no re-exports.
  Keeping that true is what keeps the check sound.

## Rules that are not negotiable

- **No build step, no committed `node_modules`, no framework.** Dev tools run
  through `npx` on demand.
- **Runtime libraries come from esm.sh, pinned, through one choke point each:**
  lit-html via `src/render.js`, Dexie via `src/db.js`, Readability and DOMPurify
  via `src/extract.js`. A CDN URL anywhere else is a bug. Bump a version in the
  choke point and in `tools/ensure-test-deps.mjs` together, or the browser and
  the tests are running different libraries.
- **DOMPurify runs on every piece of third-party HTML** before it is stored and
  before it is rendered, Summaries included. Feeds and Originals are untrusted
  input from arbitrary sites; a skipped sanitizer is a stored XSS in every
  reader's database.
- **All content network access goes through `src/fetcher.js`** (direct first,
  then the configured Proxy). Nothing else calls `fetch` for a Feed, an
  Original or an image.
- **Modules that must run under Node take their dependencies as parameters** —
  DOM, `DOMParser`, Readability, DOMPurify, `fetch`, the store, `now`. That is
  what makes the pipeline testable without a browser, and it is not optional
  for new code in `src/`.
- **The codebase is English.** Code, comments, commit messages, test names,
  Catalog notes. The only Italian is user-facing copy: the `it` dictionary in
  `src/i18n.js` and the fallback text in `index.html`. Every key must exist in
  both dictionaries; a test asserts parity.
- **JSDoc types on exported functions.** `checkJs` runs in CI. For a
  `querySelector` result, use the repo idiom
  `/** @type {HTMLElement} */ (el)` in a plain statement, never mid-expression:
  Biome's formatter relocates a cast written inline and the type is lost.
- **Theming changes tokens, not rules.** The only theme-scoped selector is the
  token block. No raw colour, space, radius or font literal where a token
  exists.
- **Durations and easings are tokens; JS reads them through `src/motion.js`,
  never as literals.** The Motion group in §1 of `styles.css` is where a
  duration or a curve is written, once; `motionToken(name)` reads it back, so a
  WAAPI animation and the CSS transition of the same thing cannot disagree.
  **Every WAAPI animation takes an explicit reduced-motion branch.** The
  `prefers-reduced-motion` block zeroes `transition-duration`, which covers CSS
  transitions and nothing else — `el.animate()` ignores that rule entirely, so
  ask `prefersReducedMotion()` in JS and verify by forcing the query on rather
  than by trusting the reset. A redraw that should cross-dissolve rather than
  cut goes through `withViewTransition(mutate)` from the same module: `update()`
  notifies inline and lit commits inline, so wrapping the write wraps the whole
  redraw, and it skips the transition under reduced motion because the
  `::view-transition` pseudo tree is a UA animation the reset does not reach.
  No motion library: the reasoning, and the four candidates that were weighed,
  are in
  [ADR-0012](docs/adr/0012-motion-is-three-platform-primitives-not-a-library.md).
- **Every write that should redraw goes through `update()`** in
  `src/state.js`. One mutable store, one subscriber (`render`).

## Tests and fixtures

Tests exercise external behaviour at a seam and should survive an internal
rewrite: given this Feed document, these Items come out; given this Original,
this Article comes out or the Item stays Summary-only; given these Item records
and these limits, these ids are Evicted. Do not assert on internal structure,
DOM class names or call order.

`npm test` runs `node --test` over everything in `test/`, after
`tools/ensure-test-deps.mjs` installs jsdom, Readability and DOMPurify into a
gitignored `node_modules` with `--no-save`. They are never a `package.json`
dependency (ADR-0010). Test helpers live in `tools/testing/`, not in `test/`,
because Node treats every file under `test/` as a test file.

**Fixtures come before fixes.** A parser or Extraction bug found in the wild
becomes a real document in `test/fixtures/<area>/` first, then gets fixed.
Fetch the document with `curl`, trim it if it is huge, but keep it real —
minimal hand-written XML does not reproduce what publishers actually ship. Name
the fixture for the thing it exercises, and list it in
`test/fixtures/README.md`.

Not unit-tested, on purpose: Dexie access, the service worker, and every
screen.

## Screens are verified in a browser

A green test run says nothing about presentation. There is no browser driver
here, so screens are checked over the Chrome DevTools Protocol:

```
node tools/screenshot.mjs http://localhost:8000/#/settings out.png --theme dark --lang it
```

Screenshot any new or changed screen in both themes and both Languages.
`--viewmode list|feed` picks Today's View Mode and `--offline` cuts the network
before navigating (clearing the HTTP cache too, or a picture fetched on the
previous run makes an offline feed look online). The **Story player is the one
screen that needs a single theme**, because it is dark in both by decision
(ADR-0011) — say so when you post the shots, so the next reviewer does not read
one theme as a missed criterion. Use a
throwaway Chrome profile (`--user-data-dir=/tmp/prof`, deleted first): the
service worker serves the Shell stale-while-revalidate, so a primed profile
shows you the previous version and you will chase a bug that is not there. If a
change "does not show up", check that the static server is actually listening
before anything else.

`test/styles-structure.test.js` guards the one CSS failure that passed every
other gate: a merge once spliced a whole screen block inside
`@media (prefers-reduced-motion: reduce)`, leaving the file brace-balanced and
the Settings screen nearly unstyled. It asserts that each screen block still
has a top-level rule, that the file is brace-balanced, that the reduced-motion
reset still carries its declaration, that the `::view-transition` pseudo tree is
still retimed onto `--dur` at the top level, and that no selector has one of its
properties declared twice by non-adjacent rules. Do not delete it.

## The Catalog

`data/catalog.json` ships with the app and grows by pull request.
[docs/catalog.md](docs/catalog.md) is the contract: the entry schema, the rules,
and a table of well-known Publications that are deliberately absent, each with
the reason. The short version:

1. **Only Feeds the publisher advertises publicly** — a `<link
   rel="alternate">`, an RSS page, a footer link, a help article. No member-area
   Feeds, no unofficial mirrors, no Feeds rebuilt by a third party from the
   site's HTML. If you cannot point at where the publisher lists it, it does
   not go in.
2. **Prefer the main or front-page Feed.** A section Feed is acceptable only
   when the Publication publishes nothing broader, and the `note` must say so.
3. **One entry per Publication.**
4. **Read the Feed before opening the pull request.** `curl -sL <feedUrl> |
   head -c 3000`, check the root element, then look at a few Items: full
   Article in `content:encoded` or Atom `content` means `truncated: false`;
   only a `description` or `summary` means `truncated: true`. Write what you saw
   in `note`, in English.
5. **A new Nation needs no code change**, but say in the pull request that you
   are introducing one so the Publications screen can be checked with it.

Then run both checks:

```
node tools/check-catalog.mjs            # schema
node tools/check-catalog.mjs --fetch    # schema, plus a live fetch and parse of every Feed
```

`--fetch` requests every `feedUrl` and parses it with the app's own `parseFeed`,
so a Feed that answers 200 with a document Edicola finds no Items in fails here
rather than sitting empty in somebody's Today. It needs the test DOM: run
`npm test` (or `node tools/ensure-test-deps.mjs`) at least once first, otherwise
it says so and falls back to checking the root element only.

The same command runs every Monday in `.github/workflows/catalog-health.yml`
and opens a `needs-triage` issue when a Feed dies. Fixing one means finding the
publisher's new advertised Feed, or removing the entry and adding it to the
omissions table in `docs/catalog.md` with what you saw.

## How work is planned

Issues and specs are markdown files under `.scratch/<feature-slug>/`, not a
tracker: a `spec.md`, an `issues/` directory of numbered tickets, and
`AGENT-RULES.md` for the working agreement. A ticket names the files it owns,
what blocks it, its acceptance criteria, and once it is finished a `## Notes`
section recording the interfaces it exported, the decisions the spec left open,
and anything that could not be verified. Those Notes are the real history of
the project; read the ones for the area you are touching. Tickets are labelled
with five triage roles (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`), documented in `docs/agents/triage-labels.md`.

## Rules that cost somebody real work

These come from `.scratch/edicola-v1/AGENT-RULES.md`, where each line is the
scar of a mistake already made. They apply to humans as much as to agents.

- **Only touch the files your change is about.** Work runs in parallel on
  separate branches; an edit outside your area is a merge conflict for someone
  else. If you need something another branch owns, write against its documented
  interface and stub it in your tests.
- **Use absolute paths in scripts, `curl -o` and redirects.** One `cd` into a
  directory that did not exist yet silently failed, and ten downloads landed in
  the wrong checkout.
- **Commit as soon as the gates pass**, before optional polish. Uncommitted
  work is not work.
- **Re-run `npm run format` before `biome ci`.** `ci` includes formatting, and
  a formatting-only failure is the most annoying way to fail CI.
- **A gate now catches the plain duplicate selector, but not the specific
  one shadowing a general one.** The styles test fails a property declared
  twice for the *same* selector string by two non-adjacent rules — that is what
  the `.btn`, `.pub`, `.switch`, `.tabbar` note here used to be about, and the
  last real case is fixed. What it cannot see is `.wrap .chip` overriding
  `.chip--on` from 400 lines away, because the selectors differ; that stays a
  reading job. Keep a variant with its primitive's block so the distance never
  opens up.

## Pull requests

Say what changed and why, name the ADRs and the glossary terms involved, and
list the gates you ran. For a Catalog entry, include where the publisher
advertises the Feed (a URL) and a sentence on what its Items carry. For a change
to a screen, attach the screenshots in both themes and both Languages.

New code is MIT, like the rest of the project.
