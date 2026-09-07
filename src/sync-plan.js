// Sync planners: pure functions that turn Enabled Publications and their
// current Items into the order a Sync fetches in. No I/O, no DOM, no i18n.
// The Sync worker calls planFeedFetches before fetching Feeds and
// planArticleFetches before Pre-fetching Articles; both are deterministic so
// the pipeline tests can assert the exact fetch order.

import {
  DEFAULT_RETENTION,
  compareItemsNewestFirst,
  groupByPublication,
  timeOf,
} from "./retention.js";

/** @typedef {import("./retention.js").ItemRecord} ItemRecord */

/**
 * The minimal Publication shape the planners consume. Ticket 07 aligns the
 * Dexie `publications` table to these fields; extra fields are carried
 * through untouched.
 *
 * @typedef {object} PublicationRecord
 * @property {string} id Stable id (Catalog slug or a generated id for a
 *   Custom Publication).
 * @property {string} name Display name, used only as a tie-breaker.
 * @property {number | null} [lastSyncedAt] Epoch milliseconds of the last
 *   Sync that fetched this Feed; null or missing when it never ran.
 */

/**
 * The Publications to fetch, least recently synced first so a Publication
 * that keeps failing or stalling is not starved. Never-synced Publications
 * come first; ties are broken by name, then id. The input is not mutated.
 *
 * @param {Iterable<PublicationRecord>} enabledPublications
 * @returns {PublicationRecord[]}
 */
export function planFeedFetches(enabledPublications) {
  return Array.from(enabledPublications).sort(comparePublications);
}

/**
 * @param {PublicationRecord} a
 * @param {PublicationRecord} b
 * @returns {number}
 */
function comparePublications(a, b) {
  const ta = timeOf(a.lastSyncedAt);
  const tb = timeOf(b.lastSyncedAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  const na = String(a.name ?? "");
  const nb = String(b.name ?? "");
  if (na !== nb) return na < nb ? -1 : 1;
  const ia = String(a.id);
  const ib = String(b.id);
  if (ia === ib) return 0;
  return ia < ib ? -1 : 1;
}

/**
 * Items grouped per Publication, in Publication order. Accepted shapes:
 * - a `Map` from Publication id to that Publication's Items;
 * - an array of per-Publication Item arrays;
 * - a flat array of Items, grouped by `publicationId` in first-seen order.
 *
 * @typedef {Map<string, ItemRecord[]> | ItemRecord[][] | ItemRecord[]} ItemsByPublication
 */

/**
 * One interleaved queue of Items whose Articles a Sync should Pre-fetch.
 *
 * Per Publication only Items with no Article and not marked Summary-only are
 * considered, newest first, capped at `prefetchPerPublication`. The capped
 * lists are then merged round-robin: the newest Item of each Publication in
 * Publication order, then the second newest of each, and so on, so no single
 * large Feed monopolises the start of the queue. Publications that run out
 * simply drop out of later rounds.
 *
 * @param {ItemsByPublication} itemsByPublication
 * @param {{ prefetchPerPublication?: number }} [limits]
 * @returns {ItemRecord[]}
 */
export function planArticleFetches(itemsByPublication, limits = {}) {
  const { prefetchPerPublication = DEFAULT_RETENTION.prefetchPerPublication } =
    limits;
  const cap = Math.max(0, Math.floor(prefetchPerPublication));
  const lanes = groups(itemsByPublication).map((group) =>
    group
      .filter((item) => !item.hasArticle && !item.summaryOnly)
      .sort(compareItemsNewestFirst)
      .slice(0, cap),
  );
  /** @type {ItemRecord[]} */
  const queue = [];
  const longest = lanes.reduce((max, lane) => Math.max(max, lane.length), 0);
  for (let round = 0; round < longest; round++) {
    for (const lane of lanes) {
      if (round < lane.length) queue.push(lane[round]);
    }
  }
  return queue;
}

/**
 * @param {ItemsByPublication} input
 * @returns {ItemRecord[][]}
 */
function groups(input) {
  if (input instanceof Map) return Array.from(input.values());
  const iterable = /** @type {Iterable<unknown>} */ (input ?? []);
  /** @type {unknown[]} */
  const list = Array.from(iterable);
  if (list.length === 0) return [];
  if (list.every(Array.isArray)) {
    const nested = /** @type {ItemRecord[][]} */ (list);
    return nested;
  }
  const flat = /** @type {ItemRecord[]} */ (list);
  return Array.from(groupByPublication(flat).values());
}
