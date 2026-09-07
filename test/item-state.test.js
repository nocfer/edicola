// The reader's own state on Items — Read, Saved and Reading Position — at its
// seam: given these rows, this query returns these Items in this order, and
// this write leaves those fields and nothing else.
//
// The Dexie handle is a parameter, so the double below is a tiny stand-in for
// the two calls these functions make: an indexed `where(...).equals(...)`
// range with an optional filter, and `update(id, patch)`. It records the field
// each query indexed on, which is what proves the Unread count and the Saved
// list go through an index rather than a table scan.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareBySavedNewestFirst,
  countUnreadByPublication,
  isUnread,
  markPublicationRead,
  SAVED,
  savedAtOf,
  savedItems,
  setItemSaved,
  setReadingPosition,
  UNSAVED,
} from "../src/item-state.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 31, 12, 0, 0);

/**
 * @param {string} id
 * @param {Partial<Record<string, any>>} [extra]
 */
function row(id, extra = {}) {
  return {
    id,
    publicationId: "p",
    title: id,
    publishedAt: NOW - DAY,
    read: false,
    saved: UNSAVED,
    readingPosition: 0,
    ...extra,
  };
}

/**
 * A stand-in for the `items` table: enough of Dexie's collection chain for the
 * two shapes item-state.js uses. `indexed` records every `where` field so a
 * test can assert an indexed query was made.
 * @param {object[]} rows
 */
function fakeDb(rows) {
  const items = new Map(rows.map((r) => [r.id, { ...r }]));
  /** @type {string[]} */
  const indexed = [];

  /**
   * @param {object[]} matched
   */
  function collection(matched) {
    return {
      filter(/** @type {(item: any) => boolean} */ predicate) {
        return collection(matched.filter(predicate));
      },
      async toArray() {
        return matched.map((item) => ({ ...item }));
      },
      async count() {
        return matched.length;
      },
      async modify(/** @type {Record<string, unknown>} */ patch) {
        for (const item of matched) Object.assign(items.get(item.id), patch);
        return matched.length;
      },
    };
  }

  const table = {
    where(/** @type {string} */ field) {
      indexed.push(field);
      return {
        equals(/** @type {unknown} */ value) {
          return collection(
            [...items.values()].filter(
              (item) => /** @type {any} */ (item)[field] === value,
            ),
          );
        },
      };
    },
    async update(
      /** @type {string} */ id,
      /** @type {Record<string, unknown>} */ patch,
    ) {
      const item = items.get(id);
      if (!item) return 0;
      Object.assign(item, patch);
      return 1;
    },
  };

  return { db: /** @type {any} */ ({ items: table }), items, indexed };
}

test("isUnread treats a missing read flag as Unread", () => {
  assert.equal(isUnread(/** @type {any} */ ({})), true);
  assert.equal(isUnread(/** @type {any} */ ({ read: false })), true);
  assert.equal(isUnread(/** @type {any} */ ({ read: true })), false);
});

test("savedAtOf uses the stamp, and falls back to publishedAt without one", () => {
  assert.equal(savedAtOf(/** @type {any} */ ({ savedAt: 42 })), 42);
  assert.equal(
    savedAtOf(/** @type {any} */ ({ publishedAt: NOW })),
    NOW,
    "an Item Saved before savedAt existed sorts by its publication date",
  );
  assert.equal(savedAtOf(/** @type {any} */ ({})), 0);
});

test("the Saved order is most recently Saved first, ties by id", () => {
  const items = [
    row("c", { savedAt: NOW - DAY }),
    row("a", { savedAt: NOW }),
    row("b", { savedAt: NOW }),
    row("d", { savedAt: NOW - 2 * DAY }),
  ];
  const sorted = [...items].sort(compareBySavedNewestFirst);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["a", "b", "c", "d"],
  );
  assert.equal(compareBySavedNewestFirst(items[0], items[0]), 0);
});

test("savedItems queries the saved index and returns newest-Saved first", async () => {
  const { db, indexed } = fakeDb([
    row("older", { saved: SAVED, savedAt: NOW - 3 * DAY }),
    row("unsaved", { saved: UNSAVED }),
    row("newest", { saved: SAVED, savedAt: NOW }),
    row("middle", { saved: SAVED, savedAt: NOW - DAY }),
  ]);

  const saved = await savedItems(db);

  assert.deepEqual(indexed, ["saved"], "one lookup, on the saved index");
  assert.deepEqual(
    saved.map((item) => item.id),
    ["newest", "middle", "older"],
  );
});

test("a Saved Item published long ago still appears, order by savedAt", async () => {
  // The point of Saved: Today bounds itself to the Retention window, so an
  // ancient Item is reachable only here — and it belongs where the reader put
  // it, not at the bottom by publication date.
  const { db } = fakeDb([
    row("ancient", {
      saved: SAVED,
      savedAt: NOW,
      publishedAt: NOW - 400 * DAY,
    }),
    row("recent", {
      saved: SAVED,
      savedAt: NOW - DAY,
      publishedAt: NOW - DAY,
    }),
  ]);

  const saved = await savedItems(db);

  assert.deepEqual(
    saved.map((item) => item.id),
    ["ancient", "recent"],
  );
});

test("setItemSaved writes 0 or 1, never a boolean, and stamps savedAt", async () => {
  const { db, items } = fakeDb([row("x")]);

  const written = await setItemSaved(db, "x", true, NOW);

  assert.deepEqual(written, { saved: 1, savedAt: NOW });
  assert.equal(items.get("x").saved, 1);
  assert.equal(items.get("x").savedAt, NOW);
});

test("unsaving clears the stamp rather than leaving a stale one", async () => {
  const { db, items } = fakeDb([row("x", { saved: SAVED, savedAt: NOW })]);

  const written = await setItemSaved(db, "x", false, NOW + DAY);

  assert.deepEqual(written, { saved: 0, savedAt: null });
  assert.equal(items.get("x").saved, 0);
  assert.equal(items.get("x").savedAt, null);
});

test("setItemSaved leaves every other field alone", async () => {
  const { db, items } = fakeDb([
    row("x", { read: true, readingPosition: 0.4, title: "Keep me" }),
  ]);

  await setItemSaved(db, "x", true, NOW);

  const stored = items.get("x");
  assert.equal(stored.read, true);
  assert.equal(stored.readingPosition, 0.4);
  assert.equal(stored.title, "Keep me");
});

test("setReadingPosition clamps what it stores", async () => {
  const { db, items } = fakeDb([row("x")]);

  assert.equal(await setReadingPosition(db, "x", 0.42), 0.42);
  assert.equal(items.get("x").readingPosition, 0.42);

  assert.equal(await setReadingPosition(db, "x", 9), 1);
  assert.equal(items.get("x").readingPosition, 1);

  assert.equal(await setReadingPosition(db, "x", -1), 0);
  assert.equal(items.get("x").readingPosition, 0);

  assert.equal(await setReadingPosition(db, "x", Number.NaN), 0);
});

test("Unread counts are per Publication, by indexed query", async () => {
  const { db, indexed } = fakeDb([
    row("a1", { publicationId: "a" }),
    row("a2", { publicationId: "a", read: true }),
    row("a3", { publicationId: "a" }),
    row("b1", { publicationId: "b", read: true }),
    row("c1", { publicationId: "c" }),
  ]);

  const counts = await countUnreadByPublication(db, ["a", "b", "z"]);

  assert.deepEqual(indexed, [
    "publicationId",
    "publicationId",
    "publicationId",
  ]);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 0);
  assert.equal(counts.get("z"), 0, "a Publication with no Items counts zero");
  assert.equal(counts.has("c"), false, "only the Publications asked for");
});

test("a repeated Publication id is counted once", async () => {
  const { db, indexed } = fakeDb([row("a1", { publicationId: "a" })]);
  const counts = await countUnreadByPublication(db, ["a", "a", "a"]);
  assert.deepEqual(indexed, ["publicationId"]);
  assert.equal(counts.get("a"), 1);
});

test("markPublicationRead marks the whole Publication and reports the count", async () => {
  const { db, items } = fakeDb([
    row("a1", { publicationId: "a" }),
    row("a2", { publicationId: "a", read: true }),
    row("a3", { publicationId: "a" }),
    row("b1", { publicationId: "b" }),
  ]);

  const changed = await markPublicationRead(db, "a");

  assert.equal(changed, 2, "only the Unread ones were written");
  assert.equal(items.get("a1").read, true);
  assert.equal(items.get("a3").read, true);
  assert.equal(items.get("b1").read, false, "another Publication is untouched");
});

test("markPublicationRead does not touch Saved or the Reading Position", async () => {
  const { db, items } = fakeDb([
    row("a1", { publicationId: "a", saved: SAVED, readingPosition: 0.3 }),
  ]);

  await markPublicationRead(db, "a");

  assert.equal(items.get("a1").read, true);
  assert.equal(items.get("a1").saved, SAVED);
  assert.equal(items.get("a1").readingPosition, 0.3);
});
