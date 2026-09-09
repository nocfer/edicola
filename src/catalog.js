// The Catalog (ADR-0005): the list shipped in `data/catalog.json`, merged with
// the reader's own `publications` table, plus the first-run inference of Nations
// and Language (ADR-0006) and the "add by URL" lookup behind the Publications
// screen.
//
// Two kinds of function live here, in this order:
//
// 1. Pure functions — the merge, the grouping, the locale inference, the Custom
//    Publication id and the Feed-language guess. They take plain data and are
//    the unit-tested part (test/catalog-merge.test.js).
// 2. Database and network glue — every one takes the Dexie handle or a fetcher
//    as a parameter. Nothing here imports `db.js`, so this module (and its
//    test) import cleanly under Node, where the Dexie CDN URL cannot resolve.
//    The Publications screen passes `getDatabase()`.
//
// Reader preferences are **not** here. The Nation selection is a setting, so it
// lives in `src/settings.js` (`getNations` / `setNations`) and reaches
// `loadPublications` as a parameter; the Language lives in
// `localStorage['edicola.lang']` (`src/i18n.js`). This module reads the
// `publications` table and nothing else.

import { discoverFeeds, FeedParseError, parseFeed } from "./feed.js";
import { FetchFailure } from "./fetcher.js";

/** Where the shipped Catalog lives, relative to this module. */
const CATALOG_URL = new URL("../data/catalog.json", import.meta.url).href;

/**
 * Group key the Publications screen files Custom Publications under, instead of
 * their Category: a reader's own Feed is not a curated Catalog section.
 */
export const CUSTOM_GROUP = "custom";

/**
 * Nation a Language points at when the browser locale carries no region
 * subtag. The seed Catalog holds Italy and the United Kingdom (ADR-0005), so
 * `it` means Italy and every other English locale means the UK for now; adding
 * a Nation to the Catalog means adding a line here.
 */
const LANGUAGE_NATION = Object.freeze({ it: "IT", en: "GB" });

/** Category a Custom Publication is stored with; the screen groups it apart. */
const CUSTOM_CATEGORY = "news";

/** @typedef {import('./db.js').PublicationRow} PublicationRow */
/** @typedef {import('./db.js').EdicolaDb} EdicolaDb */
/** @typedef {import('./i18n.js').Lang} Lang */

/**
 * One entry of the shipped Catalog (see `tools/check-catalog.mjs`).
 * @typedef {object} CatalogPublication
 * @property {string} id Slug, unique in the file.
 * @property {string} name
 * @property {string} country ISO 3166-1 alpha-2, upper case.
 * @property {string} language ISO 639-1, lower case.
 * @property {string} category One of the file's own `categories`.
 * @property {string} feedUrl
 * @property {string} siteUrl
 * @property {boolean} truncated
 * @property {string} [note]
 */

/**
 * The shipped Catalog file.
 * @typedef {object} Catalog
 * @property {number} version
 * @property {string[]} categories Display order for the Category groups.
 * @property {CatalogPublication[]} publications
 */

/**
 * A Publication as the screen shows it: a `PublicationRow` plus where it came
 * from. `inCatalog` is false for a Custom Publication and for a Catalog entry
 * that has since been removed but is still Enabled.
 * @typedef {PublicationRow & { inCatalog: boolean, note: string|null }} CatalogEntry
 */

/**
 * One Category's Publications inside one Nation.
 * @typedef {object} CategoryGroup
 * @property {string} category A Catalog Category, or `CUSTOM_GROUP`.
 * @property {CatalogEntry[]} publications
 */

/**
 * One Nation's Publications, grouped by Category.
 * @typedef {object} NationGroup
 * @property {string} country
 * @property {CategoryGroup[]} groups
 */

// --- 1. Pure functions -----------------------------------------------------

/**
 * First-run defaults from the browser's locale list (ADR-0006): which Nations
 * to show and which Language to speak. Both are inferred from the same tags but
 * stay independent afterwards.
 *
 * A tag contributes its region subtag when the Catalog has that Nation
 * (`en-GB` → GB), else the Nation its Language points at (`it` → IT, any other
 * `en` → GB). A locale that points nowhere in the Catalog (say `fr-FR`) shows
 * every Nation rather than an empty screen. The Language is the first tag that
 * is Italian or English, English otherwise.
 *
 * @param {readonly string[]} languages Usually `navigator.languages`.
 * @param {readonly string[]} availableNations Nations the Catalog offers.
 * @returns {{ nations: string[], lang: Lang }}
 */
export function inferPreferences(languages, availableNations) {
  const available = new Set(availableNations || []);
  const tags = (Array.isArray(languages) ? languages : []).filter(
    (tag) => typeof tag === "string" && tag.trim().length > 0,
  );
  /** @type {string[]} */
  const nations = [];
  /** @type {Lang | null} */
  let lang = null;
  for (const tag of tags) {
    const parts = tag.trim().toLowerCase().split(/[-_]/);
    const base = parts[0];
    if (!lang && (base === "it" || base === "en")) lang = base;
    const region = parts
      .slice(1)
      .find((part) => /^[a-z]{2}$/.test(part))
      ?.toUpperCase();
    for (const candidate of [region, LANGUAGE_NATION[base]]) {
      if (!candidate) continue;
      if (available.has(candidate) && !nations.includes(candidate)) {
        nations.push(candidate);
      }
    }
  }
  return {
    nations: nations.length > 0 ? nations : [...available],
    lang: lang || "en",
  };
}

/**
 * Merge the shipped Catalog with the `publications` table — the screen's whole
 * data model, and the only place the two disagree is resolved:
 *
 * - A Catalog entry is shown with the Catalog's own fields (a renamed or
 *   re-categorised Publication updates itself) and the reader's `enabled`,
 *   `lastSyncedAt` and `lastError` from the stored row.
 * - A stored Catalog Publication that has left the Catalog stays while it is
 *   Enabled, with `inCatalog: false` so the screen can say so; once switched
 *   off it disappears with the entry.
 * - A Custom Publication is passed through untouched.
 *
 * Order is the Catalog's own, then the leftover rows in table order.
 *
 * @param {Catalog | null | undefined} catalog
 * @param {readonly PublicationRow[]} [rows] The `publications` table.
 * @returns {CatalogEntry[]}
 */
export function mergeCatalog(catalog, rows = []) {
  const stored = Array.isArray(rows) ? rows : [];
  const byId = new Map(stored.map((row) => [row.id, row]));
  const shipped = Array.isArray(catalog?.publications)
    ? catalog.publications
    : [];
  const fromCatalog = new Set();
  /** @type {CatalogEntry[]} */
  const entries = [];

  for (const publication of shipped) {
    const row = byId.get(publication.id);
    fromCatalog.add(publication.id);
    entries.push({
      id: publication.id,
      name: publication.name,
      country: publication.country,
      language: publication.language,
      category: publication.category,
      feedUrl: publication.feedUrl,
      siteUrl: publication.siteUrl,
      truncated: Boolean(publication.truncated),
      custom: false,
      enabled: Boolean(row?.enabled),
      lastSyncedAt: row?.lastSyncedAt ?? null,
      lastError: row?.lastError ?? null,
      inCatalog: true,
      note: publication.note ?? null,
    });
  }

  for (const row of stored) {
    if (fromCatalog.has(row.id)) continue;
    const custom = Boolean(row.custom);
    if (!custom && !row.enabled) continue;
    entries.push({
      ...row,
      truncated: Boolean(row.truncated),
      custom,
      enabled: Boolean(row.enabled),
      lastSyncedAt: row.lastSyncedAt ?? null,
      lastError: row.lastError ?? null,
      inCatalog: false,
      note: null,
    });
  }

  return entries;
}

/**
 * Every Nation present in the merged entries, in order of appearance (so the
 * Catalog's order, then any Nation only a Custom Publication belongs to).
 * @param {readonly CatalogEntry[]} entries
 * @returns {string[]}
 */
export function nationsOf(entries) {
  /** @type {string[]} */
  const nations = [];
  for (const entry of entries || []) {
    if (entry.country && !nations.includes(entry.country)) {
      nations.push(entry.country);
    }
  }
  return nations;
}

/**
 * Group entries by Nation and then by Category, ready to render. Nations keep
 * the order of `nationsOf`; Categories follow the Catalog file's own
 * `categories` order, with any unknown Category after them and Custom
 * Publications (grouped under `CUSTOM_GROUP`) last.
 * @param {readonly CatalogEntry[]} entries
 * @param {readonly string[]} [categories] The Catalog's display order.
 * @returns {NationGroup[]}
 */
export function groupByNation(entries, categories = []) {
  const order = new Map((categories || []).map((name, i) => [name, i]));
  const unknownRank = order.size;
  const rankOf = (category) =>
    category === CUSTOM_GROUP
      ? unknownRank + 1
      : (order.get(category) ?? unknownRank);

  /** @type {Map<string, Map<string, CatalogEntry[]>>} */
  const byNation = new Map();
  for (const entry of entries || []) {
    if (!byNation.has(entry.country)) byNation.set(entry.country, new Map());
    const groups = /** @type {Map<string, CatalogEntry[]>} */ (
      byNation.get(entry.country)
    );
    const key = entry.custom ? CUSTOM_GROUP : entry.category;
    if (!groups.has(key)) groups.set(key, []);
    /** @type {CatalogEntry[]} */ (groups.get(key)).push(entry);
  }

  return [...byNation].map(([country, groups]) => ({
    country,
    groups: [...groups]
      .map(([category, publications]) => ({ category, publications }))
      .sort((a, b) => {
        const byRank = rankOf(a.category) - rankOf(b.category);
        return byRank !== 0 ? byRank : a.category.localeCompare(b.category);
      }),
  }));
}

/**
 * Id of a Custom Publication: `custom:` plus a 32-bit FNV-1a hash of its Feed
 * URL as eight hex digits. A Catalog id is a slug (`^[a-z0-9]+(-[a-z0-9]+)*$`),
 * so the colon makes a collision impossible, and the same Feed added twice
 * lands on the same row instead of a duplicate.
 * @param {string} feedUrl
 * @returns {string}
 */
export function customPublicationId(feedUrl) {
  const key = String(feedUrl ?? "").trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `custom:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Guess a Custom Publication's Nation and Language from the Feed's declared
 * language, e.g. `it-IT` → Italy/Italian, `en` → the UK/English. Both are
 * editable in the form; this only fills it in.
 * @param {string | null | undefined} feedLanguage As the Feed declared it.
 * @param {{ country?: string, language?: string }} [fallback] Used when the
 *   Feed declares nothing useful — typically the reader's first Nation.
 * @returns {{ country: string, language: string }}
 */
export function guessOrigin(feedLanguage, fallback = {}) {
  const parts = String(feedLanguage ?? "")
    .trim()
    .toLowerCase()
    .split(/[-_]/);
  const base = parts[0] || "";
  const language = /^[a-z]{2,3}$/.test(base)
    ? base
    : (fallback.language || "en").toLowerCase();
  const region = parts.slice(1).find((part) => /^[a-z]{2}$/.test(part));
  const country =
    region?.toUpperCase() ||
    LANGUAGE_NATION[language] ||
    (fallback.country || "GB").toUpperCase();
  return { country, language };
}

// --- 2. Database and network glue -----------------------------------------

/**
 * Fetch the shipped Catalog. Same-origin Shell data, so it goes through the
 * plain `fetch` and the service worker's Shell cache, not the content fetcher
 * (ADR-0001 governs Feeds and Originals).
 * @param {typeof globalThis.fetch} [fetchImpl]
 * @returns {Promise<Catalog>}
 */
async function loadCatalog(fetchImpl = (url) => globalThis.fetch(url)) {
  const response = await fetchImpl(CATALOG_URL);
  if (!response.ok) {
    throw new Error(`Catalog request failed with ${response.status}`);
  }
  return /** @type {Catalog} */ (await response.json());
}

/**
 * Everything the Publications screen needs for one render.
 * @typedef {object} PublicationsData
 * @property {Catalog} catalog
 * @property {CatalogEntry[]} entries
 * @property {string[]} nations Every Nation the entries cover.
 * @property {string[]} selectedNations Always at least one.
 * @property {string[]|null} inferredNations The selection the browser locale
 *   suggests, non-null only when it did not come from the stored one, so the
 *   caller knows it is the caller's to persist.
 * @property {Lang|null} inferredLang The Language the browser locale suggests,
 *   set only on first run so the caller can apply it (ADR-0006).
 */

/**
 * Load the Catalog, merge it with the `publications` table and resolve the
 * Nation selection, seeding it from the browser locale on first run.
 *
 * The stored selection comes in as `selectedNations` and the seeded one goes
 * out as `inferredNations`: this module reads and writes the `publications`
 * table only, and the caller owns the `settings` row (`src/settings.js`).
 * An empty or missing `selectedNations` is the first-run signal.
 *
 * @param {EdicolaDb} db
 * @param {object} [options]
 * @param {readonly string[]} [options.languages] Usually `navigator.languages`.
 * @param {Catalog} [options.catalog] Skip the fetch (tests, or a cached copy).
 * @param {readonly string[]} [options.selectedNations] The stored selection.
 * @returns {Promise<PublicationsData>}
 */
export async function loadPublications(
  db,
  { languages = [], catalog, selectedNations: stored = [] } = {},
) {
  const file = catalog ?? (await loadCatalog());
  const rows = await db.publications.toArray();
  const entries = mergeCatalog(file, rows);
  const nations = nationsOf(entries);
  const saved = (Array.isArray(stored) ? stored : []).filter(
    (n) => typeof n === "string" && n.length > 0,
  );

  /** @type {Lang|null} */
  let inferredLang = null;
  /** @type {string[]|null} */
  let inferredNations = null;
  let selected = saved.filter((n) => nations.includes(n));
  if (selected.length === 0) {
    const inferred = inferPreferences(languages, nations);
    // A reader who has chosen before keeps their Language: only a genuine
    // first run (nothing stored at all) may suggest one.
    inferredLang = saved.length === 0 ? inferred.lang : null;
    selected = inferred.nations;
    if (selected.length > 0) inferredNations = [...selected];
  }
  return {
    catalog: file,
    entries,
    nations,
    selectedNations: selected.length > 0 ? selected : nations.slice(0, 1),
    inferredNations,
    inferredLang,
  };
}

/**
 * The stored shape of an entry: a `PublicationRow`, without the two display
 * fields the merge adds.
 * @param {CatalogEntry} entry
 * @returns {PublicationRow}
 */
function rowFor(entry) {
  return {
    id: entry.id,
    name: entry.name,
    country: entry.country,
    language: entry.language,
    category: entry.category,
    feedUrl: entry.feedUrl,
    siteUrl: entry.siteUrl,
    truncated: Boolean(entry.truncated),
    custom: Boolean(entry.custom),
    enabled: Boolean(entry.enabled),
    lastSyncedAt: entry.lastSyncedAt ?? null,
    lastError: entry.lastError ?? null,
  };
}

/**
 * Switch a Publication on or off. The row is written in full, so a Catalog
 * entry the reader has never touched is created on the spot, and its Sync
 * history (`lastSyncedAt`, `lastError`) survives a toggle.
 * @param {EdicolaDb} db
 * @param {CatalogEntry} entry
 * @param {boolean} enabled
 * @returns {Promise<PublicationRow>}
 */
export async function setPublicationEnabled(db, entry, enabled) {
  const existing = await db.publications.get(entry.id);
  const row = {
    ...rowFor(entry),
    enabled: Boolean(enabled),
    lastSyncedAt: existing?.lastSyncedAt ?? entry.lastSyncedAt ?? null,
    lastError: existing?.lastError ?? entry.lastError ?? null,
  };
  await db.publications.put(row);
  return row;
}

/**
 * What "add by URL" needs to create a Custom Publication.
 * @typedef {object} CustomPublicationInput
 * @property {string} feedUrl
 * @property {string} [name] Defaults to the Feed URL's hostname.
 * @property {string} country
 * @property {string} language
 * @property {string} [siteUrl] Defaults to the Feed URL's origin.
 * @property {boolean} [truncated]
 * @property {boolean} [enabled] Defaults to true: the reader just asked for it.
 */

/**
 * Create (or update) a Custom Publication from the add-by-URL form.
 * @param {EdicolaDb} db
 * @param {CustomPublicationInput} input
 * @returns {Promise<PublicationRow>}
 */
export async function addCustomPublication(db, input) {
  const feedUrl = String(input.feedUrl || "").trim();
  if (!feedUrl) throw new RangeError("A Custom Publication needs a Feed URL");
  const id = customPublicationId(feedUrl);
  const existing = await db.publications.get(id);
  /** @type {PublicationRow} */
  const row = {
    id,
    name: String(input.name || "").trim() || hostnameOf(feedUrl) || feedUrl,
    country: String(input.country || "").toUpperCase(),
    language: String(input.language || "").toLowerCase(),
    category: CUSTOM_CATEGORY,
    feedUrl,
    siteUrl: input.siteUrl || originOf(feedUrl) || feedUrl,
    truncated: input.truncated !== false,
    custom: true,
    enabled: input.enabled !== false,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    lastError: existing?.lastError ?? null,
  };
  await db.publications.put(row);
  return row;
}

/**
 * Remove a Custom Publication and forget it. Catalog entries are switched off
 * rather than deleted, so this refuses anything that is not Custom.
 * @param {EdicolaDb} db
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeCustomPublication(db, id) {
  const row = await db.publications.get(id);
  if (!row?.custom) throw new RangeError(`${id} is not a Custom Publication`);
  await db.publications.delete(id);
}

/**
 * Why an "add by URL" lookup failed. `kind` is the fetcher's own vocabulary
 * (`offline`, `blocked`, `not-found`, `timeout`, `too-large`,
 * `proxy-unconfigured`) plus two of this module's own, so the screen can say
 * something honest: offline is not the same as blocked by the publisher.
 */
export class FeedLookupError extends Error {
  /**
   * @param {'invalid-url' | 'no-feed' | import('./fetcher.js').FetchFailureKind} kind
   * @param {string} url
   * @param {{ cause?: unknown }} [details]
   */
  constructor(kind, url, details = {}) {
    super(`Feed lookup failed (${kind}): ${url}`, { cause: details.cause });
    this.name = "FeedLookupError";
    /** @type {string} */
    this.kind = kind;
    /** @type {string} */
    this.url = url;
  }
}

/**
 * A Feed the lookup found and parsed.
 * @typedef {object} FeedFinding
 * @property {string} feedUrl
 * @property {string} title
 * @property {string|null} siteUrl
 * @property {string|null} description
 * @property {string|null} language As the Feed declared it.
 * @property {string} format `rss2` | `atom` | `rdf` | `json`
 * @property {number} itemCount
 * @property {boolean} truncated No Item carries full content.
 */

/** @param {string} url */
function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** @param {string} url */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * Accept what a reader would paste: a bare domain gets `https://`, and anything
 * that still does not parse as an http(s) URL is rejected before any request.
 * @param {string} input
 * @returns {string}
 */
export function normalizeFeedInput(input) {
  const text = String(input ?? "").trim();
  if (!text) throw new FeedLookupError("invalid-url", text);
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text)
    ? text
    : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new FeedLookupError("invalid-url", text);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new FeedLookupError("invalid-url", text);
  }
  return url.href;
}

/**
 * Parse one document as a Feed, or return null when it is not one.
 * @param {string} text
 * @param {string} url
 * @param {typeof globalThis.DOMParser} DOMParserImpl
 * @returns {FeedFinding | null}
 */
function readFeed(text, url, DOMParserImpl) {
  try {
    const feed = parseFeed(text, { url, DOMParser: DOMParserImpl });
    return {
      feedUrl: url,
      title: feed.title,
      siteUrl: feed.siteUrl,
      description: feed.description,
      language: feed.language,
      format: feed.format,
      itemCount: feed.items.length,
      truncated:
        feed.items.length === 0 ||
        feed.items.every((item) => !item.contentHtml),
    };
  } catch (error) {
    if (error instanceof FeedParseError) return null;
    throw error;
  }
}

/**
 * Fetch one URL through the app's fetcher, mapping a `FetchFailure` to a
 * `FeedLookupError` with the same `kind`.
 * @param {import('./fetcher.js').Fetcher} fetcher
 * @param {string} url
 * @returns {Promise<import('./fetcher.js').FetchTextResult>}
 */
async function fetchDocument(fetcher, url) {
  try {
    return await fetcher.fetchText(url);
  } catch (error) {
    if (error instanceof FetchFailure) {
      throw new FeedLookupError(error.kind, url, { cause: error });
    }
    throw error;
  }
}

/**
 * Find the Feeds behind a URL the reader pasted, which may be a Feed itself or
 * a site's home page.
 *
 * The document is fetched once and tried as a Feed first (`parseFeed`); when it
 * is not one, `discoverFeeds` supplies the candidates advertised in its HTML,
 * and each is fetched and parsed in turn. With nothing advertised those
 * candidates are the six conventional guesses, so probing stops at the first
 * one that parses.
 *
 * Rejects with a `FeedLookupError` whose `kind` is the fetcher's when the
 * network is the problem, or `no-feed` when everything fetched but nothing
 * parsed.
 *
 * @param {string} input What the reader typed.
 * @param {object} deps
 * @param {import('./fetcher.js').Fetcher} deps.fetcher
 * @param {typeof globalThis.DOMParser} deps.DOMParser
 * @param {number} [deps.limit] Most Feeds to return (default 4).
 * @param {number} [deps.maxProbes] Most candidates to fetch (default 6).
 * @returns {Promise<FeedFinding[]>}
 */
export async function findFeeds(
  input,
  { fetcher, DOMParser: DOMParserImpl, limit = 4, maxProbes = 6 },
) {
  if (typeof DOMParserImpl !== "function") {
    throw new TypeError("findFeeds needs a DOMParser implementation");
  }
  const target = normalizeFeedInput(input);
  const first = await fetchDocument(fetcher, target);
  const pageUrl = first.finalUrl || target;
  const direct = readFeed(first.text, pageUrl, DOMParserImpl);
  if (direct) return [direct];

  const candidates = discoverFeeds(first.text, {
    url: pageUrl,
    DOMParser: DOMParserImpl,
  });
  /** @type {FeedFinding[]} */
  const findings = [];
  let probes = 0;
  for (const candidate of candidates) {
    const enough = candidate.guess ? 1 : limit;
    if (findings.length >= enough || probes >= maxProbes) break;
    if (candidate.url === pageUrl || candidate.url === target) continue;
    probes += 1;
    let text;
    try {
      text = (await fetchDocument(fetcher, candidate.url)).text;
    } catch {
      continue;
    }
    const finding = readFeed(text, candidate.url, DOMParserImpl);
    if (finding) findings.push(finding);
  }
  if (findings.length === 0) throw new FeedLookupError("no-feed", target);
  return findings;
}
