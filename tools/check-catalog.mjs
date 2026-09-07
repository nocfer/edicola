// Catalog validator and health check.
//
// Offline mode validates `data/catalog.json` against the entry schema in
// `docs/catalog.md`: unique slug ids, ISO country and language codes, https
// URLs, Categories from the Catalog's own list. `--fetch` additionally requests
// every feedUrl (concurrency 4, 15 s timeout) and checks that the response is a
// 200 that looks like a Feed. Both modes exit 1 on any problem.
//
// Usage:
//   node tools/check-catalog.mjs            # schema only
//   node tools/check-catalog.mjs --fetch    # schema + network, prints a table
//   import { validateCatalog } from "./tools/check-catalog.mjs"

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const CATALOG_PATH = resolve(ROOT, "data/catalog.json");

/** The Categories a Publication may be filed under. */
export const CATEGORIES = [
  "news",
  "politics",
  "business",
  "technology",
  "science",
  "culture",
  "sport",
  "local",
];

const ENTRY_KEYS = new Set([
  "id",
  "name",
  "country",
  "language",
  "category",
  "feedUrl",
  "siteUrl",
  "truncated",
  "note",
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REGION = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "none",
});
const LANGUAGE = new Intl.DisplayNames(["en"], {
  type: "language",
  fallback: "none",
});

const FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 15_000;
// Deliberately not a browser string: at least one publisher answers 406 to
// anything starting with "Mozilla/5.0" that is not a real browser.
const USER_AGENT =
  "Edicola catalog health check (+https://github.com/nocfer/edicola)";

/**
 * @typedef {object} Publication
 * @property {string} id
 * @property {string} name
 * @property {string} country
 * @property {string} language
 * @property {string} category
 * @property {string} feedUrl
 * @property {string} siteUrl
 * @property {boolean} truncated
 * @property {string} [note]
 */

/**
 * @typedef {object} Catalog
 * @property {number} version
 * @property {string[]} categories
 * @property {Publication[]} publications
 */

/**
 * @typedef {object} Problem
 * @property {string} where  Entry id, or `publications[i]` when the id is unusable, or `catalog`.
 * @property {string} message
 */

/** True for a string that parses as a URL with the https scheme. */
function isHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// Two-letter codes ICU names but ISO 3166-1 does not assign: the user-assigned
// ranges (AA, QM-QZ, XA-XZ, ZZ) and CLDR's exceptionally reserved extras.
const NOT_ISO_REGION = /^(?:AA|Q[M-Z]|X[A-Z]|ZZ|UK|EU|UN)$/;

/** ISO 3166-1 alpha-2 check via ICU: unknown codes yield no display name. */
function isCountryCode(value) {
  return (
    typeof value === "string" &&
    /^[A-Z]{2}$/.test(value) &&
    !NOT_ISO_REGION.test(value) &&
    REGION.of(value) !== undefined
  );
}

/** ISO 639-1 check via ICU: unknown codes yield no display name. */
function isLanguageCode(value) {
  return (
    typeof value === "string" &&
    /^[a-z]{2}$/.test(value) &&
    LANGUAGE.of(value) !== undefined
  );
}

/**
 * Validate a parsed Catalog offline. Returns one Problem per violation; an
 * empty array means the Catalog is clean.
 *
 * @param {unknown} catalog  The parsed contents of `data/catalog.json`.
 * @returns {Problem[]}
 */
export function validateCatalog(catalog) {
  /** @type {Problem[]} */
  const problems = [];
  const add = (where, message) => problems.push({ where, message });

  if (
    typeof catalog !== "object" ||
    catalog === null ||
    Array.isArray(catalog)
  ) {
    add("catalog", "top level must be an object");
    return problems;
  }
  const c = /** @type {Record<string, unknown>} */ (catalog);

  if (c.version !== 1) add("catalog", "version must be 1");

  const topKeys = new Set(["version", "categories", "publications"]);
  for (const key of Object.keys(c))
    if (!topKeys.has(key)) add("catalog", `unknown top-level key '${key}'`);

  /** @type {Set<string>} */
  let categories = new Set();
  if (!Array.isArray(c.categories) || c.categories.length === 0) {
    add("catalog", "categories must be a non-empty array");
  } else {
    for (const cat of c.categories) {
      if (typeof cat !== "string" || !CATEGORIES.includes(cat))
        add("catalog", `unknown category '${String(cat)}'`);
      else if (categories.has(cat))
        add("catalog", `duplicate category '${cat}'`);
      else categories.add(cat);
    }
  }
  if (categories.size === 0) categories = new Set(CATEGORIES);

  if (!Array.isArray(c.publications)) {
    add("catalog", "publications must be an array");
    return problems;
  }

  const ids = new Set();
  const feedUrls = new Map();
  c.publications.forEach((entry, i) => {
    const fallback = `publications[${i}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      add(fallback, "entry must be an object");
      return;
    }
    const e = /** @type {Record<string, unknown>} */ (entry);
    const where = typeof e.id === "string" && e.id.length > 0 ? e.id : fallback;

    for (const key of Object.keys(e))
      if (!ENTRY_KEYS.has(key)) add(where, `unknown key '${key}'`);

    if (typeof e.id !== "string" || !SLUG.test(e.id))
      add(where, "id must be a lowercase slug (a-z, 0-9, single hyphens)");
    else if (ids.has(e.id)) add(where, `duplicate id '${e.id}'`);
    else ids.add(e.id);

    if (typeof e.name !== "string" || e.name.trim().length === 0)
      add(where, "name must be a non-empty string");

    if (!isCountryCode(e.country))
      add(where, "country must be an ISO 3166-1 alpha-2 code, upper case");

    if (!isLanguageCode(e.language))
      add(where, "language must be an ISO 639-1 code, lower case");

    if (typeof e.category !== "string" || !categories.has(e.category))
      add(where, `category must be one of: ${[...categories].join(", ")}`);

    if (!isHttpsUrl(e.feedUrl)) add(where, "feedUrl must be an https URL");
    else if (feedUrls.has(e.feedUrl))
      add(where, `feedUrl already used by '${feedUrls.get(e.feedUrl)}'`);
    else feedUrls.set(e.feedUrl, where);

    if (!isHttpsUrl(e.siteUrl)) add(where, "siteUrl must be an https URL");

    if (typeof e.truncated !== "boolean")
      add(where, "truncated must be a boolean");

    if ("note" in e && (typeof e.note !== "string" || e.note.trim() === ""))
      add(where, "note, when present, must be a non-empty string");
  });

  return problems;
}

/**
 * Decide whether a response body looks like a Feed: an XML document whose root
 * element is `rss`, `feed` or `rdf:RDF`, or a JSON object with an `items`
 * array. Returns the detected kind, or null.
 *
 * @param {string} body
 * @returns {"rss" | "atom" | "rdf" | "json" | null}
 */
export function feedKind(body) {
  const text = body.replace(/^\uFEFF/, "").trimStart();
  if (text.startsWith("{")) {
    try {
      const json = JSON.parse(text);
      return json && Array.isArray(json.items) ? "json" : null;
    } catch {
      return null;
    }
  }
  const head = text
    .slice(0, 4096)
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/i, "")
    .trimStart();
  const root = head.match(/^<([A-Za-z_][\w.:-]*)/)?.[1]?.toLowerCase();
  if (root === "rss") return "rss";
  if (root === "feed") return "atom";
  if (root === "rdf:rdf") return "rdf";
  return null;
}

/**
 * @typedef {object} FetchResult
 * @property {string} id
 * @property {string} feedUrl
 * @property {boolean} ok
 * @property {string} status  HTTP status, or the error name.
 * @property {string} detail  Feed kind on success, reason on failure.
 */

/**
 * Fetch one Feed with a timeout and classify the result.
 *
 * @param {Publication} publication
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<FetchResult>}
 */
async function checkFeed(publication, fetchImpl) {
  const { id, feedUrl } = publication;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(feedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, application/json;q=0.9, */*;q=0.5",
      },
    });
    const status = String(res.status);
    if (res.status !== 200) {
      return { id, feedUrl, ok: false, status, detail: "not 200" };
    }
    const body = await res.text();
    const kind = feedKind(body);
    if (!kind) {
      return { id, feedUrl, ok: false, status, detail: "not a feed" };
    }
    return { id, feedUrl, ok: true, status, detail: kind };
  } catch (err) {
    const name =
      err instanceof Error && err.name === "AbortError"
        ? "timeout"
        : err instanceof Error
          ? err.name
          : "error";
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { id, feedUrl, ok: false, status: name, detail: cause };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch every Feed in the Catalog, four at a time, preserving Catalog order.
 *
 * @param {Catalog} catalog
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<FetchResult[]>}
 */
export async function fetchCatalog(catalog, fetchImpl = fetch) {
  const queue = [...catalog.publications];
  /** @type {FetchResult[]} */
  const results = new Array(queue.length);
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const i = next++;
      results[i] = await checkFeed(queue[i], fetchImpl);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, worker),
  );
  return results;
}

/**
 * Render fetch results as a Markdown table, failures first.
 *
 * @param {FetchResult[]} results
 * @returns {string}
 */
export function renderTable(results) {
  const rows = [...results].sort((a, b) => Number(a.ok) - Number(b.ok));
  const lines = [
    "| Result | Publication | Status | Detail | Feed |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    const cells = [
      r.ok ? "ok" : "FAIL",
      r.id,
      r.status,
      r.detail,
      r.feedUrl,
    ].map((c) => String(c).replace(/\|/g, "\\|"));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

async function main() {
  const withFetch = process.argv.includes("--fetch");
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));

  const problems = validateCatalog(catalog);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p.where} — ${p.message}`);
    console.error(
      `\n${problems.length} schema problem(s) in data/catalog.json.`,
    );
    process.exit(1);
  }
  console.log(
    `✔ Schema clean: ${catalog.publications.length} Publications in data/catalog.json.`,
  );
  if (!withFetch) return;

  const results = await fetchCatalog(catalog);
  const failing = results.filter((r) => !r.ok).length;
  console.log("");
  console.log(renderTable(results));
  console.log("");
  if (failing) {
    console.log(`${failing} feeds failing out of ${results.length}.`);
    process.exit(1);
  }
  console.log(`0 feeds failing out of ${results.length}.`);
}

// CLI entry.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
