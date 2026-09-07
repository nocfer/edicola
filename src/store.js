// The storage seam the Sync pipeline talks to.
//
// `src/sync.js` never sees Dexie: it takes a `SyncStore` as a parameter, so the
// pipeline test can hand it an in-memory object (test/sync.test.js) and the app
// hands it `getSyncStore()`, the implementation over the real database. Keeping
// the interface this small is what makes the highest seam in the app testable
// in Node, where IndexedDB does not exist.
//
// Everything that mutates more than one table does so inside one Dexie
// transaction, so a Sync interrupted mid-write cannot leave an Article without
// its Item flag or images without their Article.

import { getDatabase, imageKeyFor, META_KEYS } from "./db.js";
import { DEFAULT_RETENTION, planItemTrim } from "./retention.js";

/** @typedef {import('./db.js').EdicolaDb} EdicolaDb */
/** @typedef {import('./db.js').PublicationRow} PublicationRow */
/** @typedef {import('./db.js').ItemRow} ItemRow */
/** @typedef {import('./db.js').ArticleRow} ArticleRow */
/** @typedef {import('./db.js').ImageRow} ImageRow */

/**
 * One image handed to `putImages`. The store derives the primary key from the
 * URL itself (`imageKeyFor`), so the pipeline never computes a hash.
 * @typedef {object} ImageInput
 * @property {string} url
 * @property {Blob} blob
 * @property {number} [bytes] Defaults to `blob.size`.
 */

/**
 * Outcome of one Publication's Feed fetch, recorded on the Publication row.
 * @typedef {object} PublicationSyncStatus
 * @property {number} at Epoch ms of the attempt.
 * @property {string | null} [error] Failure kind, or null/omitted on success.
 */

/**
 * Everything `runSync` needs from storage, and nothing else. Fields the reader
 * owns (`read`, `saved`, `readingPosition`) are never overwritten by a Sync:
 * `upsertItems` merges Feed fields into an existing row and leaves the rest.
 *
 * @typedef {object} SyncStore
 * @property {() => Promise<PublicationRow[]>} getEnabledPublications
 *   Every Publication with `enabled` truthy.
 * @property {(items: ItemRow[]) => Promise<number>} upsertItems
 *   Insert new Items and refresh the Feed fields of known ones; resolves with
 *   the number of rows written.
 * @property {(publicationIds: string[]) => Promise<Map<string, ItemRow[]>>} itemsNeedingArticles
 *   Items with no Article and not Summary-only, grouped per Publication in the
 *   order the ids were given (`planArticleFetches` round-robins that order).
 * @property {(article: ArticleRow) => Promise<void>} putArticle
 *   Store the Article and flag its Item `hasArticle`, clearing any earlier
 *   Summary-only mark.
 * @property {(itemId: string, images: ImageInput[]) => Promise<number>} putImages
 *   Store an Article's images; resolves with the bytes written.
 * @property {(itemId: string, reason: string) => Promise<void>} markSummaryOnly
 *   Record that this Item has no Article, and why.
 * @property {(publicationId: string, status: PublicationSyncStatus) => Promise<void>} setPublicationSynced
 * @property {(at: number) => Promise<void>} setLastSyncAt
 *   Write the `lastSyncAt` row of `meta`.
 * @property {(publicationId: string, limits?: { keepPerPublication?: number }) => Promise<string[]>} trimItems
 *   Apply `planItemTrim` to one Publication and delete what falls out, with the
 *   Items' Articles and images; resolves with the deleted Item ids.
 * @property {() => Promise<ItemRow[]>} allItems
 *   Every stored Item. The Eviction seam (src/evict.js): the age and size
 *   passes are global, so they cannot be answered one Publication at a time.
 * @property {() => Promise<Map<string, number>>} articleBytesByItem
 *   Bytes stored per Item id — its Article's HTML plus its images — which is
 *   what `planEviction`'s size pass weighs.
 * @property {(itemIds: string[]) => Promise<void>} deleteItems
 *   Delete these Items with their Articles and images, in one transaction.
 * @property {(key: string) => Promise<unknown>} getMeta
 * @property {(key: string, value: unknown) => Promise<void>} setMeta
 */

/** Fields a Sync may refresh on an Item it has seen before. */
const FEED_FIELDS = [
  "feedItemId",
  "title",
  "link",
  "publishedAt",
  "summaryHtml",
  "summaryText",
  "thumbnailUrl",
];

/**
 * A `SyncStore` over a Dexie handle.
 * @param {EdicolaDb} [db]
 * @returns {SyncStore}
 */
export function createSyncStore(db = getDatabase()) {
  /**
   * Delete Items with their Articles and images, in one transaction, so a
   * delete interrupted halfway cannot leave an Article or an image blob
   * without the Item that owned it. An image shared by two Articles is stored
   * once, under whichever Item fetched it first (ticket 10), so deleting that
   * Item takes the blob and the other Article falls back to the network for
   * that one picture.
   * @param {string[]} itemIds
   * @returns {Promise<void>}
   */
  async function deleteItemsWithContent(itemIds) {
    if (itemIds.length === 0) return;
    await db.transaction("rw", [db.items, db.articles, db.images], async () => {
      await db.items.bulkDelete(itemIds);
      await db.articles.bulkDelete(itemIds);
      await db.images.where("itemId").anyOf(itemIds).delete();
    });
  }

  return {
    async getEnabledPublications() {
      return await db.publications.filter((p) => Boolean(p.enabled)).toArray();
    },

    async upsertItems(items) {
      if (items.length === 0) return 0;
      const rows = await db.transaction("rw", db.items, async () => {
        const ids = items.map((item) => item.id);
        const existing = await db.items.bulkGet(ids);
        const merged = items.map((item, i) => {
          const previous = existing[i];
          if (!previous) return item;
          const next = { ...previous };
          for (const field of FEED_FIELDS) next[field] = item[field];
          return next;
        });
        await db.items.bulkPut(merged);
        return merged.length;
      });
      return rows;
    },

    async itemsNeedingArticles(publicationIds) {
      /** @type {Map<string, ItemRow[]>} */
      const byPublication = new Map();
      for (const id of publicationIds) {
        const items = await db.items
          .where("publicationId")
          .equals(id)
          .toArray();
        byPublication.set(
          id,
          items.filter((item) => !item.hasArticle && !item.summaryOnly),
        );
      }
      return byPublication;
    },

    async putArticle(article) {
      await db.transaction("rw", [db.articles, db.items], async () => {
        await db.articles.put(article);
        await db.items.update(article.itemId, {
          hasArticle: true,
          summaryOnly: false,
          summaryOnlyReason: null,
        });
      });
    },

    async putImages(itemId, images) {
      if (images.length === 0) return 0;
      /** @type {ImageRow[]} */
      const rows = [];
      for (const image of images) {
        rows.push({
          key: await imageKeyFor(image.url),
          url: image.url,
          blob: image.blob,
          bytes: image.bytes ?? image.blob.size,
          itemId,
        });
      }
      await db.images.bulkPut(rows);
      return rows.reduce((total, row) => total + row.bytes, 0);
    },

    async markSummaryOnly(itemId, reason) {
      await db.items.update(itemId, {
        summaryOnly: true,
        summaryOnlyReason: reason,
        hasArticle: false,
      });
    },

    async setPublicationSynced(publicationId, status) {
      await db.publications.update(publicationId, {
        lastSyncedAt: status.at,
        lastError: status.error ?? null,
      });
    },

    async setLastSyncAt(at) {
      await db.meta.put({ key: META_KEYS.lastSyncAt, value: at });
    },

    async trimItems(publicationId, limits = {}) {
      const { keepPerPublication = DEFAULT_RETENTION.keepPerPublication } =
        limits;
      const items = await db.items
        .where("publicationId")
        .equals(publicationId)
        .toArray();
      const doomed = planItemTrim(items, { keepPerPublication });
      await deleteItemsWithContent(doomed);
      return doomed;
    },

    async allItems() {
      return await db.items.toArray();
    },

    async articleBytesByItem() {
      /** @type {Map<string, number>} */
      const bytes = new Map();
      /** @param {string} itemId @param {unknown} size */
      const add = (itemId, size) => {
        if (!itemId) return;
        const n = Number(size);
        if (!Number.isFinite(n) || n <= 0) return;
        bytes.set(itemId, (bytes.get(itemId) ?? 0) + n);
      };
      // Streamed with `each` rather than `toArray`, so measuring the images
      // table does not hold every blob in memory at once (ticket 12's call).
      await db.articles.each((/** @type {ArticleRow} */ row) => {
        add(row.itemId, row.bytes);
      });
      await db.images.each((/** @type {ImageRow} */ row) => {
        add(row.itemId, row.bytes);
      });
      return bytes;
    },

    async deleteItems(itemIds) {
      await deleteItemsWithContent(itemIds);
    },

    async getMeta(key) {
      const row = await db.meta.get(key);
      return row?.value;
    },

    async setMeta(key, value) {
      await db.meta.put({ key, value });
    },
  };
}

/** @type {SyncStore | null} */
let shared = null;

/**
 * The app's one `SyncStore`, over the app's one database handle.
 * @returns {SyncStore}
 */
export function getSyncStore() {
  if (!shared) shared = createSyncStore();
  return shared;
}
