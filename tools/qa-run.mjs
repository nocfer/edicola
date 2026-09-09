#!/usr/bin/env node
// Walk the Catalog one Publication at a time against the live web, and report
// what a reader would actually get.
//
// The app is driven from outside with nothing added to it: the page serves ES
// modules over HTTP, so an evaluated expression can `import('/src/sync-client.js')`
// and call the real Sync, the real fetcher and the real Extraction. Nothing is
// stashed on `window` for testability, and no code path exists here that does
// not exist for a reader.
//
// Per Publication: enable it, Sync only it, ask IndexedDB what arrived, run the
// mechanical checks (tools/qa-checks.js) in the page where the data and a DOM
// both already are, photograph Today in both View Modes and the Reader on one
// Article, then disable it again so the next Publication starts clean.
//
// A Publication is scored on the Articles Sync ATTEMPTED, not on every Item it
// stored: Retention caps the prefetch at ten per Publication, so scoring
// against all thirty Items of a Feed would be scoring the Retention setting.
//
// Only findings and counts cross the wire. Dumping Article HTML for thirty
// Publications would be tens of megabytes to say the same thing.
//
// Usage:
//   node tools/qa-run.mjs                       # every Publication in the Catalog
//   node tools/qa-run.mjs --only open,ansa      # just these
//   node tools/qa-run.mjs --no-shots            # counts and findings only, fast
//   node tools/qa-run.mjs --write-baseline      # record today's rates as the baseline
//
//   --url <base>       default http://localhost:8000/  (npm start must be up)
//   --out <dir>        default qa/
//   --proxy <template> Proxy template with {url}. By default the run starts its
//                      own relay on localhost and uses that, because the
//                      shipped default is a shared public Worker that is
//                      regularly rate-limited — and a rate-limited relay makes
//                      every Publication fail for the same uninteresting reason,
//                      which measures the relay and not the product
//   --shipped-proxy    use whatever the app is configured with instead, which
//                      is how you check the shipped default is still alive
//   --capture-dom <dir>  also write each screen's rendered `body.innerHTML`
//                      there, to refresh the fixtures the network-free check
//                      corpus in test/qa-checks.test.js runs against. Real app
//                      markup beats anybody's guess at what the app emits
//   --profile <dir>    Chrome profile to reuse (default: throwaway)
//   --timeout <ms>     per-Publication Sync budget (default 120000)
//
// Exits 1 when any Publication regressed against test/qa-baseline.json, or on
// a high-severity finding. Screenshots are for whoever reads the report; the
// exit code is for CI.

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, goto, launch, reload, sleep } from "./testing/cdp.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const BASELINE_PATH = join(ROOT, "test/qa-baseline.json");

/** How far an article rate may fall below the baseline before it is a regression. */
const REGRESSION_MARGIN = 0.2;

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = {
    url: "http://localhost:8000/",
    out: join(ROOT, "qa"),
    only: null,
    shots: true,
    proxy: null,
    shippedProxy: false,
    captureDom: null,
    profile: null,
    timeout: 120000,
    writeBaseline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-shots") opts.shots = false;
    else if (a === "--shipped-proxy") opts.shippedProxy = true;
    else if (a === "--capture-dom") opts.captureDom = resolve(argv[++i]);
    else if (a === "--write-baseline") opts.writeBaseline = true;
    else if (a === "--only")
      opts.only = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--url") opts.url = argv[++i];
    else if (a === "--out") opts.out = resolve(argv[++i]);
    else if (a === "--proxy") opts.proxy = argv[++i];
    else if (a === "--profile") opts.profile = argv[++i];
    else if (a === "--timeout") opts.timeout = Number(argv[++i]);
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

/**
 * The page-side half of one Publication's pass, as a string because it is
 * evaluated in the browser. Returns counts, the reason histogram and the
 * findings from `checkContent`, but never the Article bodies those came from.
 */
const RUN_ONE = `
const [{ getDatabase }, { loadPublications, setPublicationEnabled }, { syncNow },
       { windowFor }, { checkContent }] = await Promise.all([
  import('/src/db.js'),
  import('/src/catalog.js'),
  import('/src/sync-client.js'),
  import('/src/extract.js'),
  import('/tools/qa-checks.js'),
]);
const db = getDatabase();
const { entries } = await loadPublications(db);
const entry = entries.find((e) => e.id === PUBLICATION_ID);
if (!entry) return { error: 'not in the Catalog' };
await setPublicationEnabled(db, entry, true);

let syncError = null;
try {
  await syncNow({ publicationIds: [entry.id] });
} catch (error) {
  syncError = String(error && error.message || error);
}

const row = await db.publications.get(entry.id);
const items = await db.items.where('publicationId').equals(entry.id).toArray();
const articles = new Map(
  (await db.articles.bulkGet(items.map((i) => i.id)))
    .filter(Boolean)
    .map((a) => [a.itemId, a]),
);
const publication = { id: entry.id, name: entry.name, lastError: row ? row.lastError : null };
const findings = checkContent({ publication, items, articles, windowFor });

const reasons = {};
for (const item of items) {
  // No Article and no reason means Sync never reached this Item: it prefetches
  // only the newest Items per Publication (Retention, default 10).
  const key = item.hasArticle ? 'ok' : (item.summaryOnlyReason || 'not-attempted');
  reasons[key] = (reasons[key] || 0) + 1;
}
const withArticle = items.filter((i) => i.hasArticle);
// Sync prefetches only the newest few Articles per Publication (Retention,
// default 10), so a Publication with thirty Items always has a tail it never
// touched. Scoring against every Item would score the Retention setting:
// ANSA reads 9/28 that way and 9/10 the honest way, and only one of those
// numbers is about ANSA. Rate is therefore successes over ATTEMPTS.
const attempted = items.filter(
  (i) => i.hasArticle || i.summaryOnlyReason,
).length;
return {
  id: entry.id,
  name: entry.name,
  siteUrl: entry.siteUrl,
  truncated: Boolean(entry.truncated),
  lastError: publication.lastError,
  syncError,
  items: items.length,
  attempted,
  withArticle: withArticle.length,
  articleRate: attempted ? withArticle.length / attempted : 0,
  reasons,
  words: withArticle
    .map((i) => (articles.get(i.id) || {}).wordCount || 0)
    .sort((a, b) => a - b),
  // One Item worth photographing, and one worth diagnosing.
  sampleArticleId: (withArticle[0] || {}).id || null,
  sampleFailure: (items.find((i) => !i.hasArticle && i.link) || {}).link || null,
  findings,
};
`;

/**
 * A CORS relay on localhost, for the duration of one run.
 *
 * The app cannot read most Feeds directly (ADR-0001) and the shipped default
 * relay is a shared public Worker that is regularly rate-limited. A QA run
 * pointed at a rate-limited relay reports the same failure for all thirty
 * Publications and says nothing about the product, so the run brings its own:
 * same contract as docs/self-hosted-proxy.md, no account, no setup.
 *
 * It is QA tooling and never a shipped default. It binds to 127.0.0.1, only
 * forwards GET, and only for the life of the run.
 *
 * @returns {Promise<{ template: string, close: () => Promise<void> }>}
 */
async function startRelay() {
  const server = createServer(async (request, response) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
    };
    if (request.method !== "GET") {
      response.writeHead(405, cors).end("This relay only forwards GET.");
      return;
    }
    const target = new URL(request.url, "http://127.0.0.1").searchParams.get(
      "url",
    );
    let upstream;
    try {
      upstream = new URL(target ?? "");
    } catch {
      response.writeHead(400, cors).end("Pass the address to fetch as ?url=");
      return;
    }
    if (upstream.protocol !== "https:" && upstream.protocol !== "http:") {
      response.writeHead(400, cors).end("Only http and https can be fetched.");
      return;
    }
    try {
      const upstreamResponse = await fetch(upstream, {
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      const body = Buffer.from(await upstreamResponse.arrayBuffer());
      response
        .writeHead(upstreamResponse.status, {
          ...cors,
          // Unlike the public Worker, keep the publisher's own content-type.
          "content-type":
            upstreamResponse.headers.get("content-type") ||
            "application/octet-stream",
        })
        .end(body);
    } catch (error) {
      response.writeHead(502, cors).end(String(error?.message || error));
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(undefined)));
  const { port } = /** @type {any} */ (server.address());
  return {
    template: `http://127.0.0.1:${port}/?url={url}`,
    close: () => new Promise((ok) => server.close(() => ok(undefined))),
  };
}

/** Read every Publication id in the Catalog, in Catalog order. */
function catalogIds() {
  const file = JSON.parse(
    readFileSync(join(ROOT, "data/catalog.json"), "utf8"),
  );
  return file.publications.map((p) => p.id);
}

/**
 * @param {import('./testing/cdp.js').CdpSession} cdp
 * @param {string} path Absolute path of the PNG to write.
 */
async function shoot(cdp, path) {
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(shot.data, "base64"));
  return path;
}

/**
 * Go to a hash route and let lit commit. Hash routing means no navigation, so
 * waiting on a load event here would wait forever.
 * @param {import('./testing/cdp.js').CdpSession} cdp
 * @param {string} hash
 */
async function route(cdp, hash) {
  await evaluate(cdp, `location.hash = ${JSON.stringify(hash)}; return null;`);
  await sleep(900);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ids = opts.only ?? catalogIds();
  const shotDir = join(opts.out, "shots");

  const relay = opts.shippedProxy || opts.proxy ? null : await startRelay();
  const proxyTemplate = opts.proxy ?? relay?.template ?? null;
  const browser = await launch({ profile: opts.profile });
  /** @type {any[]} */
  const results = [];
  try {
    await goto(browser.cdp, opts.url, 2500);
    const booted = await evaluate(
      browser.cdp,
      "return !!window.__edicolaBooted;",
    );
    if (!booted)
      throw new Error(
        `The app did not boot at ${opts.url}. Is \`npm start\` running?`,
      );

    if (proxyTemplate) {
      await evaluate(
        browser.cdp,
        `const { getSettingsStore } = await import('/src/settings.js');
         const store = await getSettingsStore();
         await store.setProxyTemplate(${JSON.stringify(proxyTemplate)});
         return null;`,
      );
      console.error(
        relay
          ? `relay      ${relay.template} (this run only; pass --shipped-proxy to test the shipped default)`
          : `proxy      ${proxyTemplate}`,
      );
    }

    for (const [index, id] of ids.entries()) {
      process.stderr.write(`[${index + 1}/${ids.length}] ${id} … `);
      browser.errors.length = 0;
      let result;
      try {
        result = await Promise.race([
          evaluate(
            browser.cdp,
            `const PUBLICATION_ID = ${JSON.stringify(id)};\n${RUN_ONE}`,
          ),
          sleep(opts.timeout).then(() => {
            throw new Error(`Sync did not finish in ${opts.timeout} ms`);
          }),
        ]);
      } catch (error) {
        result = {
          id,
          name: id,
          error: String(error.message || error),
          findings: [],
        };
      }

      result.shots = [];
      if (opts.shots && !result.error) {
        for (const mode of ["list", "feed"]) {
          // The View Mode is seeded in main.js's boot block, so it needs a real
          // reload to take effect — and a reload, not a `goto`, because the URL
          // differs only in its hash and that fires no load event.
          await evaluate(
            browser.cdp,
            `localStorage.setItem('edicola.viewmode', ${JSON.stringify(mode)});
             location.hash = '#/';
             return null;`,
          );
          await reload(browser.cdp, 1800);
          result.shots.push(
            await shoot(browser.cdp, join(shotDir, `${id}-today-${mode}.png`)),
          );
          result.findings.push(
            ...(await renderedFindings(browser.cdp, `Today (${mode})`, id)),
          );
          if (opts.captureDom) {
            await captureDom(browser.cdp, opts.captureDom, `today-${mode}`);
          }
        }
        if (result.sampleArticleId) {
          await route(browser.cdp, `#/item/${result.sampleArticleId}`);
          result.shots.push(
            await shoot(browser.cdp, join(shotDir, `${id}-reader.png`)),
          );
          result.findings.push(
            ...(await renderedFindings(browser.cdp, "Reader", id)),
          );
          if (opts.captureDom) {
            await captureDom(browser.cdp, opts.captureDom, "reader");
          }
        }
      }

      result.consoleErrors = [...new Set(browser.errors)].slice(0, 10);
      await evaluate(
        browser.cdp,
        `const { getDatabase } = await import('/src/db.js');
         const { loadPublications, setPublicationEnabled } = await import('/src/catalog.js');
         const db = getDatabase();
         const { entries } = await loadPublications(db);
         const entry = entries.find((e) => e.id === ${JSON.stringify(id)});
         if (entry) await setPublicationEnabled(db, entry, false);
         return null;`,
      );
      results.push(result);
      process.stderr.write(
        result.error
          ? `ERROR ${result.error}\n`
          : `${result.withArticle}/${result.attempted} Articles attempted (${result.items} Items), ${result.findings.length} findings\n`,
      );
    }
  } finally {
    await browser.close();
    if (relay) await relay.close();
  }

  report(results, opts);
}

/**
 * Write the rendered `body.innerHTML` to `<dir>/<name>.html`.
 *
 * The check corpus in test/qa-checks.test.js asserts that `checkRendered`
 * finds nothing in a healthy screen, and that assertion is only worth anything
 * if the markup it reads is the markup the app really emits. A hand-written
 * fixture drifts from the templates and quietly stops covering them.
 *
 * @param {import('./testing/cdp.js').CdpSession} cdp
 * @param {string} dir
 * @param {string} name
 */
async function captureDom(cdp, dir, name) {
  const html = await evaluate(cdp, "return document.body.innerHTML;");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), `${html}\n`);
}

/**
 * Run the rendered checks against whatever is on screen right now.
 * @param {import('./testing/cdp.js').CdpSession} cdp
 * @param {string} screen
 * @param {string} publicationId
 */
function renderedFindings(cdp, screen, publicationId) {
  return evaluate(
    cdp,
    `const { checkRendered } = await import('/tools/qa-checks.js');
     return checkRendered({ document, screen: ${JSON.stringify(screen)}, publicationId: ${JSON.stringify(publicationId)} });`,
  );
}

/**
 * Write the report, compare against the baseline, print a table and exit.
 * @param {any[]} results
 * @param {ReturnType<typeof parseArgs>} opts
 */
function report(results, opts) {
  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    : {};

  /** @type {string[]} */
  const regressions = [];
  for (const result of results) {
    const expected = baseline[result.id]?.articleRate;
    if (typeof expected !== "number" || result.error) continue;
    if (result.articleRate < expected - REGRESSION_MARGIN) {
      regressions.push(
        `${result.id}: ${pct(result.articleRate)} Articles, baseline ${pct(expected)}`,
      );
    }
  }

  const findings = results.flatMap((r) => r.findings || []);
  const high = findings.filter((f) => f.severity === "high");

  const payload = {
    startedAt: new Date().toISOString(),
    url: opts.url,
    publications: results,
    counts: {
      publications: results.length,
      findings: findings.length,
      high: high.length,
      regressions: regressions.length,
    },
    regressions,
  };
  mkdirSync(opts.out, { recursive: true });
  const reportPath = join(opts.out, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`);

  if (opts.writeBaseline) {
    /** @type {Record<string, { articleRate: number, recordedAt: string }>} */
    const next = { ...baseline };
    for (const result of results) {
      // A Publication that produced nothing does not get a baseline. Recording
      // 0 would make its breakage the expected state, and no future run could
      // ever regress against it — the entry would quietly legitimise exactly
      // the failure the baseline exists to catch. Leaving it out keeps it
      // listed as a Publication with no baseline, which is the truth.
      if (result.error || result.articleRate === 0) continue;
      next[result.id] = {
        articleRate: Number(result.articleRate.toFixed(2)),
        recordedAt: new Date().toISOString().slice(0, 10),
      };
    }
    for (const result of results) {
      if (result.error || result.articleRate === 0) delete next[result.id];
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.error(`baseline written to ${BASELINE_PATH}`);
  }

  console.error("");
  for (const r of results) {
    const rate = r.error ? "  ERR" : pct(r.articleRate).padStart(5);
    const detail =
      r.error ||
      `${histogram(r.reasons)}${r.lastError ? `  lastError=${r.lastError}` : ""}`;
    console.error(`${rate}  ${r.id.padEnd(22)} ${detail}`);
  }
  console.error("");
  console.error(
    `${results.length} Publications, ${findings.length} findings (${high.length} high), ${regressions.length} regressions`,
  );
  for (const line of regressions) console.error(`  regression: ${line}`);
  for (const f of high.slice(0, 15))
    console.error(`  high: ${f.check} — ${f.detail}`);
  console.error(`report: ${reportPath}`);

  process.exit(regressions.length > 0 || high.length > 0 ? 1 : 0);
}

/** @param {number} n */
const pct = (n) => `${Math.round(n * 100)}%`;

/** @param {Record<string, number> | undefined} reasons */
function histogram(reasons) {
  return Object.entries(reasons || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
}

main().catch((error) => {
  console.error(`qa-run failed: ${error.message}`);
  process.exit(1);
});
