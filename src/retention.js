// Retention planners: pure functions that decide which Items fall outside
// Retention and must be Evicted. No I/O, no DOM, no i18n. The Sync worker
// runs these after each Sync and deletes what they return (with the Items'
// Articles and images); Settings (ticket 12) reads DEFAULT_RETENTION for the
// values it shows and resets to.
//
// Every planner is deterministic: ties on equal dates are broken by id, so
// the same records and limits always yield the same ids in the same order.

/**
 * The minimal Item shape the planners consume. Ticket 07 aligns the Dexie
 * `items` table to these fields; extra fields are carried through untouched.
 *
 * @typedef {object} ItemRecord
 * @property {string} id Stable id, unique across Publications.
 * @property {string} publicationId Id of the Publication whose Feed listed it.
 * @property {number} publishedAt Publication date as epoch milliseconds. ISO
 *   strings and Dates are tolerated; a missing or invalid date sorts oldest.
 * @property {boolean} [saved] Saved Items are never trimmed or Evicted.
 * @property {boolean} [hasArticle] An Article has been stored for this Item.
 * @property {boolean} [summaryOnly] Extraction failed or yielded too little.
 *   No longer final on its own: see `attempts`.
 * @property {string | null} [summaryOnlyReason] Why there is no Article. Two
 *   reasons are final whatever the count (`no-link`, `not-found`); every other
 *   reason describes one attempt, not the page.
 * @property {number} [attempts] Article fetches a Sync has spent on this Item.
 *   Absent on rows written before the field existed, which reads as zero.
 */

/**
 * The Retention limits. Every planner takes the subset it needs and falls
 * back to DEFAULT_RETENTION for anything missing.
 *
 * @typedef {object} RetentionLimits
 * @property {number} maxAgeDays Unsaved Items older than this are Evicted.
 * @property {number} maxTotalBytes Cap on the bytes of all stored Articles.
 * @property {number} maxImageBytesPerArticle Cap on image bytes per Article,
 *   applied by Extraction; carried here so Settings has one source of truth.
 * @property {number} keepPerPublication Unsaved Items kept per Publication.
 * @property {number} prefetchPerPublication Articles Pre-fetched per
 *   Publication per Sync.
 */

/** @type {Readonly<RetentionLimits>} */
export const DEFAULT_RETENTION = Object.freeze({
  maxAgeDays: 30,
  maxTotalBytes: 500 * 2 ** 20,
  maxImageBytesPerArticle: 5 * 2 ** 20,
  keepPerPublication: 50,
  prefetchPerPublication: 10,
});

/**
 * Article fetches a Sync spends on one Item before its failure is taken as
 * final. NOT a Retention limit the reader can change: it is a property of how
 * unreliable publishers are, not of how much the reader wants stored.
 *
 * Three, because a Publication was measured serving the Article on roughly
 * three of five identical requests and a 39-word stub on the rest, so three
 * attempts leave about 6% of its Items unrecovered where one attempt lost 40%.
 * The stably-gated Publications pay two extra requests per Item, once, and
 * then fall out of the candidate set for good.
 */
export const MAX_ARTICLE_ATTEMPTS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * UTF-8 byte length of a string. Here because it is the Retention size
 * accounting's own unit: what `planEviction` weighs and what `articles.bytes`
 * stores, written by both the Sync pipeline and the Reader's on-demand fetch.
 *
 * @param {string} text
 * @returns {number}
 */
export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * Epoch milliseconds of a date-like value; -Infinity when missing or invalid,
 * so an undated record sorts as the oldest.
 *
 * @param {number | string | Date | null | undefined} value
 * @returns {number}
 */
export function timeOf(value) {
  if (value == null) return -Infinity;
  const ms = value instanceof Date ? value.getTime() : Number(new Date(value));
  return Number.isNaN(ms) ? -Infinity : ms;
}

/**
 * Comparator: oldest `publishedAt` first, ties by id.
 *
 * @param {ItemRecord} a
 * @param {ItemRecord} b
 * @returns {number}
 */
function compareItemsOldestFirst(a, b) {
  const ta = timeOf(a.publishedAt);
  const tb = timeOf(b.publishedAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return compareIds(a.id, b.id);
}

/**
 * Comparator: newest `publishedAt` first, ties by id.
 *
 * @param {ItemRecord} a
 * @param {ItemRecord} b
 * @returns {number}
 */
export function compareItemsNewestFirst(a, b) {
  const ta = timeOf(a.publishedAt);
  const tb = timeOf(b.publishedAt);
  if (ta !== tb) return ta > tb ? -1 : 1;
  return compareIds(a.id, b.id);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareIds(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

/**
 * Group Items by Publication, preserving the order in which each Publication
 * first appears.
 *
 * @param {Iterable<ItemRecord>} items
 * @returns {Map<string, ItemRecord[]>}
 */
export function groupByPublication(items) {
  /** @type {Map<string, ItemRecord[]>} */
  const groups = new Map();
  for (const item of items) {
    const key = String(item.publicationId);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * Ids of Items beyond the per-Publication count, oldest first. Within each
 * Publication the newest `keepPerPublication` unsaved Items stay; Saved Items
 * are exempt and do not take up a slot, so saving never pushes an unsaved
 * Item out of the window.
 *
 * @param {Iterable<ItemRecord>} items
 * @param {{ keepPerPublication?: number }} [limits]
 * @returns {string[]}
 */
export function planItemTrim(items, limits = {}) {
  const { keepPerPublication = DEFAULT_RETENTION.keepPerPublication } = limits;
  const keep = Math.max(0, Math.floor(keepPerPublication));
  /** @type {ItemRecord[]} */
  const trimmed = [];
  for (const group of groupByPublication(items).values()) {
    const unsaved = group.filter((item) => !item.saved);
    unsaved.sort(compareItemsNewestFirst);
    trimmed.push(...unsaved.slice(keep));
  }
  trimmed.sort(compareItemsOldestFirst);
  return trimmed.map((item) => item.id);
}

/**
 * Bytes stored for each Item's Article (HTML plus images), keyed by Item id.
 * Items with no entry are treated as taking no space.
 *
 * @typedef {Map<string, number>} ArticleSizeById
 */

/**
 * Which Items to Evict and how many bytes that frees.
 *
 * Two passes, both skipping Saved Items:
 * 1. Age: every Item published before `now - maxAgeDays`.
 * 2. Size: if the bytes still stored (Saved Items included) exceed
 *    `maxTotalBytes`, more Items oldest first until under the cap. Items whose
 *    Article takes no space are skipped here, since deleting them frees
 *    nothing.
 *
 * `deleteItemIds` lists the age pass first, then the size pass, each oldest
 * first with ties by id.
 *
 * @param {Iterable<ItemRecord>} items
 * @param {ArticleSizeById} articlesSizeById
 * @param {{ maxAgeDays?: number, maxTotalBytes?: number }} [limits]
 * @param {number | Date} [now] Defaults to `Date.now()`.
 * @returns {{ deleteItemIds: string[], bytesFreed: number }}
 */
export function planEviction(items, articlesSizeById, limits = {}, now) {
  const {
    maxAgeDays = DEFAULT_RETENTION.maxAgeDays,
    maxTotalBytes = DEFAULT_RETENTION.maxTotalBytes,
  } = limits;
  const nowMs = now === undefined ? Date.now() : timeOf(now);
  const cutoff = nowMs - maxAgeDays * MS_PER_DAY;
  const sizeOf = sizeLookup(articlesSizeById);

  const all = Array.from(items).sort(compareItemsOldestFirst);
  /** @type {string[]} */
  const deleteItemIds = [];
  let bytesFreed = 0;
  let bytesStored = 0;
  /** @type {ItemRecord[]} */
  const candidates = [];

  for (const item of all) {
    const bytes = sizeOf(item.id);
    if (!item.saved && timeOf(item.publishedAt) < cutoff) {
      deleteItemIds.push(item.id);
      bytesFreed += bytes;
      continue;
    }
    bytesStored += bytes;
    if (!item.saved && bytes > 0) candidates.push(item);
  }

  for (const item of candidates) {
    if (bytesStored <= maxTotalBytes) break;
    const bytes = sizeOf(item.id);
    deleteItemIds.push(item.id);
    bytesFreed += bytes;
    bytesStored -= bytes;
  }

  return { deleteItemIds, bytesFreed };
}

/**
 * Bytes for one Item id, never negative and never NaN. An absent entry, a
 * missing Map and a nonsense value all read as zero: an Item whose Article
 * takes no space frees nothing by being Evicted.
 *
 * Exported because `evict.js` weighs the same Map when it reports `bytesFreed`,
 * and a second copy of this rule there would be a second place for "what counts
 * as no bytes" to drift.
 *
 * @param {ArticleSizeById | null | undefined} sizes
 * @returns {(id: string) => number}
 */
export function sizeLookup(sizes) {
  return (id) => {
    const n = Number(sizes?.get(String(id)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
}
