import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RETENTION,
  planItemTrim,
  planEviction,
} from "../src/retention.js";

const DAY = 24 * 60 * 60 * 1000;
const MB = 2 ** 20;
const NOW = Date.UTC(2026, 0, 31, 12, 0, 0);

/** One Item published `ageDays` days before NOW. */
function item(id, ageDays, extra = {}) {
  return {
    id,
    publicationId: "p",
    publishedAt: NOW - ageDays * DAY,
    ...extra,
  };
}

/** Article bytes per Item id, the Map shape `planEviction` takes. */
function bytes(byId) {
  return new Map(Object.entries(byId));
}

test("DEFAULT_RETENTION carries the spec defaults and is frozen", () => {
  assert.deepEqual(DEFAULT_RETENTION, {
    maxAgeDays: 30,
    maxTotalBytes: 500 * MB,
    maxImageBytesPerArticle: 5 * MB,
    keepPerPublication: 50,
    prefetchPerPublication: 10,
  });
  assert.ok(Object.isFrozen(DEFAULT_RETENTION));
});

test("planItemTrim returns the Items beyond the per-Publication count, oldest first", () => {
  const items = [
    item("p-3", 3),
    item("p-0", 0),
    item("p-4", 4),
    item("p-1", 1),
    item("p-2", 2),
  ];
  assert.deepEqual(planItemTrim(items, { keepPerPublication: 2 }), [
    "p-4",
    "p-3",
    "p-2",
  ]);
});

test("planItemTrim never returns Saved Items and does not count them toward the cap", () => {
  const items = [
    item("new", 0),
    item("keep", 1),
    item("saved-old", 5, { saved: true }),
    item("saved-new", 0.5, { saved: true }),
    item("trim", 2),
  ];
  assert.deepEqual(planItemTrim(items, { keepPerPublication: 2 }), ["trim"]);
});

test("planItemTrim counts per Publication and merges results oldest first", () => {
  const items = [
    item("a-0", 0, { publicationId: "a" }),
    item("a-1", 1, { publicationId: "a" }),
    item("a-9", 9, { publicationId: "a" }),
    item("b-0", 0, { publicationId: "b" }),
    item("b-1", 1, { publicationId: "b" }),
    item("b-5", 5, { publicationId: "b" }),
    item("b-7", 7, { publicationId: "b" }),
  ];
  assert.deepEqual(planItemTrim(items, { keepPerPublication: 2 }), [
    "a-9",
    "b-7",
    "b-5",
  ]);
});

test("planItemTrim defaults to DEFAULT_RETENTION.keepPerPublication", () => {
  const items = Array.from({ length: 60 }, (_, k) =>
    item(`p-${String(k).padStart(2, "0")}`, k),
  );
  const trimmed = planItemTrim(items);
  assert.equal(trimmed.length, 10);
  assert.deepEqual(trimmed.slice(0, 2), ["p-59", "p-58"]);
});

test("planItemTrim is deterministic on equal dates (ties by id)", () => {
  const items = [item("c", 1), item("a", 1), item("b", 1), item("newest", 0)];
  // Among equal dates the lowest id ranks newest, so "a" stays with "newest".
  assert.deepEqual(planItemTrim(items, { keepPerPublication: 2 }), ["b", "c"]);
  assert.deepEqual(
    planItemTrim(items.slice().reverse(), { keepPerPublication: 2 }),
    ["b", "c"],
  );
});

test("planEviction removes every unsaved Item older than maxAgeDays, oldest first", () => {
  const items = [item("fresh", 1), item("old", 31), item("older", 40)];
  const sizes = bytes({ fresh: 1 * MB, old: 2 * MB, older: 3 * MB });
  const plan = planEviction(items, sizes, { maxAgeDays: 30 }, NOW);
  assert.deepEqual(plan, {
    deleteItemIds: ["older", "old"],
    bytesFreed: 5 * MB,
  });
});

test("planEviction never returns Saved Items, even when old or oversized", () => {
  const items = [
    item("saved-old", 90, { saved: true }),
    item("saved-big", 1, { saved: true }),
    item("fresh", 1),
  ];
  const sizes = bytes({
    "saved-old": 1 * MB,
    "saved-big": 100 * MB,
    fresh: 1 * MB,
  });
  const plan = planEviction(
    items,
    sizes,
    { maxAgeDays: 30, maxTotalBytes: 50 * MB },
    NOW,
  );
  // Saved alone exceed the cap; the size pass takes the only unsaved Item and
  // stops, since nothing else can be freed.
  assert.deepEqual(plan, { deleteItemIds: ["fresh"], bytesFreed: 1 * MB });
});

test("planEviction applies age first, then size oldest first until under the cap", () => {
  const items = [
    item("d1", 1),
    item("d5", 5),
    item("d10", 10),
    item("d20", 20),
    item("d45", 45),
  ];
  const sizes = new Map([
    ["d1", 10 * MB],
    ["d5", 10 * MB],
    ["d10", 10 * MB],
    ["d20", 10 * MB],
    ["d45", 10 * MB],
  ]);
  const plan = planEviction(
    items,
    sizes,
    { maxAgeDays: 30, maxTotalBytes: 25 * MB },
    NOW,
  );
  // Age evicts d45 (40 MB remain), size evicts d20 then d10 (20 MB remain).
  assert.deepEqual(plan.deleteItemIds, ["d45", "d20", "d10"]);
  assert.equal(plan.bytesFreed, 30 * MB);
});

test("planEviction does nothing when within Retention", () => {
  const items = [item("a", 1), item("b", 2)];
  const plan = planEviction(items, bytes({ a: MB, b: MB }), undefined, NOW);
  assert.deepEqual(plan, { deleteItemIds: [], bytesFreed: 0 });
});

test("planEviction treats Items with no size entry as free and skips them in the size pass", () => {
  const items = [item("summary-only", 20), item("big-a", 2), item("big-b", 1)];
  const sizes = bytes({ "big-a": 30 * MB, "big-b": 30 * MB });
  const plan = planEviction(
    items,
    sizes,
    { maxAgeDays: 30, maxTotalBytes: 40 * MB },
    NOW,
  );
  assert.deepEqual(plan, { deleteItemIds: ["big-a"], bytesFreed: 30 * MB });
});

test("planEviction is deterministic on equal dates (ties by id)", () => {
  const items = [item("b", 40), item("a", 40), item("c", 40)];
  const sizes = bytes({ a: 1, b: 2, c: 3 });
  const once = planEviction(items, sizes, { maxAgeDays: 30 }, NOW);
  const again = planEviction(
    items.slice().reverse(),
    sizes,
    { maxAgeDays: 30 },
    NOW,
  );
  assert.deepEqual(once.deleteItemIds, ["a", "b", "c"]);
  assert.deepEqual(again, once);

  const equalAge = [item("y", 1), item("x", 1), item("z", 1)];
  const bySize = planEviction(
    equalAge,
    bytes({ x: 5 * MB, y: 5 * MB, z: 5 * MB }),
    { maxAgeDays: 30, maxTotalBytes: 6 * MB },
    NOW,
  );
  assert.deepEqual(bySize.deleteItemIds, ["x", "y"]);
});

test("planEviction accepts a Date for now and uses DEFAULT_RETENTION when limits are omitted", () => {
  const items = [item("old", 31), item("fresh", 29)];
  const plan = planEviction(items, bytes({}), {}, new Date(NOW));
  assert.deepEqual(plan.deleteItemIds, ["old"]);
});

test("planEviction treats an Item with no date as the oldest", () => {
  const items = [
    { id: "undated", publicationId: "p", publishedAt: undefined },
    item("fresh", 1),
  ];
  const plan = planEviction(items, bytes({}), { maxAgeDays: 30 }, NOW);
  assert.deepEqual(plan.deleteItemIds, ["undated"]);
});
