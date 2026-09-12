// "How much space am I using?", and the two destructive answers to it.
//
// ADR-0003 put every byte of content in one IndexedDB database precisely so
// this is one pass rather than a reconciliation between two stores. The browser
// only tells us a rounded per-origin total (`navigator.storage.estimate()`),
// which includes the Shell cache and is padded for privacy, so the per-table
// breakdown below is measured from the rows themselves and the two numbers are
// shown side by side rather than pretended to be the same figure.
//
// The database handle, the estimate function and the `meta` reader are all
// parameters, never imports, so this module is importable and testable under
// Node where neither IndexedDB nor `navigator.storage` exists.

import { LANG_KEY } from "./i18n.js";

/**
 * The tables measured, in the order the screen lists them. Matches version 1 of
 * the schema in `db.js`; a table added by a later migration must be added here
 * too or its bytes go unreported.
 * @type {ReadonlyArray<string>}
 */
export const STORAGE_TABLES = Object.freeze([
  "publications",
  "items",
  "articles",
  "images",
  "settings",
  "meta",
]);

/**
 * localStorage keys "Reset app" clears. Mirrors `THEME_KEY` in main.js (which
 * keeps it private) and `LANG_KEY` in i18n.js.
 * @type {ReadonlyArray<string>}
 */
export const PREFERENCE_KEYS = Object.freeze(["edicola.theme", LANG_KEY]);

/** Bytes per UTF-16 code unit is wrong for text; measure UTF-8 properly. */
const encoder = new TextEncoder();

/**
 * Rough byte size of one stored value. Strings are measured as UTF-8, Blobs by
 * `size` (the bytes IndexedDB actually holds), numbers as a double, and objects
 * and arrays recursively with a couple of bytes of structural overhead per key.
 * An estimate by design: IndexedDB's own encoding is not observable, and the
 * reader needs an order of magnitude, not an audit.
 * @param {unknown} value
 * @returns {number}
 */
export function estimateValueBytes(value) {
  if (value == null) return 0;
  if (typeof value === "string") return encoder.encode(value).length;
  if (typeof value === "number") return 8;
  if (typeof value === "boolean") return 1;
  if (typeof value === "bigint") return 8;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Date) return 8;
  if (Array.isArray(value)) {
    let total = 0;
    for (const entry of value) total += estimateValueBytes(entry) + 2;
    return total;
  }
  if (typeof value === "object") {
    let total = 0;
    for (const [key, entry] of Object.entries(value)) {
      total += encoder.encode(key).length + estimateValueBytes(entry) + 2;
    }
    return total;
  }
  return 0;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * Human-readable byte count, in 1024-based steps with the familiar KB/MB/GB
 * labels. Locale-aware through `Intl.NumberFormat`, so Italian reads "1,4 MB".
 * @param {number | null | undefined} bytes
 * @param {string} [locale]
 * @returns {string}
 */
export function formatBytes(bytes, locale = "en") {
  if (bytes == null) return "—";
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted} ${UNITS[unit]}`;
}

/**
 * One table's contribution to the total.
 * @typedef {object} TableUsage
 * @property {string} table
 * @property {number} rows
 * @property {number} bytes
 */

/**
 * What the Storage card shows.
 * @typedef {object} StorageUsage
 * @property {number | null} usage Bytes the browser attributes to this origin
 *   (Shell cache included, padded), or null where the API is absent.
 * @property {number | null} quota Bytes the browser is willing to grant, or null.
 * @property {TableUsage[]} tables Per-table breakdown, `STORAGE_TABLES` order.
 * @property {number} tablesBytes Sum of `tables[].bytes` — the content only.
 * @property {boolean | 'unsupported' | null} persistent The answer
 *   `navigator.storage.persist()` gave, as recorded in `meta`; null = not asked.
 * @property {number} enabledPublications How many Publications are Enabled.
 * @property {number} savedItems How many Items are Saved (`saved === 1`).
 * @property {number} measuredAt Epoch ms of this measurement.
 */

/**
 * Count and size every table, and read the two facts that belong beside them.
 * Rows are streamed with Dexie's `each` and never retained, so measuring an
 * image table does not hold every blob in memory at once.
 *
 * @param {object} deps
 * @param {import('./db.js').EdicolaDb} deps.db
 * @param {() => Promise<{usage?: number, quota?: number}>} [deps.estimate]
 *   Defaults to `navigator.storage.estimate()`, or a null result without it.
 * @param {(key: string) => Promise<unknown>} [deps.getMeta]
 *   Reader for the `meta` table; the screen passes `getSyncStore().getMeta`.
 * @param {string} [deps.persistentStorageKey] `META_KEYS.persistentStorage`.
 * @param {() => number} [deps.now]
 * @returns {Promise<StorageUsage>}
 */
export async function readStorageUsage({
  db,
  estimate = defaultEstimate,
  getMeta = async () => null,
  persistentStorageKey = "persistentStorage",
  now = Date.now,
}) {
  /** @type {TableUsage[]} */
  const tables = [];
  let enabledPublications = 0;
  let savedItems = 0;

  for (const name of STORAGE_TABLES) {
    const table = db[name];
    if (!table) continue;
    let bytes = 0;
    let rows = 0;
    await table.each((/** @type {any} */ row) => {
      rows += 1;
      bytes += estimateValueBytes(row);
      if (name === "publications" && row.enabled) enabledPublications += 1;
      if (name === "items" && (row.saved === 1 || row.saved === true))
        savedItems += 1;
    });
    tables.push({ table: name, rows, bytes });
  }

  /** @type {{usage?: number, quota?: number}} */
  const empty = {};
  const [estimated, persistent] = await Promise.all([
    estimate().catch(() => empty),
    getMeta(persistentStorageKey).catch(() => null),
  ]);

  return {
    usage: numberOrNull(estimated?.usage),
    quota: numberOrNull(estimated?.quota),
    tables,
    tablesBytes: tables.reduce((total, entry) => total + entry.bytes, 0),
    persistent: /** @type {any} */ (persistent ?? null),
    enabledPublications,
    savedItems,
    measuredAt: now(),
  };
}

/** @param {unknown} value */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `navigator.storage.estimate()` where the browser has it. */
async function defaultEstimate() {
  const storage = globalThis.navigator?.storage;
  if (typeof storage?.estimate !== "function") return {};
  return await storage.estimate();
}

/**
 * How many Publications are Enabled. A cheap standalone count, so the Sync card
 * can be honest about "nothing enabled" without measuring every table.
 * @param {import('./db.js').EdicolaDb} db
 * @returns {Promise<number>}
 */
export async function countEnabledPublications(db) {
  let count = 0;
  await db.publications.each((/** @type {any} */ row) => {
    if (row.enabled) count += 1;
  });
  return count;
}

/**
 * What "Clear all content" removed.
 * @typedef {object} ClearedContent
 * @property {number} items
 * @property {number} articles
 * @property {number} images
 */

/**
 * Drop every Item, Article and image, keeping the reader's Enabled Publications
 * and their settings. Also forgets when the last Sync happened and each
 * Publication's own Sync stamp, so the next Sync refills the newsstand instead
 * of deciding the content is fresh (`syncIfStale` reads `meta.lastSyncAt`).
 *
 * @param {import('./db.js').EdicolaDb} db
 * @param {{ lastSyncAtKey?: string }} [options] Pass `META_KEYS.lastSyncAt`.
 * @returns {Promise<ClearedContent>}
 */
export async function clearContent(db, { lastSyncAtKey = "lastSyncAt" } = {}) {
  const counted = {
    items: await db.items.count(),
    articles: await db.articles.count(),
    images: await db.images.count(),
  };
  await db.transaction(
    "rw",
    [db.items, db.articles, db.images, db.publications, db.meta],
    async () => {
      await db.items.clear();
      await db.articles.clear();
      await db.images.clear();
      await db.publications.toCollection().modify((/** @type {any} */ row) => {
        row.lastSyncedAt = null;
        row.lastError = null;
      });
      await db.meta.delete(lastSyncAtKey);
    },
  );
  return counted;
}

/**
 * Delete the database and the reader's preferences: a factory reset. The Shell
 * cache is deliberately left alone — it is the app's own files, not the
 * reader's data (ADR-0007), and deleting it would leave the app unable to open
 * offline until the next online load. The caller reloads afterwards.
 *
 * @param {import('./db.js').EdicolaDb} db
 * @returns {Promise<void>}
 */
export async function resetApp(db) {
  await db.delete();
  for (const key of PREFERENCE_KEYS) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Storage disabled: the preference was never persisted anyway.
    }
  }
  try {
    globalThis.sessionStorage?.clear();
  } catch {
    // Same: nothing to clear.
  }
}
