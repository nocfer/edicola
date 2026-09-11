#!/usr/bin/env node
// The screens nobody can reach by hand twice the same way.
//
// Every empty and error state in Today depends on a database shape rather than
// on a route, so verifying one used to mean forcing a broken Proxy, running a
// Sync, and taking a screenshot in a second process that shared the first one's
// Chrome profile. That is three moving parts, a live network, and a different
// answer every morning. `today.allFailed` was checked exactly that way, twice,
// and the second time only because the first was not repeatable.
//
// So the state is written straight into IndexedDB instead. Each scenario below
// declares the rows it wants, the route to open and the copy that must be on
// screen; the run seeds, navigates, screenshots and asserts. No Sync, no
// publisher, no network beyond the static server on localhost — which is what
// makes this safe to put in front of CI, unlike tools/qa-run.mjs.
//
// It also runs `checkRendered` on every screen, so the mechanical checks cover
// the empty states and not just the populated ones a live run happens to hit.
//
// Usage:
//   npm start
//   node tools/qa-scenarios.mjs                    # every scenario
//   node tools/qa-scenarios.mjs --only all-failed
//   node tools/qa-scenarios.mjs --theme light --lang it
//
//   --out <dir>      screenshots (default qa/scenarios)
//   --keep-going     report every failure instead of stopping at the first
//
// Exits 1 when a scenario's expected copy is missing, or any check fires.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, goto, launch, reload, sleep } from "./testing/cdp.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

/** Where `npm start` serves the app. */
const BASE_URL = "http://localhost:8000/";

/** A day in ms, for `publishedAt` values that read as recent. */
const DAY = 24 * 60 * 60 * 1000;

/**
 * One reproducible screen.
 *
 * `seed` runs in the page with `db`, `now` and the helpers below in scope, and
 * owns the whole database: the harness wipes the tables before each scenario so
 * no scenario can inherit another's rows.
 *
 * `expect` is an i18n key. The harness resolves it through the app's own
 * dictionary and asserts the rendered text contains the result, so the copy and
 * the assertion cannot drift apart — renaming a key fails here rather than
 * silently passing against a hardcoded English string.
 *
 * @typedef {object} Scenario
 * @property {string} name
 * @property {string} why What regression this pins.
 * @property {string} route Hash route, e.g. `#/`.
 * @property {string} seed Page-side statements.
 * @property {string} [expect] i18n key whose text must appear.
 * @property {string[]} [absent] i18n keys whose text must NOT appear.
 */

/** @type {Scenario[]} */
const SCENARIOS = [
  {
    name: "no-publications",
    why: "A first run must invite the reader to the Catalog, not look broken.",
    route: "#/",
    seed: "return null;",
    expect: "today.placeholder",
  },
  {
    name: "never-synced",
    why: "Publications on but no Sync yet is not the same as a Sync that found nothing.",
    route: "#/",
    seed: `await db.publications.put(publication({ lastSyncedAt: null }));
           return null;`,
    expect: "today.neverSynced",
  },
  {
    name: "all-failed",
    why:
      "`lastSyncedAt` is written whether the Feed answered or not, so a total " +
      "failure used to render as a quiet news day and send the reader to wait " +
      "for news that would never arrive.",
    route: "#/",
    seed: `await db.publications.put(
             publication({ lastSyncedAt: now - 60000, lastError: 'blocked' }),
           );
           return null;`,
    expect: "today.allFailed",
    absent: ["today.empty"],
  },
  {
    name: "synced-but-empty",
    why: "A Feed that answered and had nothing new is the one case where 'try again later' is honest.",
    route: "#/",
    seed: `await db.publications.put(
             publication({ lastSyncedAt: now - 60000, lastError: null }),
           );
           return null;`,
    expect: "today.empty",
    absent: ["today.allFailed"],
  },
  {
    name: "summary-only-reader",
    why:
      "When the publisher sends a teaser the Reader must say so plainly " +
      "(ADR-0004), and it must reach that state through the real on-demand " +
      "Extraction rather than a pre-set flag.",
    route: null,
    // The Item's Original is a paywall-teaser fixture served by the static
    // server, so opening the Reader runs the genuine `fetchArticleNow` path,
    // over localhost only, and lands on `too-short` every time. Pointing it at
    // an unreachable host instead made the answer depend on DNS.
    seed: `await db.publications.put(publication({ lastSyncedAt: now - 60000 }));
           await db.items.put(item({
             link: location.origin + '/test/fixtures/articles/thetimes-paywall-teaser.html',
           }));
           return 'test:1';`,
    expect: "reader.summaryOnlyBody",
  },
  {
    name: "article-not-fetched-reader",
    why:
      "Retention caps Pre-fetching per Publication, so most of a Feed has no " +
      "Article and no failure either. That state had no scenario, which is how " +
      "a headline calling it Summary-only shipped: nothing was withheld.",
    route: null,
    // No `link` fixture and no Summary-only flag: the Item is simply one
    // Pre-fetching never reached, which is what two thirds of a synced Feed
    // looks like.
    seed: `await db.publications.put(publication({ lastSyncedAt: now - 60000 }));
           await db.items.put(item({ link: null }));
           return 'test:1';`,
    expect: "reader.notFetched",
  },
  {
    name: "saved-empty",
    why: "The Saved screen with nothing saved is a state no live Sync ever produces.",
    route: "#/saved",
    seed: "return null;",
    expect: "saved.empty",
  },
];

/** Page-side helpers every `seed` can call. */
const SEED_PRELUDE = `
const { getDatabase } = await import('/src/db.js');
const db = getDatabase();
const now = Date.now();
// Wipe first: a scenario that inherited another's rows would pass or fail for
// reasons its own declaration does not mention.
await Promise.all([
  db.items.clear(),
  db.articles.clear(),
  db.images.clear(),
  db.publications.clear(),
]);
// Stamp a recent global Sync so syncIfStale on boot does nothing. Without it
// every scenario fired a real Feed request at its fake Publication, which then
// wrote lastSyncedAt and lastError and turned "never synced" into "all failed"
// before the screen was even read. No backticks in here: this whole block is a
// template literal.
await db.meta.put({ key: 'lastSyncAt', value: now });
const publication = (over) => ({
  id: 'test',
  name: 'Test Publication',
  country: 'IT',
  language: 'it',
  category: 'news',
  feedUrl: 'https://test.invalid/feed',
  siteUrl: 'https://test.invalid',
  truncated: true,
  custom: false,
  enabled: true,
  lastSyncedAt: null,
  lastError: null,
  ...over,
});
const item = (over) => ({
  id: 'test:1',
  publicationId: 'test',
  feedItemId: '1',
  title: 'A headline for the scenario',
  link: 'https://test.invalid/1',
  publishedAt: now - ${DAY / 2},
  summaryHtml: '<p>A short summary of the piece.</p>',
  summaryText: 'A short summary of the piece.',
  thumbnailUrl: null,
  read: false,
  saved: 0,
  readingPosition: 0,
  summaryOnly: false,
  summaryOnlyReason: null,
  hasArticle: false,
  fetchedAt: now,
  ...over,
});
`;

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = {
    out: join(ROOT, "qa/scenarios"),
    only: null,
    theme: "dark",
    lang: "en",
    keepGoing: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep-going") opts.keepGoing = true;
    else if (a === "--only") opts.only = argv[++i].split(",");
    else if (a === "--out") opts.out = resolve(argv[++i]);
    else if (a === "--theme") opts.theme = argv[++i];
    else if (a === "--lang") opts.lang = argv[++i];
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const chosen = opts.only
    ? SCENARIOS.filter((s) => opts.only.includes(s.name))
    : SCENARIOS;
  if (chosen.length === 0) throw new Error("No scenario matched --only");

  const browser = await launch({});
  /** @type {string[]} */
  const failures = [];
  try {
    await browser.cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: opts.theme }],
    });
    await browser.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try {
        localStorage.setItem('edicola.theme', ${JSON.stringify(opts.theme)});
        localStorage.setItem('edicola.lang', ${JSON.stringify(opts.lang)});
      } catch (e) {}`,
    });
    await goto(browser.cdp, BASE_URL, 2500);
    if (!(await evaluate(browser.cdp, "return !!window.__edicolaBooted;"))) {
      throw new Error(
        `The app did not boot at ${BASE_URL}. Is \`npm start\` running?`,
      );
    }

    for (const scenario of chosen) {
      browser.errors.length = 0;
      const seeded = await evaluate(
        browser.cdp,
        `${SEED_PRELUDE}\n${scenario.seed}`,
      );
      // A reload, not a hash change: the screens read the database when they
      // mount, so a route change alone would render the previous rows.
      const route = scenario.route ?? `#/item/${seeded}`;
      await evaluate(
        browser.cdp,
        `location.hash = ${JSON.stringify(route)}; return null;`,
      );
      await reload(browser.cdp, 1600);
      await sleep(400);

      const shot = await browser.cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      mkdirSync(opts.out, { recursive: true });
      const path = join(
        opts.out,
        `${scenario.name}-${opts.theme}-${opts.lang}.png`,
      );
      writeFileSync(path, Buffer.from(shot.data, "base64"));

      const verdict = await evaluate(
        browser.cdp,
        `const { t } = await import('/src/i18n.js');
         const { checkRendered } = await import('/tools/qa-checks.js');
         // innerText is RENDERED text, so a heading the stylesheet sets in
         // uppercase arrives uppercased and no dictionary string matches it.
         // Both sides are lower-cased before comparing; a screen never proves
         // anything by the case of its copy.
         const text = (document.body.innerText || '').toLowerCase();
         const resolve = (key) => {
           const value = t(key);
           // A key that resolves to itself is not translated, and asserting on
           // it would pass against any screen at all.
           return value === key ? null : value.toLowerCase();
         };
         const wanted = ${JSON.stringify(scenario.expect ?? null)};
         const unwanted = ${JSON.stringify(scenario.absent ?? [])};
         return {
           hash: location.hash,
           missingKey: wanted && resolve(wanted) === null ? wanted : null,
           found: wanted ? text.includes(resolve(wanted) || '\\u0000') : true,
           leaked: unwanted.filter((key) => {
             const value = resolve(key);
             return value !== null && text.includes(value);
           }),
           findings: checkRendered({ document, screen: ${JSON.stringify(scenario.name)} }),
         };`,
      );

      /** @type {string[]} */
      const problems = [];
      if (verdict.missingKey) {
        problems.push(`i18n key "${verdict.missingKey}" does not resolve`);
      } else if (!verdict.found) {
        problems.push(
          `expected copy for "${scenario.expect}" is not on screen`,
        );
      }
      for (const key of verdict.leaked) {
        problems.push(`copy for "${key}" should NOT be on this screen`);
      }
      for (const finding of verdict.findings) {
        problems.push(
          `${finding.severity} ${finding.check}: ${finding.detail}`,
        );
      }
      for (const error of [...new Set(browser.errors)].slice(0, 3)) {
        problems.push(`console: ${error}`);
      }

      if (problems.length === 0) {
        console.error(`  ok    ${scenario.name}`);
      } else {
        console.error(`  FAIL  ${scenario.name}  (${path})`);
        for (const p of problems) console.error(`          ${p}`);
        failures.push(scenario.name);
        if (!opts.keepGoing) break;
      }
    }
  } finally {
    await browser.close();
  }

  console.error("");
  console.error(
    `${chosen.length - failures.length}/${chosen.length} scenarios passed in ${opts.theme}/${opts.lang}`,
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`qa-scenarios failed: ${error.message}`);
  process.exit(1);
});
