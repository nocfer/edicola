// Eviction: applying the Retention planners against the store.
//
// `src/retention.js` decides *which* Items fall outside Retention — it is pure
// and already unit tested, and nothing here re-derives it. This module does
// the other half: read the Items and the bytes their Articles occupy, ask the
// planners, and delete what comes back together with each Item's Article and
// its images, in one transaction per batch (ADR-0003: one store, so a delete
// cannot orphan a blob in a second system).
//
// Two callers, one entry point:
//   - `runSync` calls it at the end of every run that had Publications to
//     fetch, which is spec story 34 ("Eviction runs automatically within
//     Retention").
//   - `views/settings.js` calls it when a Retention limit shrinks, through the
//     seam ticket 12 left for exactly this signature.
//
// **A Saved Item is never Evicted.** The planners already exempt Saved Items;
// the final id list is filtered against the Saved set again here, because that
// promise is the one this app must not break (CONTEXT.md) and one guard on the
// way out is cheaper than trusting two passes.
//
// The store is a parameter and this module imports only the planners, so it
// loads under Node and `test/evict.test.js` drives it with an in-memory store.

import { DEFAULT_RETENTION, planEviction, planItemTrim } from "./retention.js";

/** @typedef {import('./retention.js').RetentionLimits} RetentionLimits */
/** @typedef {import('./db.js').ItemRow} ItemRow */

/**
 * Items deleted per transaction. Small enough that one interrupted batch loses
 * little, large enough that a 500-Item Eviction is ten transactions and not
 * five hundred.
 */
export const EVICTION_BATCH_SIZE = 50;

/**
 * What Eviction needs from storage. `SyncStore` (src/store.js) satisfies it,
 * which is what lets both callers pass `getSyncStore()`; a test passes plain
 * Maps.
 *
 * @typedef {object} EvictionStore
 * @property {() => Promise<ItemRow[]>} allItems
 *   Every stored Item, any Publication, in any order.
 * @property {() => Promise<Map<string, number>>} articleBytesByItem
 *   Bytes stored per Item id: its Article's HTML plus its images.
 * @property {(itemIds: string[]) => Promise<void>} deleteItems
 *   Delete these Items with their Articles and images, in one transaction.
 */

/**
 * What one Eviction pass did. `deleted` is the Item ids, so a caller can say
 * how many went (ticket 12's Retention toast reads `deleted.length`) and a
 * test can say which.
 *
 * @typedef {object} EvictionResult
 * @property {string[]} deleted Item ids, in the order they were deleted.
 * @property {number} bytesFreed Article and image bytes those Items held.
 */

/**
 * Whether a store can be Evicted through. The Sync pipeline's test store
 * (test/sync.test.js) implements the Sync half of `SyncStore` only, so
 * `runSync` must not fail when handed one; this is the check that keeps
 * Eviction an addition to that seam rather than a change to it.
 *
 * @param {unknown} store
 * @returns {boolean}
 */
export function canEvict(store) {
  const candidate = /** @type {Partial<EvictionStore> | null} */ (store);
  return (
    Boolean(candidate) &&
    typeof candidate.allItems === "function" &&
    typeof candidate.articleBytesByItem === "function" &&
    typeof candidate.deleteItems === "function"
  );
}

/**
 * Evict everything outside Retention, and say what went.
 *
 * Three passes, in this order:
 * 1. `planItemTrim` — the per-Publication window (`keepPerPublication`).
 * 2. `planEviction` age pass — Items published before `now - maxAgeDays`.
 * 3. `planEviction` size pass — oldest first until the stored bytes are under
 *    `maxTotalBytes`.
 *
 * The trim runs first and its Items are withheld from the planner's input, so
 * the size pass accounts for the bytes the trim already frees instead of
 * Evicting an Item to reclaim space that was going anyway.
 *
 * A store with no Eviction seam yields an empty result rather than throwing:
 * see `canEvict`.
 *
 * @param {object} options
 * @param {EvictionStore} options.store
 * @param {Partial<RetentionLimits>} [options.limits]
 * @param {number | Date} [options.now] Epoch ms; defaults to `Date.now()`.
 * @param {number} [options.batchSize] Items per transaction.
 * @returns {Promise<EvictionResult>}
 */
export async function runEviction({
  store,
  limits = {},
  now = Date.now(),
  batchSize = EVICTION_BATCH_SIZE,
}) {
  if (!canEvict(store)) return { deleted: [], bytesFreed: 0 };

  const {
    keepPerPublication = DEFAULT_RETENTION.keepPerPublication,
    maxAgeDays = DEFAULT_RETENTION.maxAgeDays,
    maxTotalBytes = DEFAULT_RETENTION.maxTotalBytes,
  } = limits;

  const items = await store.allItems();
  if (items.length === 0) return { deleted: [], bytesFreed: 0 };
  const sizes = (await store.articleBytesByItem()) ?? new Map();
  const sizeOf = sizeLookup(sizes);

  const saved = new Set(items.filter((item) => item.saved).map((i) => i.id));
  const trimIds = planItemTrim(/** @type {any[]} */ (items), {
    keepPerPublication,
  });
  const trimmed = new Set(trimIds);
  const { deleteItemIds } = planEviction(
    /** @type {any[]} */ (items.filter((item) => !trimmed.has(item.id))),
    sizes,
    { maxAgeDays, maxTotalBytes },
    now,
  );

  /** @type {string[]} */
  const planned = [];
  const seen = new Set();
  for (const id of [...trimIds, ...deleteItemIds]) {
    // A Saved Item is never Evicted, whatever the planners return.
    if (seen.has(id) || saved.has(id)) continue;
    seen.add(id);
    planned.push(id);
  }

  /** @type {string[]} */
  const deleted = [];
  let bytesFreed = 0;
  const size = Math.max(1, Math.floor(batchSize));
  for (let i = 0; i < planned.length; i += size) {
    const batch = planned.slice(i, i + size);
    await store.deleteItems(batch);
    deleted.push(...batch);
    for (const id of batch) bytesFreed += sizeOf(id);
  }
  return { deleted, bytesFreed };
}

/**
 * Bytes for one Item id, from a Map or a plain object, never negative and
 * never NaN.
 *
 * @param {Map<string, number> | Record<string, number>} sizes
 * @returns {(id: string) => number}
 */
function sizeLookup(sizes) {
  const get =
    sizes instanceof Map
      ? (/** @type {string} */ id) => sizes.get(id)
      : (/** @type {string} */ id) => sizes[id];
  return (id) => {
    const n = Number(get(String(id)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
}
