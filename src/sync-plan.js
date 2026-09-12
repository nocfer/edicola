// Sync planners: pure functions that turn Enabled Publications and their
// current Items into the order a Sync fetches in. No I/O, no DOM, no i18n.
// The Sync worker calls planFeedFetches before fetching Feeds and
// planArticleFetches before Pre-fetching Articles; both are deterministic so
// the pipeline tests can assert the exact fetch order.

import {
  DEFAULT_RETENTION,
  MAX_ARTICLE_ATTEMPTS,
  compareItemsNewestFirst,
  timeOf,
} from "./retention.js";

/** @typedef {import("./retention.js").ItemRecord} ItemRecord */

/** Milliseconds in a day, for the Eviction age cutoff. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Summary-only reasons a retry cannot change. `no-link` has no URL to try and
 * `not-found` is a 404, which `fetcher.js` already treats as final and never
 * retries through the Proxy. Every other reason describes one attempt and not
 * the page: `too-short` looks terminal and is not, because a publisher was
 * measured serving the Article on some requests and a 39-word stub on others.
 */
const TERMINAL_REASONS = new Set(["no-link", "not-found"]);

/**
 * Whether this Item is still worth an Article fetch. An Item that was never
 * marked Summary-only always is; one that was gets `MAX_ARTICLE_ATTEMPTS`
 * unless its reason is terminal.
 *
 * @param {ItemRecord} item
 * @returns {boolean}
 */
function worthAnotherAttempt(item) {
  if (!item.summaryOnly) return true;
  if (TERMINAL_REASONS.has(String(item.summaryOnlyReason))) return false;
  return (item.attempts ?? 0) < MAX_ARTICLE_ATTEMPTS;
}

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
 * Items grouped per Publication, in Publication order: a `Map` from Publication
 * id to that Publication's Items, which is exactly what
 * `SyncStore.itemsNeedingArticles` returns.
 *
 * @typedef {Map<string, ItemRecord[]>} ItemsByPublication
 */

/**
 * One interleaved queue of Items whose Articles a Sync should Pre-fetch.
 *
 * Per Publication only Items with no Article, still worth another attempt
 * (see `worthAnotherAttempt`), and
 * young enough to survive Eviction are considered, newest first, capped at
 * `prefetchPerPublication`. The capped lists are then merged round-robin: the
 * newest Item of each Publication in Publication order, then the second newest
 * of each, and so on, so no single large Feed monopolises the start of the
 * queue. Publications that run out simply drop out of later rounds.
 *
 * The age filter is not a nicety. Wired Italia's Feed serves thirty Items that
 * are all about seventy days old, and `maxAgeDays` is thirty: without it a Sync
 * fetched ten Articles and their images over the network and then Eviction
 * deleted every one of them in the same run, leaving the reader an empty
 * Publication that had cost them forty requests. Pre-fetching an Article for an
 * Item this Sync is about to Evict is work nobody can ever read.
 *
 * @param {ItemsByPublication} itemsByPublication
 * @param {{ prefetchPerPublication?: number, maxAgeDays?: number, now?: number }} [limits]
 * @returns {ItemRecord[]}
 */
export function planArticleFetches(itemsByPublication, limits = {}) {
  const {
    prefetchPerPublication = DEFAULT_RETENTION.prefetchPerPublication,
    maxAgeDays = DEFAULT_RETENTION.maxAgeDays,
    now = Date.now(),
  } = limits;
  const cap = Math.max(0, Math.floor(prefetchPerPublication));
  // `maxAgeDays` of 0 or less means Eviction keeps nothing on age, so no cutoff
  // could be honoured; a non-finite one means no age limit at all.
  const cutoff =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? now - maxAgeDays * MS_PER_DAY
      : Number.NEGATIVE_INFINITY;
  const lanes = [...(itemsByPublication?.values() ?? [])].map((group) =>
    group
      .filter(
        (item) =>
          !item.hasArticle &&
          worthAnotherAttempt(item) &&
          timeOf(item.publishedAt) >= cutoff,
      )
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
