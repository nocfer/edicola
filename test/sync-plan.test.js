import { test } from "node:test";
import assert from "node:assert/strict";
import { planFeedFetches, planArticleFetches } from "../src/sync-plan.js";
import { DEFAULT_RETENTION } from "../src/retention.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 31, 12, 0, 0);

/**
 * `count` Items for one Publication, newest first by construction: item k is
 * published k hours before T0, id `${pub}-${k}` (zero-padded so id order
 * matches age order in the round-robin assertions).
 */
function itemsFor(pub, count, extra = {}) {
  return Array.from({ length: count }, (_, k) => ({
    id: `${pub}-${String(k).padStart(2, "0")}`,
    publicationId: pub,
    publishedAt: T0 - k * 60 * 60 * 1000,
    ...extra,
  }));
}

const ids = (items) => items.map((i) => i.id);

/**
 * `planArticleFetches` with the clock pinned to the fixture's own epoch.
 * It now skips Items that Eviction would delete on age, so a fixture dated
 * T0 read against the real `Date.now()` would empty every queue here the day
 * these dates fall outside `maxAgeDays`. Passing `now` keeps these tests about
 * ordering and caps, which is what they are for.
 */
const planArticles = (items, limits = {}) =>
  planArticleFetches(items, { now: T0, ...limits });

test("planFeedFetches orders never-synced first, then least recently synced, then name", () => {
  const pubs = [
    { id: "c", name: "Corriere", lastSyncedAt: T0 - 1 * DAY },
    { id: "g", name: "Guardian", lastSyncedAt: T0 - 3 * DAY },
    { id: "r", name: "Repubblica", lastSyncedAt: null },
    { id: "f", name: "FT", lastSyncedAt: T0 - 3 * DAY },
    { id: "s", name: "Sole 24 Ore" },
  ];
  const plan = planFeedFetches(pubs);
  assert.deepEqual(
    plan.map((p) => p.id),
    ["r", "s", "f", "g", "c"],
  );
});

test("planFeedFetches ties on equal lastSyncedAt and name by id, and does not mutate input", () => {
  const pubs = [
    { id: "b", name: "Same", lastSyncedAt: T0 },
    { id: "a", name: "Same", lastSyncedAt: T0 },
  ];
  const copy = pubs.slice();
  const plan = planFeedFetches(pubs);
  assert.deepEqual(
    plan.map((p) => p.id),
    ["a", "b"],
  );
  assert.deepEqual(pubs, copy);
  assert.notEqual(plan, pubs);
  assert.deepEqual(planFeedFetches([]), []);
});

test("planFeedFetches returns the same records, extra fields intact", () => {
  const pub = { id: "x", name: "X", lastSyncedAt: null, feedUrl: "https://x" };
  const [planned] = planFeedFetches([pub]);
  assert.equal(planned, pub);
});

test("planArticleFetches interleaves three Publications of sizes 1, 5 and 20 round-robin, capped at 10", () => {
  const a = itemsFor("a", 1);
  const b = itemsFor("b", 5);
  const c = itemsFor("c", 20);
  const queue = planArticles([a, b, c], { prefetchPerPublication: 10 });
  assert.deepEqual(ids(queue), [
    "a-00",
    "b-00",
    "c-00",
    "b-01",
    "c-01",
    "b-02",
    "c-02",
    "b-03",
    "c-03",
    "b-04",
    "c-04",
    "c-05",
    "c-06",
    "c-07",
    "c-08",
    "c-09",
  ]);
  assert.equal(queue.length, 1 + 5 + 10);
  assert.equal(queue.filter((i) => i.publicationId === "c").length, 10);
});

test("planArticleFetches defaults the cap to DEFAULT_RETENTION.prefetchPerPublication", () => {
  const queue = planArticles([itemsFor("c", 20)]);
  assert.equal(DEFAULT_RETENTION.prefetchPerPublication, 10);
  assert.equal(queue.length, 10);
});

test("planArticleFetches enforces a custom cap per Publication", () => {
  const queue = planArticles([itemsFor("a", 4), itemsFor("b", 4)], {
    prefetchPerPublication: 2,
  });
  assert.deepEqual(ids(queue), ["a-00", "b-00", "a-01", "b-01"]);
  assert.deepEqual(
    planArticles([itemsFor("a", 3)], { prefetchPerPublication: 0 }),
    [],
  );
});

test("planArticleFetches skips Items that have an Article or are Summary-only", () => {
  const items = [
    ...itemsFor("a", 2),
    { id: "a-has", publicationId: "a", publishedAt: T0 + 1, hasArticle: true },
    { id: "a-sum", publicationId: "a", publishedAt: T0 + 2, summaryOnly: true },
  ];
  assert.deepEqual(ids(planArticles([items])), ["a-00", "a-01"]);
});

test("planArticleFetches takes newest first within a Publication regardless of input order", () => {
  const items = itemsFor("a", 4).reverse();
  assert.deepEqual(ids(planArticles([items], { prefetchPerPublication: 2 })), [
    "a-00",
    "a-01",
  ]);
});

test("planArticleFetches is deterministic on equal dates (ties by id)", () => {
  const same = [
    { id: "z", publicationId: "p", publishedAt: T0 },
    { id: "m", publicationId: "p", publishedAt: T0 },
    { id: "a", publicationId: "p", publishedAt: T0 },
  ];
  const once = ids(planArticles([same]));
  const again = ids(planArticles([same.slice().reverse()]));
  assert.deepEqual(once, ["a", "m", "z"]);
  assert.deepEqual(again, once);
});

test("planArticleFetches accepts a Map or a flat Item list, keeping Publication order", () => {
  const a = itemsFor("a", 1);
  const b = itemsFor("b", 2);
  const expected = ["a-00", "b-00", "b-01"];
  const fromArrays = ids(planArticles([a, b]));
  const fromMap = ids(
    planArticles(
      new Map([
        ["a", a],
        ["b", b],
      ]),
    ),
  );
  const fromFlat = ids(planArticles([...a, ...b]));
  assert.deepEqual(fromArrays, expected);
  assert.deepEqual(fromMap, expected);
  assert.deepEqual(fromFlat, expected);
  // Flat input groups by first appearance, so a Publication seen first leads.
  assert.deepEqual(ids(planArticles([...b, ...a])), ["b-00", "a-00", "b-01"]);
});

test("planArticleFetches skips Items that Eviction will delete on age", () => {
  // Wired Italia's Feed serves thirty Items all about seventy days old against
  // a thirty-day `maxAgeDays`. Before this filter a Sync fetched ten Articles
  // and their images and then Eviction deleted every one of them in the same
  // run: forty requests for a Publication the reader still saw empty.
  const fresh = { id: "fresh", publicationId: "p", publishedAt: T0 - 2 * DAY };
  const stale = { id: "stale", publicationId: "p", publishedAt: T0 - 70 * DAY };
  assert.deepEqual(ids(planArticles([fresh, stale], { maxAgeDays: 30 })), [
    "fresh",
  ]);
  // A Feed that is entirely stale queues nothing at all.
  assert.deepEqual(ids(planArticles([stale], { maxAgeDays: 30 })), []);
});

test("planArticleFetches applies no age cutoff when maxAgeDays does not bound one", () => {
  const stale = { id: "stale", publicationId: "p", publishedAt: T0 - 70 * DAY };
  for (const maxAgeDays of [0, -1, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      ids(planArticles([stale], { maxAgeDays })),
      ["stale"],
      `maxAgeDays=${maxAgeDays}`,
    );
  }
});

test("planArticleFetches handles empty input and empty Publications", () => {
  assert.deepEqual(planArticles([]), []);
  assert.deepEqual(planArticles(new Map()), []);
  assert.deepEqual(ids(planArticles([[], itemsFor("b", 1), []])), ["b-00"]);
});
