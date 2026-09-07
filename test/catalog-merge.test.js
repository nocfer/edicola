// The Publications screen's logic, at the seam the screen calls: the merge of
// the shipped Catalog with the reader's `publications` table, the first-run
// inference from the browser locale, the grouping the screen renders, and the
// add-by-URL lookup against real Feed and HTML fixtures.
//
// Nothing here touches Dexie or the network: the database is a small fake with
// the one table the module uses, and the fetcher is scripted per URL, which is
// what keeps `src/catalog.js` importable and testable under Node. The Nation
// selection is a setting, so it arrives as a parameter and leaves as
// `inferredNations`; `test/settings.test.js` covers the row it lives in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser } from "../tools/testing/dom.js";
import { FetchFailure } from "../src/fetcher.js";
import {
  addCustomPublication,
  customPublicationId,
  CUSTOM_GROUP,
  FeedLookupError,
  findFeeds,
  groupByNation,
  guessOrigin,
  inferPreferences,
  loadPublications,
  mergeCatalog,
  nationsOf,
  normalizeFeedInput,
  removeCustomPublication,
  setPublicationEnabled,
} from "../src/catalog.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/feeds/", import.meta.url));

/** Read one Feed or HTML fixture. */
function fixture(name) {
  return readFileSync(FIXTURES + name, "utf8");
}

/** The shipped Catalog, trimmed to what a merge test needs. */
const CATALOG = {
  version: 1,
  categories: ["news", "politics", "technology", "sport", "local"],
  publications: [
    {
      id: "ansa",
      name: "ANSA",
      country: "IT",
      language: "it",
      category: "news",
      feedUrl: "https://www.ansa.it/sito/ansait_rss.xml",
      siteUrl: "https://www.ansa.it",
      truncated: true,
      note: "Headline and a one-line Summary per Item.",
    },
    {
      id: "il-foglio",
      name: "Il Foglio",
      country: "IT",
      language: "it",
      category: "politics",
      feedUrl: "https://naxos.ilfoglio.it/rss",
      siteUrl: "https://www.ilfoglio.it",
      truncated: false,
    },
    {
      id: "bbc-news",
      name: "BBC News",
      country: "GB",
      language: "en",
      category: "news",
      feedUrl: "https://feeds.bbci.co.uk/news/rss.xml",
      siteUrl: "https://www.bbc.co.uk/news",
      truncated: true,
    },
  ],
};

/** A stored `publications` row with sensible defaults. */
function row(overrides) {
  return {
    id: "x",
    name: "X",
    country: "IT",
    language: "it",
    category: "news",
    feedUrl: "https://example.test/feed",
    siteUrl: "https://example.test",
    truncated: true,
    custom: false,
    enabled: false,
    lastSyncedAt: null,
    lastError: null,
    ...overrides,
  };
}

/**
 * The one table `src/catalog.js` uses, over a plain Map, with the handful of
 * Dexie methods it calls.
 */
function fakeDb(rows = []) {
  const publications = new Map(rows.map((r) => [r.id, { ...r }]));
  const table = (map) => ({
    get: async (key) => map.get(key),
    put: async (value) => {
      map.set(value.id ?? value.key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
    toArray: async () => [...map.values()],
  });
  return {
    publications: table(publications),
    _publications: publications,
  };
}

// --- The merge --------------------------------------------------------------

test("a Catalog entry the reader never touched is off and in the Catalog", () => {
  const entries = mergeCatalog(CATALOG, []);
  assert.equal(entries.length, 3);
  const ansa = entries[0];
  assert.equal(ansa.id, "ansa");
  assert.equal(ansa.enabled, false);
  assert.equal(ansa.custom, false);
  assert.equal(ansa.inCatalog, true);
  assert.equal(ansa.truncated, true);
  assert.equal(ansa.note, "Headline and a one-line Summary per Item.");
  assert.equal(ansa.lastSyncedAt, null);
});

test("the stored row contributes enabled and the Sync history", () => {
  const entries = mergeCatalog(CATALOG, [
    row({
      id: "bbc-news",
      enabled: true,
      lastSyncedAt: 1234,
      lastError: "blocked",
    }),
  ]);
  const bbc = entries.find((e) => e.id === "bbc-news");
  assert.equal(bbc.enabled, true);
  assert.equal(bbc.lastSyncedAt, 1234);
  assert.equal(bbc.lastError, "blocked");
});

test("the Catalog wins over a stale stored copy of its own fields", () => {
  const entries = mergeCatalog(CATALOG, [
    row({
      id: "bbc-news",
      name: "BBC (old name)",
      category: "politics",
      country: "IT",
      feedUrl: "https://old.example/feed",
      enabled: true,
    }),
  ]);
  const bbc = entries.find((e) => e.id === "bbc-news");
  assert.equal(bbc.name, "BBC News");
  assert.equal(bbc.category, "news");
  assert.equal(bbc.country, "GB");
  assert.equal(bbc.feedUrl, "https://feeds.bbci.co.uk/news/rss.xml");
});

test("a new Catalog entry appears without touching the database", () => {
  const before = mergeCatalog({ ...CATALOG, publications: [] }, []);
  assert.deepEqual(before, []);
  const after = mergeCatalog(CATALOG, []);
  assert.deepEqual(
    after.map((e) => e.id),
    ["ansa", "il-foglio", "bbc-news"],
  );
});

test("a removed Catalog entry stays while Enabled, flagged, and goes when off", () => {
  const enabled = mergeCatalog(CATALOG, [
    row({ id: "gone", name: "Gone Daily", enabled: true }),
  ]);
  const kept = enabled.find((e) => e.id === "gone");
  assert.ok(kept, "an Enabled Publication is never dropped by a merge");
  assert.equal(kept.inCatalog, false);
  assert.equal(kept.custom, false);
  assert.equal(kept.name, "Gone Daily");

  const disabled = mergeCatalog(CATALOG, [row({ id: "gone", enabled: false })]);
  assert.equal(
    disabled.find((e) => e.id === "gone"),
    undefined,
  );
});

test("a Custom Publication is passed through untouched, on or off", () => {
  const custom = row({
    id: "custom:1a2b3c4d",
    name: "A Blog",
    country: "FR",
    language: "fr",
    custom: true,
    enabled: false,
    truncated: false,
  });
  const entries = mergeCatalog(CATALOG, [custom]);
  const mine = entries.find((e) => e.id === "custom:1a2b3c4d");
  assert.equal(mine.name, "A Blog");
  assert.equal(mine.country, "FR");
  assert.equal(mine.language, "fr");
  assert.equal(mine.custom, true);
  assert.equal(mine.inCatalog, false);
  assert.equal(mine.truncated, false);
});

test("the merge tolerates an empty or missing Catalog", () => {
  assert.deepEqual(mergeCatalog(null, []), []);
  assert.deepEqual(mergeCatalog(undefined, undefined), []);
  const entries = mergeCatalog({}, [row({ id: "mine", custom: true })]);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["mine"],
  );
});

// --- Nations and grouping ---------------------------------------------------

test("nationsOf keeps the Catalog's order and adds Custom Nations after it", () => {
  const entries = mergeCatalog(CATALOG, [
    row({ id: "custom:9", country: "FR", custom: true }),
  ]);
  assert.deepEqual(nationsOf(entries), ["IT", "GB", "FR"]);
});

test("groups follow the Catalog's Category order, Custom Publications last", () => {
  const entries = mergeCatalog(CATALOG, [
    row({ id: "custom:9", country: "IT", custom: true, category: "news" }),
    row({ id: "retired", country: "IT", category: "gossip", enabled: true }),
  ]);
  const nations = groupByNation(entries, CATALOG.categories);
  assert.deepEqual(
    nations.map((n) => n.country),
    ["IT", "GB"],
  );
  const italy = nations[0];
  assert.deepEqual(
    italy.groups.map((g) => g.category),
    ["news", "politics", "gossip", CUSTOM_GROUP],
  );
  assert.deepEqual(
    italy.groups[0].publications.map((p) => p.id),
    ["ansa"],
  );
  assert.deepEqual(
    italy.groups[3].publications.map((p) => p.id),
    ["custom:9"],
  );
});

// --- First-run inference (ADR-0006) ----------------------------------------

test("an Italian browser gets Italy and Italian", () => {
  assert.deepEqual(inferPreferences(["it-IT", "it", "en-US"], ["IT", "GB"]), {
    nations: ["IT", "GB"],
    lang: "it",
  });
  assert.deepEqual(inferPreferences(["it"], ["IT", "GB"]), {
    nations: ["IT"],
    lang: "it",
  });
});

test("en-GB gets the United Kingdom, any other English gets it too", () => {
  assert.deepEqual(inferPreferences(["en-GB"], ["IT", "GB"]), {
    nations: ["GB"],
    lang: "en",
  });
  assert.deepEqual(inferPreferences(["en-US", "en"], ["IT", "GB"]), {
    nations: ["GB"],
    lang: "en",
  });
});

test("a locale the Catalog does not cover shows every Nation, in English", () => {
  assert.deepEqual(inferPreferences(["fr-FR"], ["IT", "GB"]), {
    nations: ["IT", "GB"],
    lang: "en",
  });
  assert.deepEqual(inferPreferences([], ["IT", "GB"]), {
    nations: ["IT", "GB"],
    lang: "en",
  });
  assert.deepEqual(inferPreferences(undefined, ["IT", "GB"]), {
    nations: ["IT", "GB"],
    lang: "en",
  });
});

test("a region subtag the Catalog covers wins over the Language's Nation", () => {
  assert.deepEqual(inferPreferences(["en-IT"], ["IT", "GB"]), {
    nations: ["IT", "GB"],
    lang: "en",
  });
});

// --- Custom Publication ids and origin guesses -----------------------------

test("a Custom Publication id is stable, per Feed, and cannot be a Catalog slug", () => {
  const id = customPublicationId("https://example.test/feed.xml");
  assert.equal(id, customPublicationId(" https://example.test/feed.xml "));
  assert.match(id, /^custom:[0-9a-f]{8}$/);
  assert.notEqual(id, customPublicationId("https://example.test/other.xml"));
  // Catalog ids are slugs: `^[a-z0-9]+(-[a-z0-9]+)*$` never contains a colon.
  assert.ok(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id));
});

test("the Nation and Language are guessed from the Feed's declared language", () => {
  assert.deepEqual(guessOrigin("it-IT"), { country: "IT", language: "it" });
  assert.deepEqual(guessOrigin("en-gb"), { country: "GB", language: "en" });
  assert.deepEqual(guessOrigin("it"), { country: "IT", language: "it" });
  assert.deepEqual(guessOrigin("en"), { country: "GB", language: "en" });
  assert.deepEqual(guessOrigin("fr-CA"), { country: "CA", language: "fr" });
  assert.deepEqual(guessOrigin(null, { country: "IT", language: "it" }), {
    country: "IT",
    language: "it",
  });
});

// --- Resolving the Nation selection -----------------------------------------

test("first run seeds the Nation selection from the browser locale", async () => {
  const db = fakeDb();
  const data = await loadPublications(db, {
    languages: ["it-IT", "en"],
    catalog: CATALOG,
  });
  assert.deepEqual(data.selectedNations, ["IT", "GB"]);
  assert.equal(data.inferredLang, "it");
  assert.deepEqual(
    data.inferredNations,
    ["IT", "GB"],
    "handed back for the caller to persist",
  );
  assert.deepEqual(data.nations, ["IT", "GB"]);
  assert.equal(data.entries.length, 3);
});

test("a later run uses the saved Nations and infers nothing", async () => {
  const db = fakeDb();
  const data = await loadPublications(db, {
    languages: ["it-IT"],
    catalog: CATALOG,
    selectedNations: ["GB"],
  });
  assert.deepEqual(data.selectedNations, ["GB"]);
  assert.equal(data.inferredNations, null, "nothing to persist");
  assert.equal(data.inferredLang, null);
});

test("a saved Nation the Catalog no longer has falls back to the inference", async () => {
  const db = fakeDb();
  const data = await loadPublications(db, {
    languages: ["en-GB"],
    catalog: CATALOG,
    selectedNations: ["ZZ"],
  });
  assert.deepEqual(data.selectedNations, ["GB"]);
  assert.deepEqual(data.inferredNations, ["GB"]);
  assert.equal(data.inferredLang, null, "the reader's Language is left alone");
});

// --- Writing rows -----------------------------------------------------------

test("switching a Catalog entry on writes the whole row", async () => {
  const db = fakeDb();
  const entry = mergeCatalog(CATALOG, [])[2];
  const written = await setPublicationEnabled(db, entry, true);
  assert.equal(written.id, "bbc-news");
  assert.equal(written.enabled, true);
  assert.equal(written.custom, false);
  assert.equal(written.feedUrl, "https://feeds.bbci.co.uk/news/rss.xml");
  assert.equal("inCatalog" in written, false, "display fields are not stored");
  assert.equal("note" in written, false);
  assert.equal(db._publications.get("bbc-news").enabled, true);

  const off = await setPublicationEnabled(
    db,
    { ...entry, lastSyncedAt: 7 },
    false,
  );
  assert.equal(off.enabled, false);
});

test("switching off keeps the Sync history already on the row", async () => {
  const db = fakeDb([row({ id: "bbc-news", enabled: true, lastSyncedAt: 99 })]);
  const entry = mergeCatalog(CATALOG, await db.publications.toArray())[2];
  const written = await setPublicationEnabled(db, entry, false);
  assert.equal(written.lastSyncedAt, 99);
});

test("a Custom Publication is stored Enabled, keyed by its Feed URL", async () => {
  const db = fakeDb();
  const written = await addCustomPublication(db, {
    feedUrl: "https://blog.example.test/atom.xml",
    country: "it",
    language: "IT",
  });
  assert.equal(written.id, customPublicationId(written.feedUrl));
  assert.equal(written.custom, true);
  assert.equal(written.enabled, true);
  assert.equal(written.country, "IT", "the Nation is upper case");
  assert.equal(written.language, "it", "the Language is lower case");
  assert.equal(written.name, "blog.example.test", "named after its host");
  assert.equal(written.siteUrl, "https://blog.example.test");

  const again = await addCustomPublication(db, {
    feedUrl: "https://blog.example.test/atom.xml",
    name: "A Blog",
    country: "IT",
    language: "it",
  });
  assert.equal(again.id, written.id, "the same Feed is not added twice");
  assert.equal(db._publications.size, 1);
  assert.equal(again.name, "A Blog");
});

test("only a Custom Publication can be removed", async () => {
  const db = fakeDb([
    row({ id: "custom:1", custom: true }),
    row({ id: "ansa" }),
  ]);
  await removeCustomPublication(db, "custom:1");
  assert.equal(db._publications.has("custom:1"), false);
  await assert.rejects(() => removeCustomPublication(db, "ansa"), RangeError);
});

// --- Add by URL -------------------------------------------------------------

/** A fetcher that serves a map of URL → fixture text, and 404s the rest. */
function scriptedFetcher(pages) {
  /** @type {string[]} */
  const requested = [];
  return {
    requested,
    fetcher: {
      async fetchText(url) {
        requested.push(url);
        const body = pages[url];
        if (body === undefined) {
          throw new FetchFailure("not-found", url, { status: 404 });
        }
        if (body instanceof FetchFailure) throw body;
        return {
          text: body,
          finalUrl: url,
          via: "direct",
          status: 200,
          contentType: "",
        };
      },
      async fetchBlob() {
        throw new Error("not used");
      },
      async probe() {
        throw new Error("not used");
      },
    },
  };
}

test("a URL that is itself a Feed needs one request", async () => {
  const url = "https://feeds.bbci.co.uk/news/rss.xml";
  const { fetcher, requested } = scriptedFetcher({
    [url]: fixture("rss2-media-thumbnail-bbc-news.xml"),
  });
  const found = await findFeeds(url, { fetcher, DOMParser });
  assert.equal(found.length, 1);
  assert.equal(found[0].feedUrl, url);
  assert.equal(found[0].format, "rss2");
  assert.equal(found[0].truncated, true, "a Summary-only Feed");
  assert.ok(found[0].itemCount > 0);
  assert.match(found[0].title, /BBC/);
  assert.deepEqual(requested, [url]);
});

test("a full-text JSON Feed is not reported as Truncated", async () => {
  const url = "https://www.jsonfeed.org/feed.json";
  const { fetcher } = scriptedFetcher({
    [url]: fixture("jsonfeed-v1-jsonfeed-org.json"),
  });
  const [found] = await findFeeds(url, { fetcher, DOMParser });
  assert.equal(found.format, "json");
  assert.equal(found.truncated, false);
  assert.equal(found.language, null);
});

test("a site URL is autodiscovered from its advertised alternates", async () => {
  const site = "https://wordpress.org/news/";
  const feed = "https://wordpress.org/news/feed/";
  const { fetcher, requested } = scriptedFetcher({
    [site]: fixture("html-alternate-links-wordpress-news.html"),
    [feed]: fixture("rss2-content-encoded-wordpress-news.xml"),
  });
  const found = await findFeeds("wordpress.org/news/", { fetcher, DOMParser });
  assert.deepEqual(
    found.map((f) => f.feedUrl),
    [feed],
  );
  assert.equal(found[0].format, "rss2");
  assert.equal(requested[0], site, "the page is fetched once, first");
  assert.ok(requested.includes(feed));
  assert.ok(
    !requested.some((u) => u.includes("oembed")),
    "non-Feed alternates are never fetched",
  );
});

test("with nothing advertised, probing stops at the first guess that parses", async () => {
  const site = "https://example.com/";
  const { fetcher, requested } = scriptedFetcher({
    [site]: fixture("html-no-alternate-links-example-com.html"),
    "https://example.com/feed": fixture("atom-github-releases-nodejs.xml"),
    "https://example.com/rss": fixture("rdf-rss10-slashdot.xml"),
  });
  const found = await findFeeds(site, { fetcher, DOMParser });
  assert.equal(found.length, 1);
  assert.equal(found[0].feedUrl, "https://example.com/feed");
  assert.equal(found[0].format, "atom");
  assert.deepEqual(requested, [site, "https://example.com/feed"]);
});

test("a page with no Feed anywhere fails with no-feed", async () => {
  const site = "https://example.com/";
  const { fetcher } = scriptedFetcher({
    [site]: fixture("html-no-alternate-links-example-com.html"),
  });
  await assert.rejects(
    () => findFeeds(site, { fetcher, DOMParser }),
    (error) => {
      assert.ok(error instanceof FeedLookupError);
      assert.equal(error.kind, "no-feed");
      return true;
    },
  );
});

test("the fetcher's kind is what the lookup reports", async () => {
  const site = "https://blocked.example/";
  for (const kind of ["offline", "blocked", "timeout"]) {
    const { fetcher } = scriptedFetcher({
      [site]: new FetchFailure(/** @type {any} */ (kind), site),
    });
    await assert.rejects(
      () => findFeeds(site, { fetcher, DOMParser }),
      (error) => {
        assert.equal(error.name, "FeedLookupError");
        assert.equal(error.kind, kind);
        return true;
      },
    );
  }
});

test("a URL that does not exist reports not-found, not no-feed", async () => {
  const { fetcher } = scriptedFetcher({});
  await assert.rejects(
    () => findFeeds("https://example.com/missing", { fetcher, DOMParser }),
    (error) => {
      assert.equal(error.kind, "not-found");
      return true;
    },
  );
});

test("what the reader pastes is normalized, and nonsense is refused early", async () => {
  assert.equal(normalizeFeedInput("example.com"), "https://example.com/");
  assert.equal(
    normalizeFeedInput("  https://a.test/feed.xml "),
    "https://a.test/feed.xml",
  );
  const { fetcher, requested } = scriptedFetcher({});
  for (const bad of ["", "   ", "javascript:alert(1)", "mailto:a@b.test"]) {
    await assert.rejects(
      () => findFeeds(bad, { fetcher, DOMParser }),
      (error) => {
        assert.equal(error.kind, "invalid-url");
        return true;
      },
    );
  }
  assert.deepEqual(requested, [], "an invalid URL never reaches the network");
});

test("findFeeds insists on a DOMParser", async () => {
  const { fetcher } = scriptedFetcher({});
  await assert.rejects(
    () => findFeeds("https://a.test/", { fetcher, DOMParser: undefined }),
    TypeError,
  );
});
