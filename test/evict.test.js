// Eviction at its seam: given these stored Items, these Article sizes and
// these limits, these ids are deleted, in this many transactions, and these
// bytes are freed.
//
// The store is an in-memory double with the same three-method contract the
// Dexie one exposes (`allItems`, `articleBytesByItem`, `deleteItems`), so
// nothing here needs IndexedDB. The planners themselves are ticket 05's and
// have their own tests; what these assert is the half `runEviction` adds —
// that Saved Items survive, that an Item goes with its Article and its images,
// that the batches are transactions, and that the trim runs before the size
// pass rather than beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVICTION_BATCH_SIZE, runEviction } from "../src/evict.js";
import { DEFAULT_RETENTION } from "../src/retention.js";

const DAY = 24 * 60 * 60 * 1000;
const MB = 2 ** 20;
const NOW = Date.UTC(2026, 0, 31, 12, 0, 0);

/**
 * One stored Item. `saved` is `0 | 1` as the schema holds it (db.js).
 * @param {string} id
 * @param {number} ageDays
 * @param {{ publicationId?: string, saved?: 0|1 }} [extra]
 */
function item(id, ageDays, extra = {}) {
  return {
    id,
    publicationId: extra.publicationId ?? "p",
    publishedAt: NOW - ageDays * DAY,
    saved: extra.saved ?? 0,
    read: false,
  };
}

/**
 * An in-memory Eviction store: Items, Articles and images in three Maps, the
 * same contract `createSyncStore` implements. Every `deleteItems` call is
 * recorded, so a test can assert the batching, and each call deletes the
 * Item's Article and images with it — which is what "one transaction per
 * batch" has to mean for a caller.
 *
 * @param {object[]} items
 * @param {Record<string, { html?: number, images?: number[] }>} [content]
 */
function memoryStore(items, content = {}) {
  const rows = new Map(items.map((i) => [i.id, { ...i }]));
  /** @type {Map<string, number>} */
  const articles = new Map();
  /** @type {Map<string, number[]>} */
  const images = new Map();
  for (const [itemId, entry] of Object.entries(content)) {
    if (entry.html) articles.set(itemId, entry.html);
    if (entry.images) images.set(itemId, [...entry.images]);
  }
  /** @type {string[][]} */
  const batches = [];

  const store = {
    async allItems() {
      return [...rows.values()];
    },
    async articleBytesByItem() {
      /** @type {Map<string, number>} */
      const bytes = new Map();
      for (const [itemId, size] of articles) {
        bytes.set(itemId, (bytes.get(itemId) ?? 0) + size);
      }
      for (const [itemId, sizes] of images) {
        const total = sizes.reduce((sum, n) => sum + n, 0);
        bytes.set(itemId, (bytes.get(itemId) ?? 0) + total);
      }
      return bytes;
    },
    async deleteItems(itemIds) {
      batches.push([...itemIds]);
      for (const id of itemIds) {
        rows.delete(id);
        articles.delete(id);
        images.delete(id);
      }
    },
  };
  return { store, rows, articles, images, batches };
}

test("the age pass Evicts Items older than maxAgeDays and leaves the rest", async () => {
  const { store, rows, batches } = memoryStore([
    item("old-40", 40),
    item("old-31", 31),
    item("fresh-29", 29),
    item("fresh-1", 1),
  ]);

  const result = await runEviction({
    store,
    limits: { maxAgeDays: 30 },
    now: NOW,
  });

  assert.deepEqual(result.deleted, ["old-40", "old-31"]);
  assert.deepEqual([...rows.keys()], ["fresh-29", "fresh-1"]);
  assert.equal(batches.length, 1, "one transaction for one batch");
});

test("a Saved Item is never Evicted, however old or however large", async () => {
  const { store, rows } = memoryStore(
    [
      item("saved-ancient", 900, { saved: 1 }),
      item("saved-huge", 2, { saved: 1 }),
      item("unsaved-old", 40),
      item("unsaved-big", 1),
    ],
    {
      "saved-huge": { html: 400 * MB },
      "unsaved-big": { html: 10 * MB },
    },
  );

  const result = await runEviction({
    store,
    limits: { maxAgeDays: 30, maxTotalBytes: 50 * MB },
    now: NOW,
  });

  assert.deepEqual(result.deleted.sort(), ["unsaved-big", "unsaved-old"]);
  assert.ok(rows.has("saved-ancient"), "an ancient Saved Item stays");
  assert.ok(rows.has("saved-huge"), "a Saved Item over the size cap stays");
});

test("the size pass removes oldest first until the stored bytes are under the cap", async () => {
  const { store, rows } = memoryStore(
    [item("a", 5), item("b", 4), item("c", 3), item("d", 2)],
    {
      a: { html: 10 * MB },
      b: { html: 10 * MB },
      c: { html: 10 * MB },
      d: { html: 10 * MB },
    },
  );

  const result = await runEviction({
    store,
    limits: { maxAgeDays: 365, maxTotalBytes: 25 * MB },
    now: NOW,
  });

  assert.deepEqual(result.deleted, ["a", "b"]);
  assert.equal(result.bytesFreed, 20 * MB);
  assert.deepEqual([...rows.keys()], ["c", "d"]);
});

test("an Item is deleted with its Article and its images, and the bytes are reported", async () => {
  const { store, articles, images } = memoryStore(
    [item("doomed", 60), item("kept", 1)],
    {
      doomed: { html: 4096, images: [1024, 2048] },
      kept: { html: 512 },
    },
  );

  const result = await runEviction({
    store,
    limits: { maxAgeDays: 30 },
    now: NOW,
  });

  assert.deepEqual(result.deleted, ["doomed"]);
  assert.equal(result.bytesFreed, 4096 + 1024 + 2048);
  assert.equal(articles.has("doomed"), false, "the Article went too");
  assert.equal(images.has("doomed"), false, "the images went too");
  assert.equal(articles.get("kept"), 512, "the surviving Article is untouched");
});

test("the per-Publication window is applied, and Saved Items do not take a slot", async () => {
  const items = [];
  for (let i = 0; i < 6; i += 1) items.push(item(`p-${i}`, i));
  for (let i = 0; i < 3; i += 1) {
    items.push(item(`q-${i}`, i, { publicationId: "q" }));
  }
  items.push(item("p-saved", 99, { saved: 1 }));
  const { store, rows } = memoryStore(items);

  const result = await runEviction({
    store,
    limits: { keepPerPublication: 3, maxAgeDays: 3650 },
    now: NOW,
  });

  // p keeps its three newest unsaved Items plus the Saved one; q is under the
  // window and loses nothing.
  assert.deepEqual(result.deleted, ["p-5", "p-4", "p-3"]);
  assert.deepEqual([...rows.keys()].sort(), [
    "p-0",
    "p-1",
    "p-2",
    "p-saved",
    "q-0",
    "q-1",
    "q-2",
  ]);
});

test("the trim runs before the size pass, so space it frees is not paid for twice", async () => {
  // Four Items in one Publication, 10 MB each, a window of two and a 25 MB
  // cap. The trim takes the two oldest (20 MB), which puts the store at 20 MB
  // — already under the cap — so the size pass must Evict nothing more.
  const { store, rows } = memoryStore(
    [item("a", 4), item("b", 3), item("c", 2), item("d", 1)],
    {
      a: { html: 10 * MB },
      b: { html: 10 * MB },
      c: { html: 10 * MB },
      d: { html: 10 * MB },
    },
  );

  const result = await runEviction({
    store,
    limits: { keepPerPublication: 2, maxAgeDays: 3650, maxTotalBytes: 25 * MB },
    now: NOW,
  });

  assert.deepEqual(result.deleted, ["a", "b"]);
  assert.deepEqual([...rows.keys()], ["c", "d"]);
});

test("a large Eviction is deleted in batches, one transaction each", async () => {
  const items = [];
  for (let i = 0; i < 12; i += 1) {
    items.push(item(`x-${String(i).padStart(2, "0")}`, 100 + i));
  }
  const { store, batches, rows } = memoryStore(items);

  const result = await runEviction({
    store,
    limits: { maxAgeDays: 30 },
    now: NOW,
    batchSize: 5,
  });

  assert.equal(result.deleted.length, 12);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [5, 5, 2],
  );
  assert.equal(rows.size, 0);
  // Every planned id appears in exactly one batch.
  assert.deepEqual(batches.flat().sort(), [...result.deleted].sort());
});

test("nothing outside Retention means no transaction at all", async () => {
  const { store, batches } = memoryStore([item("fresh", 1)], {
    fresh: { html: 1024 },
  });

  const result = await runEviction({ store, now: NOW });

  assert.deepEqual(result, { deleted: [], bytesFreed: 0 });
  assert.equal(batches.length, 0, "an empty plan opens no transaction");
});

test("an empty store is a no-op", async () => {
  const { store, batches } = memoryStore([]);
  const result = await runEviction({ store, now: NOW });
  assert.deepEqual(result, { deleted: [], bytesFreed: 0 });
  assert.equal(batches.length, 0);
});

test("missing limits fall back to DEFAULT_RETENTION", async () => {
  const older = DEFAULT_RETENTION.maxAgeDays + 1;
  const { store, rows } = memoryStore([
    item("stale", older),
    item("fresh", DEFAULT_RETENTION.maxAgeDays - 1),
  ]);

  const result = await runEviction({ store, now: NOW });

  assert.deepEqual(result.deleted, ["stale"]);
  assert.deepEqual([...rows.keys()], ["fresh"]);
});

test("now accepts a Date as well as epoch milliseconds", async () => {
  const { store } = memoryStore([item("old", 40), item("new", 1)]);
  const result = await runEviction({
    store,
    limits: { maxAgeDays: 30 },
    now: new Date(NOW),
  });
  assert.deepEqual(result.deleted, ["old"]);
});

test("the batch size defaults to EVICTION_BATCH_SIZE", async () => {
  const items = [];
  for (let i = 0; i < EVICTION_BATCH_SIZE + 1; i += 1) {
    items.push(item(`y-${String(i).padStart(3, "0")}`, 100 + i));
  }
  const { store, batches } = memoryStore(items);

  await runEviction({ store, limits: { maxAgeDays: 30 }, now: NOW });

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [EVICTION_BATCH_SIZE, 1],
  );
});

test("an Item with no stored Article frees no bytes but is still Evicted by age", async () => {
  const { store, rows } = memoryStore([item("bare", 90)]);
  const result = await runEviction({
    store,
    limits: { maxAgeDays: 30 },
    now: NOW,
  });
  assert.deepEqual(result.deleted, ["bare"]);
  assert.equal(result.bytesFreed, 0);
  assert.equal(rows.size, 0);
});
