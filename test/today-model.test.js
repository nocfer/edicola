// Today's grouping rules. Every timestamp here is built from *local* date
// components (`new Date(2026, 0, 15, …)`), so the assertions hold in any
// timezone the test runs in — which is the point: the day an Item lands in is
// the reader's day, not UTC's.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTodayModel,
  localDayKey,
  oneLine,
  startOfLocalDay,
  SUMMARY_MAX_CHARS,
} from "../src/today-model.js";
import { DEFAULT_RETENTION } from "../src/retention.js";

const DAY = 24 * 60 * 60 * 1000;

/** Local midday on 15 January 2026: "now" for most of these tests. */
const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();

/** Local midnight that starts a given local date. */
function midnight(year, month, day) {
  return new Date(year, month, day).getTime();
}

const PUBS = new Map([
  ["bbc-news", { id: "bbc-news", name: "BBC News" }],
  ["nature", { id: "nature", name: "Nature" }],
]);

/**
 * One stored Item. `publishedAt` is epoch ms; everything else has a sane
 * default so a test names only what it exercises.
 */
function item(id, publishedAt, extra = {}) {
  return {
    id,
    publicationId: "bbc-news",
    feedItemId: id,
    title: `Title ${id}`,
    link: `https://example.com/${id}`,
    publishedAt,
    summaryHtml: "",
    summaryText: `Summary of ${id}`,
    thumbnailUrl: null,
    read: false,
    saved: 0,
    readingPosition: 0,
    summaryOnly: false,
    summaryOnlyReason: null,
    hasArticle: true,
    fetchedAt: publishedAt,
    ...extra,
  };
}

// --- Day boundaries --------------------------------------------------------

test("an Item published this morning lands in the Today section", () => {
  const model = buildTodayModel([item("a", NOW - 3600_000)], PUBS, {
    now: NOW,
  });
  assert.equal(model.sections.length, 1);
  assert.equal(model.sections[0].kind, "today");
  assert.equal(model.sections[0].label, "Today");
  assert.equal(model.sections[0].key, "2026-01-15");
  assert.equal(model.sections[0].startedAt, midnight(2026, 0, 15));
});

test("local midnight itself belongs to the new day, one millisecond earlier to the old one", () => {
  const start = midnight(2026, 0, 15);
  const model = buildTodayModel(
    [item("midnight", start), item("late", start - 1)],
    PUBS,
    { now: NOW },
  );
  assert.deepEqual(
    model.sections.map((s) => [s.kind, s.cards.map((c) => c.id)]),
    [
      ["today", ["midnight"]],
      ["yesterday", ["late"]],
    ],
  );
});

test("23:59:59.999 yesterday and 00:00:00.000 today are two sections, not one", () => {
  const model = buildTodayModel(
    [
      item("late", new Date(2026, 0, 14, 23, 59, 59, 999).getTime()),
      item("early", new Date(2026, 0, 15, 0, 0, 0, 0).getTime()),
    ],
    PUBS,
    { now: NOW },
  );
  assert.equal(model.sections.length, 2);
  assert.deepEqual(
    model.sections.map((s) => s.label),
    ["Today", "Yesterday"],
  );
});

test("an Item published a minute ago is Today even when now is just past midnight", () => {
  const justPast = new Date(2026, 0, 15, 0, 0, 30).getTime();
  const model = buildTodayModel([item("a", justPast - 20_000)], PUBS, {
    now: justPast,
  });
  assert.equal(model.sections[0].kind, "today");
});

test("an Item from 23:59 yesterday reads as Yesterday once the clock passes midnight", () => {
  const before = new Date(2026, 0, 14, 23, 59, 0).getTime();
  const beforeMidnight = buildTodayModel([item("a", before)], PUBS, {
    now: new Date(2026, 0, 14, 23, 59, 30).getTime(),
  });
  assert.equal(beforeMidnight.sections[0].kind, "today");
  const afterMidnight = buildTodayModel([item("a", before)], PUBS, {
    now: new Date(2026, 0, 15, 0, 0, 30).getTime(),
  });
  assert.equal(afterMidnight.sections[0].kind, "yesterday");
});

test("older days get a weekday and date header, and the year when it differs", () => {
  const model = buildTodayModel(
    [
      item("a", midnight(2026, 0, 12) + 9 * 3600_000),
      item("b", midnight(2025, 11, 28) + 9 * 3600_000),
    ],
    PUBS,
    { now: NOW, lang: "en" },
  );
  assert.equal(model.sections.length, 2);
  assert.equal(model.sections[0].kind, "other");
  assert.match(model.sections[0].label, /Monday/);
  assert.match(model.sections[0].label, /12/);
  assert.doesNotMatch(model.sections[0].label, /2026/);
  assert.match(model.sections[1].label, /2025/);
});

test("day headers follow the Language", () => {
  const items = [
    item("a", NOW - 3600_000),
    item("b", NOW - DAY),
    item("c", midnight(2026, 0, 12) + 9 * 3600_000),
  ];
  const en = buildTodayModel(items, PUBS, { now: NOW, lang: "en" });
  const it = buildTodayModel(items, PUBS, { now: NOW, lang: "it" });
  assert.deepEqual(
    en.sections.map((s) => s.label),
    ["Today", "Yesterday", en.sections[2].label],
  );
  assert.equal(it.sections[0].label, "Oggi");
  assert.equal(it.sections[1].label, "Ieri");
  assert.match(it.sections[2].label, /luned/i);
  assert.match(it.sections[2].label, /gennaio/);
});

test("startOfLocalDay and localDayKey use local components, not UTC", () => {
  const evening = new Date(2026, 0, 15, 23, 30, 0).getTime();
  assert.equal(startOfLocalDay(evening), midnight(2026, 0, 15));
  assert.equal(localDayKey(evening), "2026-01-15");
  const morning = new Date(2026, 0, 15, 0, 30, 0).getTime();
  assert.equal(startOfLocalDay(morning), midnight(2026, 0, 15));
  assert.equal(localDayKey(morning), "2026-01-15");
});

// --- Order and grouping ----------------------------------------------------

test("sections come newest first and so do the cards inside them", () => {
  const model = buildTodayModel(
    [
      item("old", NOW - 3 * DAY),
      item("newest", NOW - 60_000),
      item("mid", NOW - 2 * 3600_000),
      item("yesterday", NOW - DAY),
    ],
    PUBS,
    { now: NOW },
  );
  assert.deepEqual(
    model.sections.map((s) => s.cards.map((c) => c.id)),
    [["newest", "mid"], ["yesterday"], ["old"]],
  );
});

test("Items of equal date are ordered by id, so a redraw never reshuffles", () => {
  const at = NOW - 3600_000;
  const model = buildTodayModel(
    [item("c", at), item("a", at), item("b", at)],
    PUBS,
    { now: NOW },
  );
  assert.deepEqual(
    model.sections[0].cards.map((c) => c.id),
    ["a", "b", "c"],
  );
});

test("cards carry the Publication's name, and its id when the name is gone", () => {
  const pubs = new Map([
    ["bbc-news", { id: "bbc-news", name: "BBC News" }],
    ["ghost", { id: "ghost", name: "" }],
  ]);
  const model = buildTodayModel(
    [
      item("a", NOW - 3600_000),
      item("b", NOW - 3600_000, { publicationId: "ghost" }),
    ],
    pubs,
    { now: NOW },
  );
  const names = model.sections[0].cards.map((c) => c.publicationName);
  assert.deepEqual(names.sort(), ["BBC News", "ghost"]);
});

test("an Item whose Publication is not Enabled is dropped", () => {
  const model = buildTodayModel(
    [
      item("a", NOW - 3600_000),
      item("b", NOW - 3600_000, { publicationId: "switched-off" }),
    ],
    PUBS,
    { now: NOW },
  );
  assert.deepEqual(
    model.sections[0].cards.map((c) => c.id),
    ["a"],
  );
  assert.equal(model.itemCount, 1);
});

test("a plain object works as well as a Map for the Publications", () => {
  const model = buildTodayModel(
    [item("a", NOW - 3600_000)],
    { "bbc-news": { id: "bbc-news", name: "BBC News" } },
    { now: NOW },
  );
  assert.equal(model.sections[0].cards[0].publicationName, "BBC News");
});

// --- The Retention bound ---------------------------------------------------

test("Items older than maxAgeDays are outside the window", () => {
  const model = buildTodayModel(
    [
      item("fresh", NOW - 29 * DAY),
      item("stale", NOW - 31 * DAY),
      item("ancient", NOW - 400 * DAY),
    ],
    PUBS,
    { now: NOW },
  );
  assert.deepEqual(
    model.sections.flatMap((s) => s.cards.map((c) => c.id)),
    ["fresh"],
  );
  assert.equal(model.windowDays, DEFAULT_RETENTION.maxAgeDays);
});

test("the list is capped per Publication, so one busy Feed cannot crowd out another", () => {
  const items = [];
  for (let i = 0; i < 8; i += 1) {
    items.push(item(`bbc-${i}`, NOW - i * 60_000));
    items.push(item(`nat-${i}`, NOW - i * 60_000, { publicationId: "nature" }));
  }
  const model = buildTodayModel(items, PUBS, {
    now: NOW,
    limits: { keepPerPublication: 3 },
  });
  const ids = model.sections.flatMap((s) => s.cards.map((c) => c.id));
  assert.equal(ids.length, 6);
  assert.deepEqual(ids.filter((id) => id.startsWith("bbc")).sort(), [
    "bbc-0",
    "bbc-1",
    "bbc-2",
  ]);
  assert.deepEqual(ids.filter((id) => id.startsWith("nat")).sort(), [
    "nat-0",
    "nat-1",
    "nat-2",
  ]);
});

test("nothing to show is an empty section list, not a throw", () => {
  assert.deepEqual(buildTodayModel([], PUBS, { now: NOW }).sections, []);
  assert.deepEqual(buildTodayModel(null, null, { now: NOW }).sections, []);
  assert.equal(buildTodayModel(undefined, PUBS, { now: NOW }).cardCount, 0);
});

// --- Filter and chips ------------------------------------------------------

test("the chips are All plus one per Publication with Items, each with its Unread count", () => {
  const model = buildTodayModel(
    [
      item("a", NOW - 60_000),
      item("b", NOW - 120_000, { read: true }),
      item("c", NOW - 180_000, { publicationId: "nature" }),
    ],
    PUBS,
    { now: NOW, lang: "en" },
  );
  assert.deepEqual(
    model.chips.map((c) => [c.publicationId, c.name, c.unread, c.total]),
    [
      [null, "All", 2, 3],
      ["bbc-news", "BBC News", 1, 2],
      ["nature", "Nature", 1, 1],
    ],
  );
  assert.equal(model.chips[0].active, true);
  assert.equal(model.unreadCount, 2);
});

test("the All chip is localized", () => {
  const model = buildTodayModel([item("a", NOW)], PUBS, {
    now: NOW,
    lang: "it",
  });
  assert.equal(model.chips[0].name, "Tutte");
});

test("a Publication with no Items inside the window gets no chip", () => {
  const model = buildTodayModel([item("a", NOW - 60_000)], PUBS, { now: NOW });
  assert.deepEqual(
    model.chips.map((c) => c.publicationId),
    [null, "bbc-news"],
  );
});

test("the filter narrows the sections but not the counts a chip shows", () => {
  const items = [
    item("a", NOW - 60_000),
    item("b", NOW - 120_000, { publicationId: "nature" }),
    item("c", NOW - 180_000, { publicationId: "nature" }),
  ];
  const model = buildTodayModel(items, PUBS, {
    now: NOW,
    filterPublicationId: "nature",
  });
  assert.deepEqual(
    model.sections.flatMap((s) => s.cards.map((c) => c.id)),
    ["b", "c"],
  );
  assert.equal(model.cardCount, 2);
  assert.equal(model.itemCount, 3);
  assert.equal(model.filterName, "Nature");
  const bbc = model.chips.find((c) => c.publicationId === "bbc-news");
  assert.equal(bbc.total, 1, "the other chip still counts its own Items");
  assert.equal(
    model.chips.find((c) => c.publicationId === "nature").active,
    true,
  );
});

test("a filter with nothing behind it keeps its own chip visible", () => {
  const model = buildTodayModel([item("a", NOW - 60_000)], PUBS, {
    now: NOW,
    filterPublicationId: "nature",
  });
  assert.equal(model.cardCount, 0);
  assert.equal(model.filterName, "Nature");
  assert.deepEqual(
    model.chips.map((c) => c.publicationId),
    [null, "bbc-news", "nature"],
  );
});

// --- Card fields -----------------------------------------------------------

test("a card is display-ready: one-line Summary, resolved flags, no thumbnail invented", () => {
  const model = buildTodayModel(
    [
      item("a", NOW - 60_000, {
        title: "  A   headline\nwrapped  ",
        summaryText: "Line one.\n\nLine two.",
        thumbnailUrl: "https://example.com/t.jpg",
        read: true,
        saved: 1,
        summaryOnly: true,
      }),
    ],
    PUBS,
    { now: NOW },
  );
  const card = model.sections[0].cards[0];
  assert.equal(card.title, "A headline wrapped");
  assert.equal(card.summary, "Line one. Line two.");
  assert.equal(card.thumbnailUrl, "https://example.com/t.jpg");
  assert.equal(card.read, true);
  assert.equal(card.saved, true, "0|1 from IndexedDB becomes a boolean");
  assert.equal(card.summaryOnly, true);
  assert.equal(card.publishedAt, NOW - 60_000);
});

test("a missing thumbnail is null, never an empty string", () => {
  const model = buildTodayModel([item("a", NOW, { thumbnailUrl: "" })], PUBS, {
    now: NOW,
  });
  assert.equal(model.sections[0].cards[0].thumbnailUrl, null);
});

test("oneLine collapses whitespace and elides on a word", () => {
  assert.equal(oneLine("  a\n\tb  "), "a b");
  assert.equal(oneLine(null), "");
  const long = `${"word ".repeat(60)}end`;
  const cut = oneLine(long);
  assert.ok(cut.length <= SUMMARY_MAX_CHARS + 1);
  assert.ok(cut.endsWith("…"));
  assert.ok(!cut.includes("  "));
});
