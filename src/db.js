// Dexie choke point (ADR-0002, ADR-0003): the only file in the app that names
// the Dexie CDN URL, and the only place the schema is declared. IndexedDB is
// the single store for content — Items, Articles, image blobs, read state,
// settings and the meta row — so Retention, Eviction and "how much space am I
// using" are one query and a delete cannot orphan a blob in a second system.
//
// MIGRATIONS ARE ADDITIVE ONLY (ADR-0008). Never rename a table, never drop
// one, never remove a field another version might still read: add a new table
// or a new index in a new `db.version(n).stores({...})` block and copy forward
// in its `upgrade`. The failure this rule prevents is losing a reader's Saved
// Articles, which no amount of tidiness justifies. `SCHEMA_VERSION` below and
// the `schemaVersion` row in `meta` must move together with the version blocks.
//
// IndexedDB cannot index a boolean (valid keys are number, string, Date,
// ArrayBuffer and Array), so an indexed flag is stored as `0 | 1`: `items.saved`
// is the only one. Non-indexed flags (`read`, `hasArticle`, `summaryOnly`,
// `truncated`, `custom`, `enabled`) are real booleans. `0` and `false` are both
// falsy, so the pure planners in retention.js and sync-plan.js read either.

// @ts-expect-error CDN URL imports have no type declarations under checkJs.
import { Dexie } from "https://esm.sh/dexie@4.4.5";

/** IndexedDB database name. Stable for the life of the app. */
export const DB_NAME = "edicola";

/** Current Dexie schema version; equals the highest `db.version(n)` below. */
export const SCHEMA_VERSION = 1;

/** App version stamped into `meta` (keep in step with package.json). */
export const APP_VERSION = "0.1.0";

/** Keys the `meta` table holds. */
export const META_KEYS = Object.freeze({
  schemaVersion: "schemaVersion",
  appVersion: "appVersion",
  lastSyncAt: "lastSyncAt",
  persistentStorage: "persistentStorage",
});

/**
 * A Publication, from the Catalog or added by the reader.
 * @typedef {object} PublicationRow
 * @property {string} id Catalog slug, or a generated id for a Custom Publication.
 * @property {string} name Display name.
 * @property {string} country ISO 3166-1 alpha-2, upper case (the Nation).
 * @property {string} language ISO 639-1, lower case.
 * @property {string} category One of the Catalog's Categories.
 * @property {string} feedUrl
 * @property {string} siteUrl
 * @property {boolean} truncated The Feed carries Summaries only.
 * @property {boolean} custom Added by the reader, not in the Catalog.
 * @property {boolean} enabled Only Enabled Publications take part in a Sync.
 * @property {number | null} [lastSyncedAt] Epoch ms of the last Feed fetch.
 * @property {string | null} [lastError] Failure kind of that fetch, or null.
 */

/**
 * One Feed entry, stored per Publication.
 * @typedef {object} ItemRow
 * @property {string} id `publicationId + ":" + feedItemId` — Feed ids are only
 *   unique within their own Feed (see ticket 02's notes).
 * @property {string} publicationId
 * @property {string} feedItemId The id as the Feed gave it.
 * @property {string} title Plain text.
 * @property {string | null} link The Original.
 * @property {number} publishedAt Epoch ms; the fetch time when the Feed had none.
 * @property {string} summaryHtml Sanitized (DOMPurify) Summary markup.
 * @property {string} summaryText Plain text of the Summary, for cards.
 * @property {string | null} thumbnailUrl
 * @property {boolean} read Set when the Item is opened in the Reader.
 * @property {0 | 1} saved Saved Items are never trimmed or Evicted (indexed, so 0/1).
 * @property {number} readingPosition Fraction of the Article last scrolled to.
 * @property {boolean} summaryOnly No Article: Extraction failed or yielded too little.
 * @property {string | null} summaryOnlyReason Why, e.g. `too-short`, `blocked`.
 * @property {boolean} hasArticle An Article is stored for this Item.
 * @property {number} fetchedAt Epoch ms the Sync first stored this Item.
 */

/**
 * The extracted Article for one Item.
 * @typedef {object} ArticleRow
 * @property {string} itemId Primary key; the Item's id.
 * @property {string} title
 * @property {string | null} byline
 * @property {string} html Sanitized Article markup.
 * @property {number} wordCount
 * @property {number} bytes UTF-8 byte length of `html`.
 * @property {number} extractedAt Epoch ms.
 */

/**
 * One stored image of an Article.
 * @typedef {object} ImageRow
 * @property {string} key Primary key: sha-256 hex of `url` (see `imageKeyFor`).
 * @property {string} url Absolute source URL.
 * @property {Blob} blob The bytes.
 * @property {number} bytes `blob.size`.
 * @property {string} itemId The Item whose Article references it.
 */

/** @typedef {{ key: string, value: unknown }} KeyValueRow */

/**
 * The Dexie database handle, with the tables typed loosely (Dexie's own types
 * are unavailable behind a CDN URL under checkJs).
 * @typedef {object} EdicolaDb
 * @property {any} publications
 * @property {any} items
 * @property {any} articles
 * @property {any} images
 * @property {any} settings
 * @property {any} meta
 * @property {(...args: any[]) => any} transaction
 * @property {(event: string, handler: (...args: any[]) => any) => any} on
 * @property {() => Promise<void>} open
 * @property {() => void} close
 * @property {() => Promise<void>} delete
 * @property {string} name
 */

/**
 * Declare the schema on a fresh Dexie handle. Split out from `getDatabase` so
 * a test or a tool can open a differently named copy.
 *
 * Version 1 tables (primary key first, then indexes):
 * - `publications` — `id`, plus `country` and `category` so ticket 08 can list
 *   the Catalog by Nation and Category without a full scan. `enabled` is not
 *   indexed on purpose: it is a boolean (see the header note) and the whole
 *   table is at most a few dozen rows.
 * - `items` — `id`, plus `publicationId`, `publishedAt`, `saved` and the
 *   compound `[publicationId+publishedAt]` for one Publication's newest Items.
 * - `articles` — `itemId`.
 * - `images` — `key`, plus `itemId` to delete an Article's images in one query.
 * - `settings`, `meta` — `key`.
 *
 * @param {string} [name]
 * @returns {EdicolaDb}
 */
export function createDatabase(name = DB_NAME) {
  const db = new Dexie(name);
  db.version(1).stores({
    publications: "id, country, category",
    items: "id, publicationId, publishedAt, saved, [publicationId+publishedAt]",
    articles: "itemId",
    images: "key, itemId",
    settings: "key",
    meta: "key",
  });
  return db;
}

/** @type {EdicolaDb | null} */
let handle = null;

/**
 * The app's one database handle, opened lazily. Stamps `schemaVersion` and
 * `appVersion` into `meta` on the first call so ADR-0008's version guard has
 * something to compare against.
 * @returns {EdicolaDb}
 */
export function getDatabase() {
  if (!handle) {
    const db = createDatabase();
    db.on("ready", () =>
      db.meta.bulkPut([
        { key: META_KEYS.schemaVersion, value: SCHEMA_VERSION },
        { key: META_KEYS.appVersion, value: APP_VERSION },
      ]),
    );
    handle = db;
  }
  return handle;
}

/**
 * Primary key of a stored image: the sha-256 of its URL as lower-case hex, so
 * the same image referenced by two Articles is stored once and a key never
 * grows with the URL. Uses Web Crypto, present in the page and in Node 20+.
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function imageKeyFor(url) {
  const bytes = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
