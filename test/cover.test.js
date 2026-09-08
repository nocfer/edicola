// Publication identity and the image slot: the monogram rule board 09 states
// verbatim, the stable ramp index, and "what fills this Item's picture".
//
// The monogram cases are read off boards 09 and 10 rather than derived, so
// changing any of them changes the design and this test says so. The source
// resolution runs against a stand-in for the `images` table, the same way
// test/article-render.test.js does, because a feed that cannot read the
// database must still render.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COVER_RAMP_SIZE,
  coverIndexFor,
  monogramFor,
  resolveCoverSources,
} from "../src/cover.js";

// --- The monogram rule -----------------------------------------------------

// Board 09: "Initials of the first two significant words, uppercased. Articles
// and particles are dropped (la, il, the, of, dello), digits are skipped, an
// internal capital splits a compound. One significant word left gives its
// first two letters."
const MONOGRAMS = [
  ["ANSA", "AN"], // one significant word, first two letters
  ["la Repubblica", "RE"], // drop `la`, then first two letters
  ["The Guardian", "GU"], // drop `the`, then first two letters
  ["La Stampa", "ST"], // drop `La`, then first two letters
  ["Focus", "FO"], // one word
  ["Nature", "NA"], // one word
  ["Il Sole 24 Ore", "SO"], // drop `Il`, skip `24`, take Sole + Ore
  ["Corriere dello Sport", "CS"], // drop `dello`
  ["BBC News", "BN"], // first letter of each word
  ["BBC Sport", "BS"], // first letter of each word
  ["London Review of Books", "LR"], // drop `of`, cap at two
  ["Manchester Evening News", "ME"], // cap at two
  ["Rivista Studio", "RS"], // first letters
  ["TechRadar", "TR"], // an internal capital splits the compound
  ["openDemocracy", "OD"], // the same clause, lower case first
];

for (const [name, expected] of MONOGRAMS) {
  test(`the monogram for ${name} is ${expected}`, () => {
    assert.equal(monogramFor(name), expected);
  });
}

test("particle matching ignores case, so la and La both go", () => {
  assert.equal(monogramFor("la Repubblica"), monogramFor("La Repubblica"));
  assert.equal(monogramFor("THE GUARDIAN"), "GU");
});

test("a name of nothing but particles keeps its particles rather than throwing", () => {
  // A Custom Publication someone named "The" has to get a monogram: dropping
  // every word would leave the ring blank, so the filter is reverted.
  assert.equal(monogramFor("The"), "TH");
  assert.equal(monogramFor("Il"), "IL");
});

test("a one-letter name gives that one letter", () => {
  assert.equal(monogramFor("Z"), "Z");
});

test("a name with no letters at all falls back to its characters", () => {
  assert.equal(monogramFor("24"), "24");
  assert.equal(monogramFor("24 Ore"), "OR");
});

test("a blank or missing name gives the placeholder, never an exception", () => {
  assert.equal(monogramFor(""), "?");
  assert.equal(monogramFor("   "), "?");
  assert.equal(monogramFor(null), "?");
  assert.equal(monogramFor(undefined), "?");
  assert.equal(monogramFor("—"), "?");
});

// --- The ramp index --------------------------------------------------------

test("the ramp index is inside the ramp for every id", () => {
  for (const id of [
    "ansa",
    "bbc-news",
    "la-repubblica",
    "il-sole-24-ore",
    "custom:1758",
    "",
  ]) {
    const index = coverIndexFor(id);
    assert.ok(
      Number.isInteger(index) && index >= 1 && index <= COVER_RAMP_SIZE,
      `${id} landed on ${index}`,
    );
  }
});

test("two known ids keep their index", () => {
  // Pinned so a Publication's colour cannot change under the reader across a
  // reload or between two devices. Changing the hash changes these numbers.
  assert.equal(coverIndexFor("bbc-news"), 7);
  assert.equal(coverIndexFor("la-repubblica"), 5);
});

test("the index is stable across calls and independent of anything ambient", () => {
  const once = coverIndexFor("il-sole-24-ore");
  assert.equal(coverIndexFor("il-sole-24-ore"), once);
  assert.equal(coverIndexFor(String("il-sole-24-ore")), once);
});

test("the ramp has the eight fills the design settled on", () => {
  assert.equal(COVER_RAMP_SIZE, 8);
});

// --- The image slot --------------------------------------------------------

/** The same rule `imageKeyFor` follows — a key derived from the URL alone. */
async function fakeKeyFor(url) {
  return `key:${url}`;
}

/**
 * A stand-in for the `images` table: `bulkGet` over a Map, the one call the
 * resolver makes.
 * @param {Record<string, Blob>} byUrl
 */
function fakeDb(byUrl) {
  const rows = new Map(
    Object.entries(byUrl).map(([url, blob]) => [
      `key:${url}`,
      { key: `key:${url}`, url, blob, bytes: blob.size, itemId: "i" },
    ]),
  );
  return {
    images: {
      bulkGet: async (keys) => keys.map((key) => rows.get(key)),
    },
  };
}

/** An `images` table that cannot be read. */
const brokenDb = {
  images: {
    bulkGet: async () => {
      throw new Error("IndexedDB is not available");
    },
  },
};

function fakeUrls() {
  const created = [];
  return {
    created,
    createObjectURL(blob) {
      const url = `blob:fake/${created.length}`;
      created.push({ url, blob });
      return url;
    },
  };
}

const PHOTO = "https://pub.test/photo.jpg";
const ELSEWHERE = "https://pub.test/other.jpg";

/** @param {object[]} items @param {Record<string, Blob>} images */
function resolve(items, images, db = fakeDb(images), urls = fakeUrls()) {
  return resolveCoverSources(items, {
    db,
    imageKeyFor: fakeKeyFor,
    createObjectURL: urls.createObjectURL,
  });
}

test("a thumbnail we already hold is served from its blob", async () => {
  const blob = new Blob(["bytes"], { type: "image/jpeg" });
  const { sources, objectUrls } = await resolve(
    [{ id: "a", thumbnailUrl: PHOTO }],
    { [PHOTO]: blob },
  );
  assert.deepEqual(sources.get("a"), { kind: "blob", url: "blob:fake/0" });
  assert.deepEqual(objectUrls, ["blob:fake/0"]);
});

test("a thumbnail with no stored blob stays on the publisher's URL", async () => {
  const { sources, objectUrls } = await resolve(
    [{ id: "a", thumbnailUrl: ELSEWHERE }],
    {},
  );
  assert.deepEqual(sources.get("a"), { kind: "network", url: ELSEWHERE });
  assert.deepEqual(objectUrls, []);
});

test("an Item with no thumbnail gets a generated Cover", async () => {
  const { sources } = await resolve([{ id: "a", thumbnailUrl: null }], {});
  assert.deepEqual(sources.get("a"), { kind: "cover", url: null });
});

test("a non-http thumbnail is not trusted with the network either", async () => {
  const { sources } = await resolve(
    [{ id: "a", thumbnailUrl: "javascript:alert(1)" }],
    {},
  );
  assert.deepEqual(sources.get("a"), { kind: "cover", url: null });
});

test("one blob is created per URL, however many Items share it", async () => {
  const blob = new Blob(["bytes"], { type: "image/jpeg" });
  const { sources, objectUrls } = await resolve(
    [
      { id: "a", thumbnailUrl: PHOTO },
      { id: "b", thumbnailUrl: PHOTO },
    ],
    { [PHOTO]: blob },
  );
  assert.equal(sources.get("a")?.url, sources.get("b")?.url);
  assert.deepEqual(objectUrls, ["blob:fake/0"]);
});

test("an images table that throws leaves every Item on the network", async () => {
  const { sources, objectUrls } = await resolve(
    [
      { id: "a", thumbnailUrl: PHOTO },
      { id: "b", thumbnailUrl: null },
    ],
    {},
    brokenDb,
  );
  assert.deepEqual(sources.get("a"), { kind: "network", url: PHOTO });
  assert.deepEqual(sources.get("b"), { kind: "cover", url: null });
  assert.deepEqual(objectUrls, []);
});

test("no thumbnails at all means the database is never touched", async () => {
  let calls = 0;
  const db = {
    images: {
      bulkGet: async () => {
        calls += 1;
        return [];
      },
    },
  };
  const { sources } = await resolve([{ id: "a", thumbnailUrl: "" }], {}, db);
  assert.equal(calls, 0);
  assert.deepEqual(sources.get("a"), { kind: "cover", url: null });
});
