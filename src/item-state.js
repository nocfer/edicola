// The reader's own state on Items — Read, Saved and Reading Position — read
// and written in one place.
//
// A Sync never touches these fields (`upsertItems` merges only the Feed's own
// fields, see store.js), and three screens need them: Today for its Unread
// chips and "mark all read", Publications for the same two per Publication,
// the Saved screen for the Saved list and unsaving, and the Reader for Read,
// Saved and the Reading Position. Keeping the queries here means the "0 | 1"
// rule for `items.saved`, the `savedAt` stamp and the Unread predicate are
// written once.
//
// The Dexie handle is a parameter, never imported, so this module loads under
// Node and every rule that is not a query is unit tested. `SyncStore`
// (store.js) is deliberately the Sync pipeline's interface and has no read
// path for a screen, which is why these take `db` directly — the same call
// ticket 09 made for Today's Item query.

import { clampPosition } from "./reading-position.js";
import { timeOf } from "./retention.js";

/** @typedef {import('./db.js').EdicolaDb} EdicolaDb */
/** @typedef {import('./db.js').ItemRow} ItemRow */

/**
 * `items.saved` is `0 | 1`, not a boolean: IndexedDB cannot index a boolean
 * and the schema indexes that column (db.js). Both values are written
 * explicitly so a row is never left with `undefined` outside the index.
 */
export const SAVED = 1;
/** The unsaved value of `items.saved`. */
export const UNSAVED = 0;

/**
 * Whether an Item is Unread. Opening an Item in the Reader is what marks it
 * Read (CONTEXT.md); `read` is a plain boolean, so a missing field is Unread.
 *
 * @param {ItemRow} item
 * @returns {boolean}
 */
export function isUnread(item) {
  return !item.read;
}

/**
 * When an Item was Saved, in epoch ms. `savedAt` is stamped by `setItemSaved`;
 * an Item Saved before that field existed falls back to its publication date,
 * so a legacy row sorts among the Items it was published beside rather than
 * jumping to either end of the Saved list.
 *
 * @param {ItemRow} item
 * @returns {number}
 */
export function savedAtOf(item) {
  const stamped = timeOf(/** @type {any} */ (item)?.savedAt);
  if (Number.isFinite(stamped)) return stamped;
  const published = timeOf(item?.publishedAt);
  return Number.isFinite(published) ? published : 0;
}

/**
 * Comparator: most recently Saved first, ties by id ascending — the same
 * deterministic tie-break the Retention planners use.
 *
 * @param {ItemRow} a
 * @param {ItemRow} b
 * @returns {number}
 */
export function compareBySavedNewestFirst(a, b) {
  const ta = savedAtOf(a);
  const tb = savedAtOf(b);
  if (ta !== tb) return ta > tb ? -1 : 1;
  const ia = String(a.id);
  const ib = String(b.id);
  if (ia === ib) return 0;
  return ia < ib ? -1 : 1;
}

/**
 * Every Saved Item, most recently Saved first. One indexed lookup on `saved`,
 * which is why that column is stored as `0 | 1`.
 *
 * @param {EdicolaDb} db
 * @returns {Promise<ItemRow[]>}
 */
export async function savedItems(db) {
  const rows = await db.items.where("saved").equals(SAVED).toArray();
  rows.sort(compareBySavedNewestFirst);
  return rows;
}

/**
 * The fields a Saved or unsaved Item carries. Separate from the write because
 * `item-actions.js` flips the icon optimistically, before the write resolves,
 * and it must flip it to exactly what the database is about to hold — the
 * `0 | 1` rule and the `savedAt` stamp are declared here, once.
 *
 * @param {boolean} saved
 * @param {number} [now] Epoch ms.
 * @returns {{ saved: 0 | 1, savedAt: number | null }}
 */
export function savedFields(saved, now = Date.now()) {
  return saved
    ? { saved: SAVED, savedAt: now }
    : { saved: UNSAVED, savedAt: null };
}

/**
 * Save or unsave one Item. A Saved Item and its Article are never Evicted
 * (CONTEXT.md), and `savedAt` records when so the Saved screen can list
 * newest-Saved first. Unsaving clears the stamp rather than keeping a stale
 * one.
 *
 * @param {EdicolaDb} db
 * @param {string} itemId
 * @param {boolean} saved
 * @param {number} [now] Epoch ms.
 * @returns {Promise<{ saved: 0 | 1, savedAt: number | null }>}
 */
export async function setItemSaved(db, itemId, saved, now = Date.now()) {
  const next = savedFields(saved, now);
  await db.items.update(itemId, next);
  return next;
}

/**
 * Store a Reading Position on an Item, clamped into 0…1.
 *
 * @param {EdicolaDb} db
 * @param {string} itemId
 * @param {number} position
 * @returns {Promise<number>}
 */
export async function setReadingPosition(db, itemId, position) {
  const readingPosition = clampPosition(position);
  await db.items.update(itemId, { readingPosition });
  return readingPosition;
}

/**
 * Unread Items per Publication, by indexed query: one range on the
 * `publicationId` index per Publication, counted while streaming, so no Item
 * row is materialized and no table is scanned.
 *
 * @param {EdicolaDb} db
 * @param {Iterable<string>} publicationIds
 * @returns {Promise<Map<string, number>>}
 */
export async function countUnreadByPublication(db, publicationIds) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const id of publicationIds) {
    if (counts.has(id)) continue;
    const count = await db.items
      .where("publicationId")
      .equals(id)
      .filter(isUnread)
      .count();
    counts.set(id, count);
  }
  return counts;
}

/**
 * Mark every Item of one Publication Read, and resolve with how many changed.
 *
 * The write covers the Publication's whole index range, not only the Items
 * inside Today's window: "mark all read" that left older Items Unread would be
 * a lie the next Retention pass exposes (ticket 09's decision, kept here now
 * that both screens call it).
 *
 * @param {EdicolaDb} db
 * @param {string} publicationId
 * @returns {Promise<number>}
 */
export async function markPublicationRead(db, publicationId) {
  return await db.items
    .where("publicationId")
    .equals(publicationId)
    .filter(isUnread)
    .modify({ read: true });
}

/**
 * Mark one Item **Seen**: a Story Frame showed it (ticket 03).
 *
 * Seen is not Read, and this write must never become one. CONTEXT.md says
 * opening an Item in the Reader is what marks it Read and scrolling past it
 * does not, and a Frame is not an opening — so a ring dims while the
 * Publication's Unread count does not move. That is the guarantee the whole
 * rings design rests on, which is why `seen` is the only field written here.
 *
 * Tolerant of an Item that no longer exists: a reel can outlive a Retention
 * trim by a few taps, and a Frame that cannot record itself is not worth an
 * error the reader would see. Resolves with how many rows changed.
 *
 * @param {EdicolaDb} db
 * @param {string} itemId
 * @returns {Promise<number>}
 */
export async function markItemSeen(db, itemId) {
  return await db.items.update(itemId, { seen: true });
}
