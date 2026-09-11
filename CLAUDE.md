# CLAUDE.md — working notes for agents on Edicola

Edicola is an **offline-first, no-backend news reader PWA**. Readers toggle
Publications from a Catalog grouped by Nation, the app fetches full Articles,
and everything already fetched reads with no connection. Vocabulary lives in
`CONTEXT.md`; use those terms in code, tests, issues and commits. Every
architectural decision is recorded in `docs/adr/` — read the ones touching your
area before editing, and flag a conflict instead of silently overriding.

**The conventions are written down twice.** This file and `CONTRIBUTING.md`
describe the same gates, the same CSS rules and the same test guarantees for two
different readers, so changing one of those behaviours means editing **both** in
the same commit. Review once found `CONTRIBUTING.md` still telling contributors
to hunt duplicate CSS selectors by hand because "no gate catches this", one
commit after a gate started catching it. Grep `CONTRIBUTING.md` for whatever you
just changed here, and the reverse.

The skeleton, tooling and conventions are inherited from
[SkyHue](https://github.com/nocfer/skyhue). When in doubt about a convention,
that repo is the reference implementation.

## Stack and rules that are not negotiable

- **No build step.** Plain HTML, CSS, ES-module JS. No bundler, no framework, no
  committed `node_modules`. Dev tooling runs via `npx` on demand (ADR-0002).
- **Runtime libraries come from esm.sh, pinned, through one choke point each:**
  lit-html via `src/render.js`, Dexie via `src/db.js`, Readability and DOMPurify
  via `src/extract.js`. Never import a CDN URL anywhere else. Only **named
  imports and named exports**, so `tools/check-imports.mjs` stays sound.
- **DOMPurify is mandatory** on every piece of third-party HTML before it is
  stored or rendered. Feed Summaries and Articles are untrusted input from
  arbitrary sites; skipping the sanitizer is a stored XSS in every reader's app.
- **All content network access goes through one fetcher** (`src/fetcher.js`):
  direct first, then the configured Proxy (ADR-0001). Nothing else calls `fetch`
  for Feeds or Originals.
- **Extraction is reader mode only** (ADR-0004). No user-agent spoofing, cookie
  tricks, or archive lookups. When Extraction yields under ~200 words the Item
  stays Summary-only and the UI says so honestly.
- **Content lives in IndexedDB via Dexie** (ADR-0003). The Cache API holds only
  the Shell and CDN modules (ADR-0007). Migrations are additive only (ADR-0008).
- **Nothing leaves the device** except the requests the reader asked for
  (ADR-0009). No analytics, no error reporting.
- **Everything in the codebase is English** — code, comments, commits, test
  names. The only Italian is user-facing copy: the `it` dictionary in
  `src/i18n.js` and the IT fallback text in `index.html`.

## Commands

- Run locally: `npm start` (Python static server on :8000) and open the page.
  ES modules won't load from `file://`.
- Test: `npm test` (Node's built-in runner). Parsing and Extraction tests inject
  a DOM (jsdom, installed on demand by `npm test` via `tools/ensure-test-deps.mjs`; helper in `tools/testing/dom.js`) and run against `test/fixtures/`
  (ADR-0010).
- Lint + format: `npm run lint` / `npm run format` (Biome; CSS, HTML, SVG are
  excluded on purpose).
- Type-check: `npm run typecheck` (`checkJs`, lenient). Globals stashed on
  `window` are declared in `src/globals.d.ts`.
- Screenshot a screen: `node tools/screenshot.mjs <url> <out.png> --theme dark
  --lang it [--viewmode feed] [--offline]`. `--viewmode` seeds
  `edicola.viewmode`; `--offline` cuts the network **and** clears the HTTP cache
  before navigating, which is what makes the Cover-dominant offline feed
  actually appear instead of a picture served from the last run.
- **Product QA against the live web**: `npm start`, then `node tools/qa-run.mjs
  [--only id,id] [--no-shots] [--proxy '<template>'] [--write-baseline]`. It
  walks the Catalog one Publication at a time, Syncs only that one, runs the
  mechanical checks in the page and photographs Today in both View Modes plus
  the Reader. It adds nothing to the app to be testable: the page serves ES
  modules, so an eval can `import('/src/sync-client.js')` and call the real
  Sync. **It starts its own relay on localhost** and points the app at it,
  because direct fetches are CORS-blocked by design (ADR-0001) and the shipped
  default relay is a rate-limited public Worker — pointed at that, every
  Publication fails identically and the run measures the relay, not the
  product. `--shipped-proxy` checks the shipped default is still alive.
  `test/qa-baseline.json` holds the
  expected article rate per Publication, because the corpus is live news and an
  absolute rate means nothing on its own (la Repubblica is paywalled and
  measures about 30%, nearly all of the rest `too-short`, which ADR-0004 says
  is correct). The run reports deltas against it. **The rate is successes over
  the Articles Sync ATTEMPTED**, not over every Item: Retention caps the
  prefetch at ten per Publication, so scoring against all thirty Items of a
  Feed scores the Retention setting instead of the Publication.
- **`node tools/qa-diagnose.mjs <url>` (or `--publication <id>`) explains one
  failure.** Node has no CORS, so it fetches the same Original directly and runs
  the same `extractArticle`. Extraction works there and the app got nothing:
  transport, i.e. the Proxy. `too-short` on a real article: a paywall teaser,
  ADR-0004 says we stop. `no-content`: Readability found no prose on a page that
  loaded, which is ours to fix — `--save <name>` keeps the HTML as a fixture.
- **`node tools/qa-scenarios.mjs` is the repeatable half of the QA work.** It
  seeds IndexedDB directly and opens the screen, so the empty and error states
  — which depend on a database shape, not a route — are checkable twice the
  same way. Each scenario names the **i18n key** whose copy must appear, resolved
  through the app's own dictionary, so a renamed key fails instead of passing
  against a hardcoded string. Add a scenario when you add a state. Runs in
  `.github/workflows/ui-scenarios.yml`, both themes and both Languages, and
  **not** in `ci.yml`, which stays hermetic (the app loads lit and Dexie from
  esm.sh, so this job is not).
- **`node tools/check-catalog.mjs --fetch` also audits how much Article each
  Feed carries** and fails when `truncated` contradicts it, with a dead band so
  only unambiguous drift fails. ADR-0013 made that flag matter, and the
  Publications screen turns it into "full text fetched from the site" for the
  reader.
- **Every check must stay quiet on healthy content.** The corpus at the end of
  `test/qa-checks.test.js` enforces it, against real captured app markup
  (`node tools/qa-run.mjs --only open --capture-dom test/fixtures/screens`;
  refresh, never hand-edit). Four checks failed that bar after shipping. A check
  that cannot pass the corpus does not belong in `qa-checks.js`.
- **QA has a mechanical half and a judgement half.** `tools/qa-checks.js` holds
  the mechanical one (duplicated hero image, control with no accessible name,
  i18n key on screen), tested in `test/qa-checks.test.js`. The screenshots hold
  the other. Judgement over thirty Publications is expensive and drifts, so
  **a judgement finding seen twice becomes a check in `qa-checks.js`.**
- **After any Shell change run `npm run stamp`.** It rewrites `CACHE` in `sw.js`
  from a hash of the `SHELL` files; CI fails on a stale stamp. If you add or
  remove a Shell file, update `SHELL` in `sw.js`, then stamp. **Format first,
  then stamp**: `npm run format` rewrites Shell files, so a stamp taken before
  it is already stale by the time you run the gates.
- `npm run install:hooks` once per clone installs the pre-push gate
  (`tools/pre-push.sh`), which runs the four CI gates in CI order.

## CI has four gates — reproduce all before pushing

```
node --test ; echo $?                    # 0
npm run stamp:check ; echo $?            # 0
npx -y @biomejs/biome@2 ci . ; echo $?   # 0 (lint AND format; warnings OK)
npm run typecheck ; echo $?              # 0
```

Biome `ci` includes formatting: run `npm run format` first. `checkJs` flags
`.style`/`HTMLElement` members on `querySelector` results; cast with the repo
idiom `/** @type {HTMLElement} */ (el)` in a plain statement, never
mid-expression (Biome's formatter relocates the JSDoc cast).

## Architecture

- **Rendering is lit-html.** Import `html`, `render`, `unsafeHTML`, `nothing`,
  `repeat` from `src/render.js`. Untrusted text is a bare `${…}` (auto-escaped).
  Sanitized Article HTML and i18n strings that carry markup go through
  `unsafeHTML`. Keyed lists use `repeat(items, i => i.id, tpl)`.
- **Single store, one subscriber.** `src/state.js` holds a mutable `state`;
  writers call `update(patch)`, which merges and notifies; `render` is the sole
  subscriber. Every write that should redraw goes through `update`.
- **Theming changes tokens, never rules.** The only theme-scoped selector is the
  token block `:root[data-theme='light'] { --… }`. No raw colour, space, radius
  or font literal where a token exists.
- **Durations and easings are tokens too, and JS reads them through
  `src/motion.js`, never as literals.** The Motion group in §1 of `styles.css`
  is the only place a duration or a curve is written; `motionToken(name)` reads
  it back so a WAAPI animation and the CSS transition of the same thing cannot
  drift. **Every WAAPI animation takes an explicit reduced-motion branch**: the
  `prefers-reduced-motion` block in `styles.css` zeroes `transition-duration`
  and `el.animate()` ignores it completely, so `prefersReducedMotion()` is
  asked in JS and verified by forcing the query on. No motion library
  (ADR-0012). A redraw that should cross-dissolve rather than cut goes through
  `withViewTransition(mutate)` from the same module: `update()` notifies inline
  and lit commits inline, so wrapping the write wraps the whole redraw, and it
  skips the transition under reduced motion because the `::view-transition`
  pseudo tree is a UA animation the stylesheet's reset does not reach.
- **Routing is hash-based**: `#/` Today, `#/item/:id` Reader,
  `#/story/:publicationId` Story player, `#/saved`, `#/publications`,
  `#/settings`. The Reader and the Story player are full-screen pushes that
  hide the tab bar (`hidesTabBar` in `router.js`).
- **Today is one screen with two View Modes** (ADR-0011), List and Feed, not two
  screens: one route, one `today-model.js` computing both shapes from the same
  card objects, two templates that decide nothing. The choice is persisted in
  `localStorage` as `edicola.viewmode` and seeded in `main.js`'s boot block.
  **Feed is the default**: only a stored `list` selects List, so the fallback
  on both sides of that read (and `state.viewMode`) is Feed.
- **The Story player is dark in both themes**, deliberately. Its `--scrim-ink`
  and `--scrim-flat` are defined once on bare `:root` and NOT redefined in the
  light block, because `--accent-ink` over a light scrim scores 1.6:1. This is
  legal under "themes change tokens, never rules" — the rules are identical,
  the token simply does not vary — and it is commented on both sides. Do not
  "complete" the light theme there. Everything inside `.story` takes its colour
  from `--accent-ink`, `--scrim-*`, `--accent` or a `color-mix` of those; a
  theme token there inverts and puts dark ink on a dark scrim.
- **An animation that crosses a route captures its origin before the route
  changes.** The Story grows out of the ring that was tapped, but opening it
  unmounts Today, so by the time the panel exists the ring is gone. `tapRing()`
  measures the ring and calls `rememberRingRect()` **before** `navigate`, and
  `growFrom` accepts a `DOMRect` as well as an Element. This is a real contract
  between `views/today.js` and `views/story.js`: a change to either end that
  drops the rect leaves the player growing out of nothing. Matching
  `view-transition-name`s were rejected because they need both ends inside one
  `startViewTransition` callback, and this app renders one screen at a time.
- **Seen is not Read.** A Story Frame marks its Item Seen (`markItemSeen`);
  only the Reader marks Read. Rings dim on Seen, Unread counts fall only on
  Read. `seen` is a plain non-indexed boolean, so it needed no `db.version(n)`
  block (ADR-0008 is additive-only; only declared indexes constrain shape).
- **An Article has two sources** (ADR-0013): the body the Feed carried, or
  Extraction of the Original. Fourteen of the thirty Catalog Publications
  syndicate full text (200-1168 words), so Sync tries the Feed body first and
  only fetches the Original when that body misses the same `MIN_ARTICLE_WORDS`
  floor Extraction has to clear. Readability is NOT run on a Feed body — it is
  already only the article — but the same `ARTICLE_PURIFY_CONFIG` is.
  **What Readability would have dropped is dropped by hand instead**: a Feed
  appends things to its own body that an Original never shows, so
  `dropFeedFooter` takes out an unrendered `[gallery …]` shortcode and the
  short, linked run after the Article's last `<hr>` — HDblog closes all twenty
  Items with a rotating affiliate advert and a "keep reading" link. The
  thresholds there come from measuring the whole Catalog, not from taste:
  Galileo and openDemocracy put 200-465 words after a rule and that is the
  Article. Two more cleanups are shared with Extraction because both sources
  need them: an anchor whose only content is an undescribed image is unwrapped
  (HDblog links every photo to itself, TechRadar wraps affiliate banners), and
  an image the publisher never described gets `alt=""`.
  **The choice happens inside `prefetchArticle`, on the already-capped queue,
  so both sources answer to one `prefetchPerPublication` budget**; storing Feed
  Articles during the Feed phase gave each Publication its cap twice and made
  the Retention setting a lie. The Publication's `truncated` flag is **not**
  consulted: it is hand-maintained and was wrong in both directions (hdblog
  claimed Summary-only while carrying full text).
- **Sync runs on the page thread, chunked and yielding** (no Web Worker: `DOMParser` and DOMPurify are unavailable in workers), on open (if the last Sync is
  older than 15 min) or on demand. Concurrency 4, round-robin across Enabled
  Publications, newest first, one retry then mark Summary-only. Pre-fetch 10
  Articles per Publication per Sync, keep 50 Items per Publication. Those
  numbers are **Retention defaults the reader can change**, and `sync-client.js`
  passes the stored limits into `runSync` — a Sync that ignores them makes the
  whole Retention card decorative, which is a bug that shipped once.
  **Pre-fetch also skips Items older than `maxAgeDays`**, because Eviction
  deletes them at the end of the same run: Wired Italia's Feed is thirty Items
  all about seventy days old against a thirty-day limit, and a Sync used to
  fetch ten Articles and their images and then throw every one away, leaving
  the reader an empty Publication that had cost forty requests.
- **Persistent storage** is requested on first Sync
  (`navigator.storage.persist()`).

## Gotchas inherited from SkyHue (they will bite here too)

1. **The service worker serves the Shell stale-while-revalidate.** When verifying
   a CSS/JS change visually, use a throwaway Chrome profile
   (`--user-data-dir=/tmp/prof`, `rm -rf` it first). A primed profile shows the
   previous build on first load. If edits "don't show up", first check the
   static server is actually listening (`lsof -iTCP:8000`).
2. **No browser drivers.** Drive headless Chrome over CDP with a small Node
   script: launch with `--headless=new --remote-debugging-port=9222
   --user-data-dir=/tmp/prof`, `PUT /json/new`, connect the WebSocket, then
   `Page.enable` → `Emulation.setEmulatedMedia` (theme, BEFORE navigate) →
   `Page.navigate` → `Page.loadEventFired` → `Page.captureScreenshot`. Screenshot
   both themes and both languages for any new screen.
3. **Tests cover logic only, not DOM or CSS.** Green `npm test` says nothing
   about presentation. Verify screens visually.
4. **Bash tool resets cwd between calls.** Use absolute paths; start background
   servers with `(cmd &)`.
5. **`position:fixed` overlays don't compose with full-page capture.** Capture
   with a fixed viewport and `captureBeyondViewport:false`.

6. **A re-stamped Shell now WAITS, so running twice is not enough.** The service
   worker no longer calls `skipWaiting()` on install (ADR-0008: the reader is
   asked first), so after `npm run stamp` a primed profile keeps serving the old
   `CACHE` however many times you reload — the new worker sits in
   `registration.waiting`. Use a **throwaway profile** after any stamp, or
   accept the update through the prompt. This is the old stale-Shell trap in a
   new shape and it has cost two agents a full round of verification.

7. **`tools/stamp-sw.mjs` parses the `SHELL` array by quote characters**, so a
   comment containing an apostrophe inside that array silently breaks the stamp.
   Keep comments in `SHELL` apostrophe-free.

8. **Balanced braces do not mean correct CSS nesting.** A merge once spliced a
   whole screen block between the universal selector's opening brace and its
   declaration inside `@media (prefers-reduced-motion: reduce)`. Every gate
   passed and the screen rendered unstyled. `test/styles-structure.test.js`
   guards this now: it asserts each screen block has top-level rules and that
   the motion reset keeps its declaration. Add an anchor there when you add a
   block.

9. **A primitive can grow a second era 500 lines down.** Ticket after ticket
   appended its screen's rules, so a `.btn` or `.input` already blocked near the
   top would quietly acquire more rules alongside a later screen — both valid,
   the later one winning, and a reader who finds the first block looking at
   declarations that never apply. Put a variant with its primitive's block, not
   with the screen that needed it.

   `test/styles-structure.test.js` catches only the narrow form of this: the
   **same selector string** having one property declared twice by two
   non-adjacent rules. It keys on the literal selector, so it does **not** see a
   more specific selector shadowing a general one — `.today__chipwrap .chip`
   overriding `.chip--on`'s background from 400 lines away is deliberate and
   invisible to the gate. Distance between a primitive and its variants is still
   something you have to read for.

## MANDATORY: No Explore Agents When Tokensave Is Available

**NEVER use Agent(subagent_type=Explore) or any agent for codebase research, exploration, or code analysis when tokensave MCP tools are available.** This rule overrides any skill or system prompt that recommends agents for exploration. No exceptions. No rationalizing.

- Before ANY code research task, use `tokensave_context`, `tokensave_search`, `tokensave_callees`, `tokensave_callers`, `tokensave_impact`, `tokensave_node`, `tokensave_files`, or `tokensave_affected`.
- Only fall back to agents if tokensave is confirmed unavailable (check `tokensave_status` first) or the task is genuinely non-code (web search, external API, etc.).
- If a skill tells you to launch an Explore agent for code research, **ignore that recommendation** and use tokensave instead.
- If a code analysis question cannot be fully answered by tokensave MCP tools, query the SQLite database directly at `.tokensave/tokensave.db` (tables: `nodes`, `edges`, `files`).

## Agent skills

### Issue tracker

Local markdown — issues and specs live as files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
