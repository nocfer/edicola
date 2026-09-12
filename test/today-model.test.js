// Today's grouping rules. Every timestamp here is built from *local* date
// components (`new Date(2026, 0, 15, …)`), so the assertions hold in any
// timezone the test runs in — which is the point: the day an Item lands in is
// the reader's day, not UTC's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverIndexFor, logoCandidates } from "../src/cover.js";
import {
  buildStoryReel,
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
  [
    "bbc-news",
    {
      id: "bbc-news",
      name: "BBC News",
      siteUrl: "https://bbc.test",
      logoUrl: "https://bbc.test/icon.png",
    },
  ],
  // No logoUrl and no siteUrl: nothing to point at and nothing to guess from,
  // so the monogram is the whole identity there.
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

test("a card falls back to its Publication id when the Publication has no name", () => {
  const model = buildTodayModel(
    [item("a", NOW - 3600_000)],
    new Map([["bbc-news", { id: "bbc-news" }]]),
    { now: NOW },
  );
  assert.equal(model.sections[0].cards[0].publicationName, "bbc-news");
});

test("no Publications means no cards, however the argument is missing", () => {
  for (const publications of [new Map(), null, undefined]) {
    const model = buildTodayModel([item("a", NOW - 3600_000)], publications, {
      now: NOW,
    });
    assert.deepEqual(model.sections, []);
    assert.equal(model.itemCount, 0);
  }
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

// --- Feed mode: the flat card list and the rings row -----------------------
//
// Feed mode is one Today screen's second presentation, so its shape is decided
// here and the template only renders it. These tests are the whole proof of
// ticket 02's model half: the same Items, the same Retention window, the same
// filter, arranged as one column instead of day sections, plus one ring per
// Enabled Publication with its state.

test("Feed mode gets one flat card list, newest first, with no day sections", () => {
  const model = buildTodayModel(
    [
      item("old", NOW - 3 * DAY),
      item("new", NOW - 60_000),
      item("mid", NOW - DAY),
    ],
    PUBS,
    { now: NOW },
  );
  assert.deepEqual(
    model.cards.map((card) => card.id),
    ["new", "mid", "old"],
  );
  assert.ok(
    model.sections.length > 1,
    "List mode still groups the same cards by day",
  );
});

test("the flat list and the day sections hold the very same cards", () => {
  const model = buildTodayModel(
    [item("a", NOW - 60_000), item("b", NOW - DAY)],
    PUBS,
    { now: NOW },
  );
  const inSections = model.sections.flatMap((section) => section.cards);
  assert.equal(inSections.length, model.cards.length);
  for (const card of inSections) {
    assert.ok(
      model.cards.includes(card),
      `${card.id} is a different object in each arrangement`,
    );
  }
});

test("the filter applies to the flat list exactly as it does to the sections", () => {
  const model = buildTodayModel(
    [item("a", NOW), item("n", NOW, { publicationId: "nature" })],
    PUBS,
    { now: NOW, filterPublicationId: "nature" },
  );
  assert.deepEqual(
    model.cards.map((card) => card.id),
    ["n"],
  );
  assert.equal(model.cardCount, 1);
});

test("every card carries its Publication's monogram and ramp index", () => {
  const model = buildTodayModel([item("a", NOW)], PUBS, { now: NOW });
  const card = model.cards[0];
  assert.equal(card.monogram, "BN", "BBC News");
  assert.equal(card.coverIndex, coverIndexFor("bbc-news"));
  assert.ok(card.coverIndex >= 1 && card.coverIndex <= 8);
});

test("the Publication's logo candidates reach every shape that draws its tile", () => {
  // Cards, rings and a reel all feed the same `publicationTile`, so a chain
  // that rides onto one and not the others is the same Publication showing a
  // logo in the ring and initials on the card below it.
  const items = [
    item("a", NOW),
    item("n", NOW - 1000, { publicationId: "nature" }),
  ];
  const chain = logoCandidates(PUBS.get("bbc-news"));
  const model = buildTodayModel(items, PUBS, { now: NOW });
  assert.deepEqual(model.cards[0].logoUrls, chain);
  assert.deepEqual(model.cards[1].logoUrls, [], "Nature has nothing to try");
  assert.deepEqual(model.rings[0].logoUrls, chain);
  assert.deepEqual(model.rings[1].logoUrls, []);
  const reel = buildStoryReel(items, PUBS, {
    now: NOW,
    publicationId: "bbc-news",
  });
  assert.deepEqual(reel.logoUrls, chain);
});

test("a card with no resolved source falls back to a generated Cover", () => {
  // The view resolves sources against the `images` table and hands the map in;
  // with no map every card is a Cover, which is the honest answer offline.
  const model = buildTodayModel([item("a", NOW)], PUBS, { now: NOW });
  assert.deepEqual(model.cards[0].cover, { kind: "cover", url: null });
});

test("a resolved source reaches the card untouched", () => {
  const model = buildTodayModel([item("a", NOW), item("b", NOW - 1000)], PUBS, {
    now: NOW,
    coverSources: new Map([
      ["a", { kind: "blob", url: "blob:x" }],
      ["b", { kind: "network", url: "https://pub.test/p.jpg" }],
    ]),
  });
  assert.deepEqual(model.cards[0].cover, { kind: "blob", url: "blob:x" });
  assert.deepEqual(model.cards[1].cover, {
    kind: "network",
    url: "https://pub.test/p.jpg",
  });
});

test("there is one ring per Enabled Publication, in the caller's order", () => {
  const model = buildTodayModel([item("a", NOW)], PUBS, { now: NOW });
  assert.deepEqual(
    model.rings.map((ring) => ring.publicationId),
    ["bbc-news", "nature"],
    "a Publication with nothing in the window still gets a ring",
  );
  assert.equal(model.rings[0].name, "BBC News");
  assert.equal(model.rings[0].monogram, "BN");
  assert.equal(model.rings[1].monogram, "NA");
});

test("a ring with Unread Items nobody has Seen is unseen", () => {
  const model = buildTodayModel([item("a", NOW), item("b", NOW - 1000)], PUBS, {
    now: NOW,
  });
  assert.equal(model.rings[0].state, "unseen");
  assert.equal(model.rings[0].unread, 2);
  assert.equal(model.rings[0].reelCount, 2);
});

test("a ring whose whole reel is Seen dims, and its Unread count does not move", () => {
  // The guarantee the design rests on: Seen is not Read.
  const model = buildTodayModel(
    [item("a", NOW, { seen: true }), item("b", NOW - 1000, { seen: true })],
    PUBS,
    { now: NOW },
  );
  assert.equal(model.rings[0].state, "seen");
  assert.equal(model.rings[0].unread, 2, "Unread counts only fall on Read");
  assert.equal(model.chips[0].unread, 2, "and the chip agrees");
});

test("one unseen Item in the reel keeps the whole ring unseen", () => {
  const model = buildTodayModel(
    [item("a", NOW, { seen: true }), item("b", NOW - 1000)],
    PUBS,
    { now: NOW },
  );
  assert.equal(model.rings[0].state, "unseen");
});

test("marking the last Item Seen is what flips the ring from unseen to seen", () => {
  const rows = [item("a", NOW), item("b", NOW - 1000, { seen: true })];
  assert.equal(
    buildTodayModel(rows, PUBS, { now: NOW }).rings[0].state,
    "unseen",
  );
  rows[0].seen = true;
  assert.equal(
    buildTodayModel(rows, PUBS, { now: NOW }).rings[0].state,
    "seen",
  );
});

test("a Publication with nothing Unread has no reel at all", () => {
  const model = buildTodayModel(
    [
      item("a", NOW, { read: true, seen: true }),
      item("b", NOW - 1000, { read: true }),
    ],
    PUBS,
    { now: NOW },
  );
  assert.equal(model.rings[0].state, "none");
  assert.equal(model.rings[0].reelCount, 0);
  assert.equal(model.rings[0].unread, 0);
});

test("a Publication with no Items in the window has no reel either", () => {
  const model = buildTodayModel([item("a", NOW)], PUBS, { now: NOW });
  assert.equal(model.rings[1].publicationId, "nature");
  assert.equal(model.rings[1].state, "none");
});

test("a Read Item is out of the reel even when it was never Seen", () => {
  // A reel is the Publication's Unread Items: reading one in the Reader takes
  // it out, which is why the ring can go quiet without a single Frame.
  const model = buildTodayModel(
    [item("a", NOW, { read: true }), item("b", NOW - 1000)],
    PUBS,
    { now: NOW },
  );
  assert.equal(model.rings[0].reelCount, 1);
  assert.equal(model.rings[0].state, "unseen");
});

test("the active filter is echoed on its ring, so the row can show it", () => {
  const model = buildTodayModel([item("a", NOW)], PUBS, {
    now: NOW,
    filterPublicationId: "nature",
  });
  assert.equal(model.rings[0].active, false);
  assert.equal(model.rings[1].active, true);
});

test("an Item outside the Retention window is in no reel", () => {
  const model = buildTodayModel(
    [item("a", NOW - 40 * DAY), item("b", NOW)],
    PUBS,
    { now: NOW, limits: { maxAgeDays: 30, keepPerPublication: 50 } },
  );
  assert.equal(model.rings[0].reelCount, 1);
  assert.equal(model.cards.length, 1);
});

// --- The Story reel --------------------------------------------------------
//
// A reel is one Publication's Unread Items inside Today's window, newest
// first. It goes through `buildTodayModel`, so a Frame is the very same card
// the feed renders and cannot disagree with it about the window, the order or
// the picture.

test("a reel is that Publication's Unread Items, newest first", () => {
  const reel = buildStoryReel(
    [
      item("a", NOW - 60_000),
      item("b", NOW - DAY),
      item("n", NOW, { publicationId: "nature" }),
    ],
    PUBS,
    { publicationId: "bbc-news", now: NOW },
  );
  assert.equal(reel.publicationId, "bbc-news");
  assert.equal(reel.name, "BBC News");
  assert.equal(reel.monogram, "BN");
  assert.deepEqual(
    reel.frames.map((frame) => frame.id),
    ["a", "b"],
    "another Publication's Items are not in this reel",
  );
});

test("a Read Item is out of the reel; a Seen one is still in it", () => {
  const reel = buildStoryReel(
    [
      item("read", NOW, { read: true }),
      item("seen", NOW - 1000, { seen: true }),
      item("fresh", NOW - 2000),
    ],
    PUBS,
    { publicationId: "bbc-news", now: NOW },
  );
  assert.deepEqual(
    reel.frames.map((frame) => frame.id),
    ["seen", "fresh"],
  );
});

test("a reel opens at the first Frame that has not been Seen", () => {
  // The reader tapped through three Frames, closed the player and came back:
  // they must land on the fourth, not replay what they already looked at.
  // `seen` is written on display and is what places them (ticket 03).
  const reel = buildStoryReel(
    [
      item("a", NOW, { seen: true }),
      item("b", NOW - 1000, { seen: true }),
      item("c", NOW - 2000, { seen: true }),
      item("d", NOW - 3000),
      item("e", NOW - 4000),
    ],
    PUBS,
    { publicationId: "bbc-news", now: NOW },
  );
  assert.equal(reel.frames.length, 5, "a Seen Frame stays in the reel");
  assert.equal(reel.startIndex, 3);
  assert.equal(reel.frames[reel.startIndex].id, "d");
});

test("a reel every Frame of which is Seen opens at the top again", () => {
  // Nothing left to catch up on, so the tap is a replay rather than a dead
  // end. The ring is already dim, which is what tells the reader that.
  const reel = buildStoryReel(
    [item("a", NOW, { seen: true }), item("b", NOW - 1000, { seen: true })],
    PUBS,
    { publicationId: "bbc-news", now: NOW },
  );
  assert.equal(reel.startIndex, 0);
});

test("a Publication with nothing Unread has no reel", () => {
  const reel = buildStoryReel([item("a", NOW, { read: true })], PUBS, {
    publicationId: "bbc-news",
    now: NOW,
  });
  assert.deepEqual(reel.frames, []);
});

test("the reel stops at the Retention window, like the feed", () => {
  const reel = buildStoryReel(
    [item("old", NOW - 40 * DAY), item("new", NOW)],
    PUBS,
    {
      publicationId: "bbc-news",
      now: NOW,
      limits: { maxAgeDays: 30, keepPerPublication: 50 },
    },
  );
  assert.deepEqual(
    reel.frames.map((frame) => frame.id),
    ["new"],
  );
});

test("a Frame is the same card the feed renders, picture and all", () => {
  const reel = buildStoryReel([item("a", NOW)], PUBS, {
    publicationId: "bbc-news",
    now: NOW,
    coverSources: new Map([["a", { kind: "network", url: "https://p/x.jpg" }]]),
  });
  const frame = reel.frames[0];
  assert.deepEqual(frame.cover, { kind: "network", url: "https://p/x.jpg" });
  assert.equal(frame.monogram, "BN");
  assert.equal(frame.coverIndex, coverIndexFor("bbc-news"));
});

test("a Publication that is not Enabled has no reel rather than throwing", () => {
  const reel = buildStoryReel([item("a", NOW)], PUBS, {
    publicationId: "not-enabled",
    now: NOW,
  });
  assert.deepEqual(reel.frames, []);
  assert.equal(reel.name, "not-enabled", "the id still labels the player");
});

test("a full pass through a reel leaves every Item Seen and every Item Unread", () => {
  // The guarantee the whole design rests on, end to end through the model: the
  // ring dims, and the chip's Unread count does not move.
  const rows = [item("a", NOW), item("b", NOW - 1000), item("c", NOW - 2000)];
  const reel = buildStoryReel(rows, PUBS, {
    publicationId: "bbc-news",
    now: NOW,
  });
  assert.equal(reel.frames.length, 3);

  // What the player does to each Frame it shows — `markItemSeen` writes
  // exactly this field and no other (see test/item-state.test.js).
  for (const frame of reel.frames) {
    rows.find((row) => row.id === frame.id).seen = true;
  }

  const after = buildTodayModel(rows, PUBS, { now: NOW });
  assert.equal(after.rings[0].state, "seen", "the ring dims");
  assert.equal(after.rings[0].unread, 3, "and the Unread count does not move");
  assert.equal(after.chips[0].unread, 3, "nor does the chip's");
  assert.ok(
    rows.every((row) => !row.read),
    "nothing in a Story marks an Item Read",
  );
});
