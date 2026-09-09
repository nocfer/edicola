#!/usr/bin/env node
// Why did this Original produce no Article?
//
// The app fetches from a page, so every cross-origin request is subject to
// CORS and lands on the Proxy when the publisher does not allow it. Node has
// no such rule. That difference is the whole diagnostic: fetch the same URL
// here, run the same `extractArticle` from src/extract-core.js over it, and
// the two answers together say which layer is at fault.
//
//   browser failed, here it works      the transport. Proxy or CORS, not us.
//   browser failed, here it fails too  the site or the Extraction. Read on:
//                                      `too-short` on a real article means a
//                                      paywall teaser (ADR-0004: we stop),
//                                      `no-content` means Readability found
//                                      no prose, which is ours to fix.
//   both worked, wildly different word counts   an Extraction regression on
//                                      this publisher's markup.
//
// This never spoofs a user agent, sends cookies or looks for an archive copy
// (ADR-0004). It requests exactly what an anonymous visitor gets, which is the
// only thing the app is allowed to use anyway — otherwise the diagnosis would
// describe an app we are not allowed to ship.
//
// Usage:
//   node tools/qa-diagnose.mjs <url>
//   node tools/qa-diagnose.mjs --publication open     # its failing sample from qa/report.json
//   node tools/qa-diagnose.mjs <url> --save <name>    # keep the HTML as a fixture
//
// Needs the on-demand test dependencies (jsdom, Readability, DOMPurify): run
// `npm test` once if this reports them missing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_ARTICLE_WORDS, extractArticle } from "../src/extract-core.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const REPORT_PATH = join(ROOT, "qa/report.json");
const FIXTURE_DIR = join(ROOT, "test/fixtures/articles");

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = { url: null, publication: null, save: null, timeout: 20000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--publication") opts.publication = argv[++i];
    else if (a === "--save") opts.save = argv[++i];
    else if (a === "--timeout") opts.timeout = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else opts.url = a;
  }
  return opts;
}

/** Load the DOM dependencies, with a useful message when they are absent. */
async function loadDom() {
  try {
    const dom = await import("./testing/dom.js");
    return dom;
  } catch (error) {
    throw new Error(
      `The test DOM is not installed (${error.message}). Run \`npm test\` once, which installs jsdom, Readability and DOMPurify on demand.`,
    );
  }
}

/**
 * What the last QA run saw for this Publication, so the two halves of the
 * diagnosis are printed side by side rather than remembered.
 * @param {string} id
 */
function fromReport(id) {
  if (!existsSync(REPORT_PATH)) return null;
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
  return report.publications.find((p) => p.id === id) || null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let browserSide = null;
  if (opts.publication) {
    browserSide = fromReport(opts.publication);
    if (!browserSide) {
      throw new Error(
        `No entry for "${opts.publication}" in ${REPORT_PATH}. Run tools/qa-run.mjs first.`,
      );
    }
    opts.url = opts.url || browserSide.sampleFailure;
    if (!opts.url) {
      throw new Error(
        `${opts.publication} has no failing Item with a link in the last report; nothing to diagnose.`,
      );
    }
  }
  if (!opts.url) throw new Error("Usage: node tools/qa-diagnose.mjs <url>");

  const { windowFor, Readability, purifierFor } = await loadDom();

  console.log(`url        ${opts.url}`);
  if (browserSide) {
    console.log(
      `in the app ${browserSide.withArticle}/${browserSide.items} Articles, reasons ${JSON.stringify(browserSide.reasons)}, lastError ${browserSide.lastError}`,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout);
  /** @type {Response} */
  let response;
  try {
    response = await fetch(opts.url, {
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (error) {
    console.log(`fetch      FAILED in Node too: ${error.message}`);
    console.log(
      "\nverdict    The site refuses an ordinary anonymous request from anywhere.",
    );
    console.log(
      "           Not a Proxy problem and not an Extraction problem. Summary-only is the honest outcome.",
    );
    return;
  } finally {
    clearTimeout(timer);
  }

  const html = await response.text();
  console.log(
    `fetch      HTTP ${response.status}, ${html.length} chars, final ${response.url}`,
  );
  if (!response.ok) {
    console.log(
      `\nverdict    The publisher answered ${response.status} to an anonymous request. Nothing to extract.`,
    );
    return;
  }

  const purify = purifierFor(windowFor("", opts.url));
  const article = extractArticle(html, {
    url: response.url || opts.url,
    windowFor,
    Readability,
    purify,
  });

  console.log(
    `extract    ok=${article.ok} reason=${article.reason ?? "none"} words=${article.wordCount} images=${article.imageUrls.length}`,
  );
  console.log(`title      ${article.title || "(none)"}`);

  if (opts.save) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const path = join(
      FIXTURE_DIR,
      opts.save.endsWith(".html") ? opts.save : `${opts.save}.html`,
    );
    writeFileSync(path, html);
    console.log(`fixture    ${path}`);
  }

  console.log("");
  if (article.ok) {
    console.log(
      `verdict    Extraction works here: ${article.wordCount} words from the same URL, with no CORS in the way.`,
    );
    if (browserSide && browserSide.withArticle === 0) {
      console.log(
        "           The app got nothing, so the fault is TRANSPORT, not Extraction:",
      );
      console.log(
        `           the Proxy. In the app this Publication reported "${browserSide.lastError}".`,
      );
    } else {
      console.log(
        "           If the app disagrees, compare word counts before suspecting the Proxy.",
      );
    }
    return;
  }

  if (article.reason === "too-short") {
    console.log(
      `verdict    The page really does carry only ${article.wordCount} words of prose, under the ${MIN_ARTICLE_WORDS}-word floor.`,
    );
    console.log(
      "           Usually a paywall teaser. ADR-0004 says we stop here, so Summary-only is correct",
    );
    console.log(
      "           and the only bug worth filing is the UI failing to say so honestly.",
    );
    return;
  }

  console.log(
    "verdict    Readability found no prose on a page that fetched fine. This one is OURS.",
  );
  console.log(
    `           Save it with --save <name> and add a case to test/extract.test.js.`,
  );
}

main().catch((error) => {
  console.error(`qa-diagnose failed: ${error.message}`);
  process.exit(1);
});
