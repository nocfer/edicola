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

## The four gates

All four must exit 0 before you commit, and CI runs exactly these.

```
npm test                                    # node --test, installs jsdom etc. on demand
npx -y @biomejs/biome@2 format --write .    # then:
npx -y @biomejs/biome@2 ci .                # lint AND format; warnings are OK
npm run typecheck                           # tsc --checkJs, lenient
npm run stamp:check                         # sw.js CACHE matches the Shell files
```

`npm run ci:local` chains them in CI order. `npm run install:hooks`
installs `tools/pre-push.sh` as a pre-push hook so you cannot push a red tree
by accident; do it once per clone.

Two of these fail in ways that are not obvious:

- **`stamp:check`** compares `CACHE` in `sw.js` against a hash of the files
  listed in `SHELL`. After any change to a Shell file, run `npm run stamp`. If
  you add or remove a Shell file, edit `SHELL` first, then stamp. A stale stamp
  means readers keep an old app. **Format before you stamp.** `biome format
  --write` rewrites Shell files, so a stamp taken first is stale again by the
  time you reach `stamp:check`, and the two gates fail each other in turn.
- **`typecheck`** is what stands between you and a blank deployed page. A
  committed module once imported a named export nothing provided, ES module
  linking threw, and the whole app showed nothing. `node --check` cannot see
  that (one file, no cross-module linking) and there is no bundler to catch it;
  `tsc --checkJs` reports it as `TS2305: Module '"./x.js"' has no exported
  member 'y'`. It covers `src/`, which is what ships. A broken import under
  `test/` fails `npm test` on load instead. This is also why the codebase uses
  **only named imports and named exports** — no default exports, no namespace
  imports, no re-exports.

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
- **An animation that crosses a route captures its origin before the route
  changes.** Opening the Story unmounts Today, so the ring the panel grows out
  of no longer exists by the time the panel does. `tapRing()` measures it and
  stashes the `DOMRect` before `navigate`; `growFrom` takes a rect as happily
  as an Element. If you animate from one screen into another, measure on the
  outgoing screen or you are measuring nothing.
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
rather than sitting empty in somebody's Today. It also **measures how much
Article each Feed carries** and fails when `truncated` contradicts it. That flag
became load-bearing with ADR-0013, and the Publications screen turns it into
"full text fetched from the site" in front of the reader, so a wrong value is
both a wrong sentence and a missed Article — hdblog was marked Summary-only
while syndicating full text, and its Originals sit behind a bot check, so its
readers got nothing. Only unambiguous drift fails: a Feed whose median Item is
a little under the floor (il Giorno sits near 180 words against 200) is
genuinely borderline, and a weekly job that opens an issue over twenty words
teaches everyone to close it unread. It needs the test DOM: run
`npm test` (or `node tools/ensure-test-deps.mjs`) at least once first, otherwise
it says so and falls back to checking the root element only.

The same command runs every Monday in `.github/workflows/catalog-health.yml`
and opens a `needs-triage` issue when a Feed dies. Fixing one means finding the
publisher's new advertised Feed, or removing the entry and adding it to the
omissions table in `docs/catalog.md` with what you saw.

## An Article has two sources

The body the Feed carried, or Extraction of the Original
([ADR-0013](docs/adr/0013-the-feed-body-is-an-article-source.md)). Fourteen of
the thirty Catalog Publications syndicate the whole Article — 200 to 1168 words
in `content:encoded`, Atom `content`, or a `description` that is not a summary
at all — so Sync tries that body first and fetches the Original only when it
misses the same `MIN_ARTICLE_WORDS` floor Extraction has to clear.

Four things about it are easy to get wrong:

1. **Readability is not run on a Feed body.** Its job is finding the article
   inside a page of navigation, and a syndicated body is already only the
   article. The same `ARTICLE_PURIFY_CONFIG` is still applied, and that config
   is now load-bearing for two inputs: loosening it for one publisher's markup
   loosens it for every extracted Original too.
2. **Both sources share one budget.** The choice happens inside
   `prefetchArticle`, on a queue already capped at `prefetchPerPublication` and
   already age-filtered. A draft that stored Feed Articles during the Feed
   phase gave each Publication its cap twice over, which is the same shape as
   the bug that once made the whole Retention card decorative.
3. **A Feed body needs the cleanup Readability would have done.** A publisher
   appends to its syndicated body what its own page never shows, so
   `dropFeedFooter` removes an unrendered `[gallery …]` shortcode and the
   short, linked run of blocks after the Article's last `<hr>` — HDblog closes
   every Item with a rotating affiliate advert and a "CLICCA QUI PER CONTINUARE
   A LEGGERE" link, which the Reader's own footer already offers. Its
   thresholds were measured over the whole Catalog rather than chosen: Galileo
   and openDemocracy use a rule *inside* the Article and carry 200 to 465 words
   after the last one, so a footer is capped at 40 words and has to contain a
   link. Re-measure before touching either number. Two related cleanups sit in
   `hardenLinks` and `filterImages` instead, because both Article sources need
   them: an anchor whose only content is an undescribed image has no accessible
   name by any route and is unwrapped, and an image the publisher never
   described gets `alt=""` rather than no attribute at all.
4. **`truncated` is not consulted.** It is hand-maintained Catalog metadata and
   it was wrong in both directions — hdblog was marked Summary-only while
   carrying full text, which is why its Originals being behind a bot check cost
   readers Articles the publisher had already syndicated. The body in front of
   the pipeline is a fact; the flag is a claim. It stays as documentation and
   as something the Publications screen shows.

## Product QA against the live web

Every gate above runs against fixtures. None of them says whether a reader who
switches on La Stampa this morning gets Articles. `tools/qa-run.mjs` answers
that: it walks the Catalog one Publication at a time, enables it, Syncs only
it, asks IndexedDB what arrived, and photographs Today in both View Modes and
the Reader on one Article.

```
npm start                                   # it drives the real app, so serve it
npm run qa                                  # every Publication
node tools/qa-run.mjs --only open --no-shots
node tools/qa-run.mjs --no-shots --write-baseline
```

It adds nothing to the app to be testable. The page serves ES modules over
HTTP, so an evaluated expression can `import('/src/sync-client.js')` and call
the real Sync through the real fetcher — there is no QA-only code path, and
nothing is stashed on `window`.

**The run brings its own Proxy.** Direct fetches are CORS-blocked by design
(ADR-0001), and the shipped default relay is a shared public Worker that is
regularly rate-limited — pointed at a rate-limited relay, every Publication
fails for the same uninteresting reason and the run measures the relay instead
of the product. So `qa-run.mjs` starts one on localhost for the life of the run
(same contract as [docs/self-hosted-proxy.md](docs/self-hosted-proxy.md), no
account, no setup) and points the app at it. It is QA tooling and never a
shipped default. `--shipped-proxy` uses whatever the app is configured with
instead, which is how you check the shipped default is still alive; `--proxy
'<template>'` names your own.

**A run has two halves, and they must not be confused.** The mechanical half is
`tools/qa-checks.js` — a duplicated hero image, a control with no accessible
name, an i18n key rendered instead of its translation — tested in
`test/qa-checks.test.js` and free to re-run. The other half is judgement, from
the screenshots: does the crop make sense, does this read like an article, is
the Summary-only copy honest. Judgement over thirty Publications is expensive
and its standards drift between runs, so **when a judgement finding shows up
twice, write the check and stop paying for it.**

**A Publication is scored on the Articles Sync attempted**, not on every Item
it stored. Retention caps the prefetch at ten per Publication, and Pre-fetch
skips Items older than `maxAgeDays` because Eviction deletes those at the end
of the same run, so a Feed with thirty Items always has a tail nothing touched:
ANSA reads 9/28 scored that way and 9/10 scored honestly, and only one of those
numbers is about ANSA. A Publication that stores Items and reports no error but
ends up empty has usually hit the age rule — Wired Italia's whole Feed is about
seventy days old — and the run says so in its `no-items` finding.

**`test/qa-baseline.json` is what makes this a regression test.** The corpus is
live news, so two runs differ because the news differs, and an absolute rate
means nothing on its own: la Repubblica is paywalled and measures about 30%,
almost all of the rest `too-short`, which is correct under ADR-0004 rather than
a bug. The baseline records the expected rate per Publication and the run
reports the delta against it. Without it every run re-argues the same thirty
questions. Re-record it with `--write-baseline` when a rate moves for a reason
you have checked, and say so in the pull request.

**The empty and error states are a separate, repeatable suite.**
`tools/qa-scenarios.mjs` seeds IndexedDB directly and opens the screen, so a
state that depends on a database shape rather than a route can be checked the
same way twice:

```
npm start
npm run qa:scenarios
node tools/qa-scenarios.mjs --theme light --lang it --only all-failed
```

Each scenario declares the rows it wants, the route, and the **i18n key** whose
copy must appear — resolved through the app's own dictionary, so renaming a key
fails the scenario instead of silently passing against a hardcoded English
string, and the Italian run really asserts Italian. It also runs
`checkRendered` on every screen, which is how the mechanical checks reach the
empty states a live run never produces. No publisher is contacted; the one
scenario that needs an Original points at a paywall-teaser fixture served by
`npm start`, so the real on-demand Extraction runs and lands on `too-short`
every time. Add a scenario whenever you add a state — that is cheaper than
reaching it by hand once.

It runs in `.github/workflows/ui-scenarios.yml` on push, in both themes and
both Languages, and is deliberately **not** in `ci.yml`: the app loads lit and
Dexie from esm.sh at runtime, so this job is not hermetic and an esm.sh outage
would fail unrelated changes.

**Every check must stay quiet on healthy content**, and the corpus at the end
of `test/qa-checks.test.js` is what enforces it. Four checks failed that bar
after shipping — one fired on the Italian words "nulla" and "annullato", one
called 595 words against 599 a loss, one conflated a failed Feed with an empty
one, and one fired on 27 of 27 healthy Articles. The corpus runs the checks
over known-good content and asserts silence, including against real captured
app markup:

```
node tools/qa-run.mjs --only open --capture-dom test/fixtures/screens
```

Refresh those fixtures when a template changes; never hand-edit them, because
their whole value is being what the app really emits. A check that cannot pass
the corpus does not belong in the file.

`tools/qa-diagnose.mjs` explains one failure. Node has no CORS, so it fetches
the same Original directly and runs the same `extractArticle` over it, and the
two answers together name the layer at fault:

```
node tools/qa-diagnose.mjs --publication open        # its failing sample from the last run
node tools/qa-diagnose.mjs <url> --save <name>       # keep the HTML as a fixture
```

| here | verdict |
| --- | --- |
| the fetch fails too | the site refuses everyone; Summary-only is honest |
| extraction works | transport — the Proxy or CORS, not Extraction |
| `too-short` on a real article | a paywall teaser; ADR-0004 says we stop |
| `no-content` | Readability found no prose on a page that loaded: ours to fix |

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
