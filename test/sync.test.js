// The Sync pipeline at its seam (spec, "Proposed seams" 1): the highest one in
// the app. `runSync` gets an in-memory SyncStore, a fetcher whose answers are
// scripted per URL from the real fixture corpus, and the real parseFeed,
// extractArticle and sanitizeSummary over jsdom (ADR-0010). So these tests
// cover Feed parsing, sanitizing, keying, the caps, round-robin order, the
// retry, the Summary-only fallback and the image budget together, and none of
// them reaches inside the pipeline: they assert what was stored and what was
// fetched, in what order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readability, purifierFor, windowFor } from "../tools/testing/dom.js";
import { DOMParser } from "../tools/testing/dom.js";
import { extractArticle, sanitizeSummary } from "../src/extract-core.js";
import { parseFeed } from "../src/feed.js";
import { FetchFailure } from "../src/fetcher.js";
import { planItemTrim } from "../src/retention.js";
import { runSync } from "../src/sync.js";

const FIXTURES = resolve(fileURLToPath(import.meta.url), "../fixtures");

/** @param {string} relativePath */
function fixture(relativePath) {
  return readFileSync(resolve(FIXTURES, relativePath), "utf8");
}

const purify = purifierFor(windowFor());

/** The real Extraction and sanitizer, bound to the Node DOM. */
const deps = {
  parseFeed,
  DOMParser,
  extractArticle: (/** @type {string} */ html, /** @type {string} */ url) =>
    extractArticle(html, { url, windowFor, Readability, purify }),
  sanitizeSummary: (/** @type {string} */ html) =>
    sanitizeSummary(html, purify),
};

const ANSA = {
  id: "ansa",
  name: "ANSA",
  country: "IT",
  language: "it",
  category: "news",
  feedUrl: "https://www.ansa.it/sito/ansait_rss.xml",
  siteUrl: "https://www.ansa.it",
  truncated: true,
  custom: false,
  enabled: true,
};

const BBC = {
  id: "bbc-news",
  name: "BBC News",
  country: "GB",
  language: "en",
  category: "news",
  feedUrl: "https://feeds.bbci.co.uk/news/rss.xml",
  siteUrl: "https://www.bbc.co.uk/news",
  truncated: true,
  custom: false,
  enabled: true,
};

/** Fields a Sync may refresh on an Item it has already stored. */
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
 * An in-memory `SyncStore`: plain Maps, the same contract as the Dexie one in
 * src/store.js, and nothing that needs IndexedDB. The Maps are returned so a
 * test can read what the pipeline stored.
 * @param {object[]} publications
 * @param {object[]} [items]
 */
function memoryStore(publications, items = []) {
  const pubs = new Map(publications.map((p) => [p.id, { ...p }]));
  const rows = new Map(items.map((i) => [i.id, { ...i }]));
  /** @type {Map<string, any>} */
  const articles = new Map();
  /** @type {Map<string, any>} */
  const images = new Map();
  /** @type {Map<string, any>} */
  const meta = new Map();

  const store = {
    async getEnabledPublications() {
      return [...pubs.values()].filter((p) => Boolean(p.enabled));
    },
    async upsertItems(list) {
      for (const item of list) {
        const previous = rows.get(item.id);
        if (!previous) {
          rows.set(item.id, { ...item });
          continue;
        }
        for (const field of FEED_FIELDS) previous[field] = item[field];
      }
      return list.length;
    },
    async itemsNeedingArticles(publicationIds) {
      const byPublication = new Map();
      for (const id of publicationIds) {
        byPublication.set(
          id,
          [...rows.values()].filter(
            (i) => i.publicationId === id && !i.hasArticle && !i.summaryOnly,
          ),
        );
      }
      return byPublication;
    },
    async putArticle(article) {
      articles.set(article.itemId, article);
      const item = rows.get(article.itemId);
      if (item) {
        item.hasArticle = true;
        item.summaryOnly = false;
        item.summaryOnlyReason = null;
      }
    },
    async putImages(itemId, list) {
      let bytes = 0;
      for (const image of list) {
        const size = image.bytes ?? image.blob.size;
        images.set(`${itemId} ${image.url}`, { ...image, itemId, bytes: size });
        bytes += size;
      }
      return bytes;
    },
    async markSummaryOnly(itemId, reason) {
      const item = rows.get(itemId);
      if (item) {
        item.summaryOnly = true;
        item.summaryOnlyReason = reason;
        item.hasArticle = false;
      }
    },
    async setPublicationSynced(publicationId, status) {
      const publication = pubs.get(publicationId);
      if (publication) {
        publication.lastSyncedAt = status.at;
        publication.lastError = status.error ?? null;
      }
    },
    async setLastSyncAt(at) {
      meta.set("lastSyncAt", at);
    },
    async trimItems(publicationId, limits) {
      const mine = [...rows.values()].filter(
        (i) => i.publicationId === publicationId,
      );
      const doomed = planItemTrim(mine, limits);
      for (const id of doomed) {
        rows.delete(id);
        articles.delete(id);
      }
      return doomed;
    },
    async getMeta(key) {
      return meta.get(key);
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
  };
  return { store, pubs, rows, articles, images, meta };
}

/**
 * A fetcher whose answers are scripted per URL. `text` maps a URL to a body or
 * an Error to throw; `blobs` maps an image URL to its byte size. Anything not
 * named falls back to `defaultText` / `defaultBlobBytes`, and an unknown URL
 * with no fallback is a `not-found`. Every call is recorded in order.
 *
 * @param {{ text?: Record<string, string|Error>, defaultText?: string,
 *           blobs?: Record<string, number|Error>, defaultBlobBytes?: number }} script
 */
function scriptedFetcher({
  text = {},
  defaultText,
  blobs = {},
  defaultBlobBytes = 512,
} = {}) {
  /** @type {Array<{ kind: 'text'|'blob', url: string, maxBytes?: number }>} */
  const calls = [];
  const fetcher = {
    async fetchText(url) {
      calls.push({ kind: "text", url });
      const entry = text[url] ?? defaultText;
      if (entry === undefined) {
        throw new FetchFailure("not-found", url, { status: 404 });
      }
      if (entry instanceof Error) throw entry;
      return {
        finalUrl: url,
        via: "direct",
        status: 200,
        contentType: "text/html",
        text: entry,
      };
    },
    async fetchBlob(url, { maxBytes = Infinity } = {}) {
      calls.push({ kind: "blob", url, maxBytes });
      const entry = blobs[url] ?? defaultBlobBytes;
      if (entry instanceof Error) throw entry;
      if (entry > maxBytes) {
        throw new FetchFailure("too-large", url, { status: 200 });
      }
      return {
        finalUrl: url,
        via: "direct",
        status: 200,
        contentType: "image/jpeg",
        blob: new Blob([new Uint8Array(entry)], { type: "image/jpeg" }),
      };
    },
    async probe(url) {
      calls.push({ kind: "text", url });
      return {
        finalUrl: url,
        via: "direct",
        status: 200,
        contentType: "text/html",
      };
    },
  };
  return { fetcher, calls };
}

/** A clock that never repeats, so `fetchedAt` is comparable. */
function fakeClock(start = Date.UTC(2026, 8, 7, 12, 0, 0)) {
  let t = start;
  return () => {
    t += 1000;
    return t;
  };
}

/** Records how often the pipeline handed the event loop back. */
function countingYield() {
  const state = { calls: 0 };
  return {
    state,
    yieldToUi: async () => {
      state.calls += 1;
    },
  };
}

const ANSA_FEED = fixture("feeds/rss2-empty-channel-link-ansa.xml");
const BBC_FEED = fixture("feeds/rss2-media-thumbnail-bbc-news.xml");
const BBC_FEED_12 = fixture("sync/rss2-twelve-items-bbc-news.xml");
const ANSA_FEED_INJECTED = fixture(
  "sync/rss2-injected-markup-summary-ansa.xml",
);
const LONG_ARTICLE = fixture("articles/bbc-news-long-article.html");
const THIN_ARTICLE = fixture("articles/thetimes-paywall-teaser.html");

/** Image URLs the real Extraction finds in the long Article fixture. */
const LONG_ARTICLE_IMAGES = deps.extractArticle(
  LONG_ARTICLE,
  "https://www.bbc.co.uk/news/articles/cr4vn1e207go",
).imageUrls;

// --- Items -------------------------------------------------------------------

test("Items are stored keyed publicationId:feedItemId, newest date preserved", async () => {
  const { store, rows, meta } = memoryStore([ANSA]);
  const { fetcher } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED },
    defaultText: THIN_ARTICLE,
  });
  const now = fakeClock();

  const summary = await runSync({ ...deps, store, fetcher, now });

  assert.equal(summary.feedsOk, 1);
  assert.equal(summary.feedsFailed, 0);
  assert.equal(summary.itemsStored, 3);
  assert.equal(rows.size, 3);
  const feed = parseFeed(ANSA_FEED, { url: ANSA.feedUrl, DOMParser });
  for (const item of feed.items) {
    const stored = rows.get(`ansa:${item.id}`);
    assert.ok(stored, `no Item stored for ansa:${item.id}`);
    assert.equal(stored.publicationId, "ansa");
    assert.equal(stored.feedItemId, item.id);
    assert.equal(stored.link, item.link);
    assert.equal(stored.publishedAt, Date.parse(item.publishedAt));
    assert.equal(stored.read, false);
    assert.equal(stored.saved, 0);
    assert.equal(stored.hasArticle, false);
  }
  assert.ok(meta.get("lastSyncAt") > 0, "lastSyncAt was not written");
});

test("an undated Item is stamped with the fetch time, not left undated", async () => {
  // The RDF/RSS 1.0 Feed's items carry dc:date; strip it to make them undated.
  const undated = fixture("feeds/rdf-rss10-slashdot.xml").replace(
    /<dc:date>[^<]*<\/dc:date>/g,
    "",
  );
  const publication = { ...ANSA, feedUrl: "https://slashdot.test/rss" };
  const { store, rows } = memoryStore([publication]);
  const { fetcher } = scriptedFetcher({
    text: { [publication.feedUrl]: undated },
    defaultText: THIN_ARTICLE,
  });
  const now = fakeClock();

  await runSync({ ...deps, store, fetcher, now });

  assert.ok(rows.size > 0);
  for (const item of rows.values()) {
    assert.ok(
      Number.isFinite(item.publishedAt) && item.publishedAt > 0,
      `publishedAt is ${item.publishedAt}`,
    );
    assert.equal(item.publishedAt, item.fetchedAt);
  }
});

test("Summaries are sanitized before they reach storage", async () => {
  const { store, rows } = memoryStore([ANSA]);
  const { fetcher } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED_INJECTED },
    defaultText: THIN_ARTICLE,
  });

  await runSync({ ...deps, store, fetcher, now: fakeClock() });

  const injected = [...rows.values()].find((i) =>
    i.summaryText.includes("Koreeda"),
  );
  assert.ok(injected, "the item with the injected Summary was not stored");
  assert.doesNotMatch(
    injected.summaryHtml,
    /<script|<iframe|<img|onerror|onclick|javascript:|class=|style=/i,
  );
  assert.match(injected.summaryHtml, /In concorso anche Koreeda/);
  assert.match(injected.summaryText, /I figli della scimmia con Scamarcio/);
  assert.doesNotMatch(injected.summaryText, /[<>]/);
});

test("a second Sync refreshes Feed fields and keeps the reader's state", async () => {
  const { store, rows } = memoryStore([ANSA]);
  const { fetcher } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED },
    defaultText: THIN_ARTICLE,
  });
  await runSync({ ...deps, store, fetcher, now: fakeClock() });

  const [id] = [...rows.keys()];
  rows.get(id).read = true;
  rows.get(id).saved = 1;
  rows.get(id).readingPosition = 0.42;

  await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.equal(rows.size, 3, "a re-listed Item must not be duplicated");
  assert.equal(rows.get(id).read, true);
  assert.equal(rows.get(id).saved, 1);
  assert.equal(rows.get(id).readingPosition, 0.42);
});

// --- Articles ----------------------------------------------------------------

test("Pre-fetch stops at 10 Articles per Publication per Sync", async () => {
  const { store, rows } = memoryStore([BBC]);
  const { fetcher, calls } = scriptedFetcher({
    text: { [BBC.feedUrl]: BBC_FEED_12 },
    defaultText: THIN_ARTICLE,
  });

  const summary = await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.equal(rows.size, 12, "all twelve Items are stored");
  const originals = calls.filter(
    (c) => c.kind === "text" && c.url !== BBC.feedUrl,
  );
  assert.equal(originals.length, 10, "only ten Originals are fetched");
  assert.equal(summary.articlesSummaryOnly, 10);
  assert.equal(summary.articlesOk, 0);
});

test("Articles are fetched round-robin across Publications", async () => {
  const { store } = memoryStore([BBC, ANSA]);
  const { fetcher, calls } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED, [BBC.feedUrl]: BBC_FEED },
    defaultText: THIN_ARTICLE,
  });

  // Concurrency 1 so the recorded order is the queue order, not a race.
  await runSync({
    ...deps,
    store,
    fetcher,
    now: fakeClock(),
    concurrency: 1,
  });

  const feedUrls = new Set([ANSA.feedUrl, BBC.feedUrl]);
  const order = calls
    .filter((c) => c.kind === "text" && !feedUrls.has(c.url))
    .map((c) => (c.url.includes("ansa.it") ? "ansa" : "bbc-news"));
  // ANSA has three Items, BBC four: one from each in turn, then BBC's leftover.
  assert.deepEqual(order, [
    "ansa",
    "bbc-news",
    "ansa",
    "bbc-news",
    "ansa",
    "bbc-news",
    "bbc-news",
  ]);
});

test("a thin Original leaves the Item Summary-only with reason too-short", async () => {
  const { store, rows, articles } = memoryStore([ANSA]);
  const { fetcher } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED },
    defaultText: THIN_ARTICLE,
  });

  const summary = await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.equal(summary.articlesOk, 0);
  assert.equal(summary.articlesSummaryOnly, 3);
  assert.equal(articles.size, 0);
  for (const item of rows.values()) {
    assert.equal(item.summaryOnly, true);
    assert.equal(item.summaryOnlyReason, "too-short");
    assert.equal(item.hasArticle, false);
  }
});

test("a full Original is stored as an Article with its images", async () => {
  const { store, rows, articles, images } = memoryStore([BBC]);
  const { fetcher } = scriptedFetcher({
    text: { [BBC.feedUrl]: BBC_FEED },
    defaultText: LONG_ARTICLE,
    defaultBlobBytes: 4096,
  });

  const summary = await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.equal(summary.articlesOk, 4);
  assert.equal(summary.articlesSummaryOnly, 0);
  assert.equal(articles.size, 4);
  assert.equal(images.size, 4 * LONG_ARTICLE_IMAGES.length);
  assert.equal(summary.imagesStored, 4 * LONG_ARTICLE_IMAGES.length);
  assert.ok(summary.bytesStored > 0);
  for (const item of rows.values()) {
    assert.equal(item.hasArticle, true);
    assert.equal(item.summaryOnly, false);
  }
  for (const article of articles.values()) {
    assert.ok(article.wordCount >= 200, `words ${article.wordCount}`);
    assert.ok(article.bytes > 0);
    assert.match(article.html, /<p>/);
    assert.doesNotMatch(article.html, /<script|onerror=|\sclass=/i);
  }
});

test("an image over the per-Article cap is skipped and the Article still stored", async () => {
  const oversized = LONG_ARTICLE_IMAGES[0];
  const { store, articles, images } = memoryStore([BBC]);
  const { fetcher } = scriptedFetcher({
    text: { [BBC.feedUrl]: BBC_FEED },
    defaultText: LONG_ARTICLE,
    blobs: { [oversized]: 90_000 },
    defaultBlobBytes: 1024,
  });

  const summary = await runSync({
    ...deps,
    store,
    fetcher,
    now: fakeClock(),
    limits: { prefetchPerPublication: 1, maxImageBytesPerArticle: 20_000 },
  });

  assert.equal(summary.articlesOk, 1, "the Article is stored anyway");
  assert.equal(articles.size, 1);
  assert.equal(summary.imagesStored, LONG_ARTICLE_IMAGES.length - 1);
  assert.equal(images.size, LONG_ARTICLE_IMAGES.length - 1);
  for (const image of images.values()) {
    assert.notEqual(image.url, oversized);
  }
});

// --- Failures ----------------------------------------------------------------

test("a Feed that 500s records lastError, is retried once, and does not abort the run", async () => {
  const { store, pubs, rows } = memoryStore([BBC, ANSA]);
  const { fetcher, calls } = scriptedFetcher({
    text: {
      [ANSA.feedUrl]: ANSA_FEED,
      [BBC.feedUrl]: new FetchFailure("blocked", BBC.feedUrl, { status: 500 }),
    },
    defaultText: THIN_ARTICLE,
  });

  const summary = await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.equal(summary.feedsOk, 1);
  assert.equal(summary.feedsFailed, 1);
  assert.equal(pubs.get("bbc-news").lastError, "blocked");
  assert.ok(pubs.get("bbc-news").lastSyncedAt > 0);
  assert.equal(pubs.get("ansa").lastError, null);
  assert.equal(
    calls.filter((c) => c.url === BBC.feedUrl).length,
    2,
    "one retry, then move on",
  );
  assert.equal(rows.size, 3, "the other Publication's Items are still stored");
});

test("an Original that 404s leaves the Item Summary-only and is not retried", async () => {
  const { store, rows } = memoryStore([ANSA]);
  const { fetcher, calls } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED },
  });

  const summary = await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.equal(summary.articlesSummaryOnly, 3);
  for (const item of rows.values()) {
    assert.equal(item.summaryOnlyReason, "not-found");
  }
  const perOriginal = calls.filter(
    (c) => c.kind === "text" && c.url !== ANSA.feedUrl,
  );
  assert.equal(perOriginal.length, 3, "a 404 is final: no retry");
});

test("a Feed that is not a Feed records the parse reason and keeps going", async () => {
  const { store, pubs } = memoryStore([ANSA]);
  const { fetcher } = scriptedFetcher({
    text: {
      [ANSA.feedUrl]: fixture("feeds/html-no-alternate-links-example-com.html"),
    },
  });

  const summary = await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.equal(summary.feedsFailed, 1);
  assert.equal(pubs.get("ansa").lastError, "unknown-root");
});

// --- Responsiveness and scope ------------------------------------------------

test("the run yields to the event loop between units", async () => {
  const { store } = memoryStore([BBC, ANSA]);
  const { fetcher } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED, [BBC.feedUrl]: BBC_FEED },
    defaultText: THIN_ARTICLE,
  });
  const { state, yieldToUi } = countingYield();

  await runSync({ ...deps, store, fetcher, now: fakeClock(), yieldToUi });

  // Two Feeds and seven Originals, each followed by a yield.
  assert.equal(state.calls, 9);
});

test("onProgress reports both phases with a running total", async () => {
  const { store } = memoryStore([ANSA]);
  const { fetcher } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED },
    defaultText: THIN_ARTICLE,
  });
  /** @type {any[]} */
  const events = [];

  await runSync({
    ...deps,
    store,
    fetcher,
    now: fakeClock(),
    onProgress: (event) => events.push(event),
  });

  const feeds = events.filter((e) => e.phase === "feeds");
  const articles = events.filter((e) => e.phase === "articles");
  assert.deepEqual(
    feeds.map((e) => e.done),
    [0, 1],
  );
  assert.deepEqual(
    articles.map((e) => e.done),
    [0, 1, 2, 3],
  );
  assert.equal(feeds.at(-1).total, 1);
  assert.equal(feeds.at(-1).publicationName, "ANSA");
  assert.equal(articles.at(-1).total, 3);
});

test("publicationIds restricts the run to those Publications", async () => {
  const { store, pubs, rows } = memoryStore([BBC, ANSA]);
  const { fetcher, calls } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED, [BBC.feedUrl]: BBC_FEED },
    defaultText: THIN_ARTICLE,
  });

  const summary = await runSync({
    ...deps,
    store,
    fetcher,
    now: fakeClock(),
    publicationIds: ["ansa"],
  });

  assert.equal(summary.feedsOk, 1);
  assert.equal(rows.size, 3);
  assert.equal(pubs.get("bbc-news").lastSyncedAt, undefined);
  assert.equal(calls.filter((c) => c.url === BBC.feedUrl).length, 0);
});

test("a Publication that is not Enabled takes no part in a Sync", async () => {
  const { store, rows } = memoryStore([{ ...ANSA, enabled: false }]);
  const { fetcher, calls } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED },
  });

  const summary = await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.deepEqual(summary, {
    feedsOk: 0,
    feedsFailed: 0,
    itemsStored: 0,
    articlesOk: 0,
    articlesSummaryOnly: 0,
    imagesStored: 0,
    bytesStored: 0,
  });
  assert.equal(rows.size, 0);
  assert.equal(calls.length, 0);
});

test("a run with no Enabled Publications does not claim a Sync time", async () => {
  // Regression (found by ticket 08): setLastSyncAt used to run unconditionally,
  // so a first boot with nothing Enabled stamped a Sync that never happened and
  // Settings read "Last synced: now, 0 Items".
  const { store, meta } = memoryStore([]);
  const { fetcher, calls } = scriptedFetcher({ text: {} });

  const summary = await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.equal(calls.length, 0, "nothing is fetched");
  assert.equal(summary.feedsOk, 0);
  assert.equal(
    meta.get("lastSyncAt"),
    undefined,
    "lastSyncAt is left unset so the UI can say 'never'",
  );
});

test("a run with an Enabled Publication does claim a Sync time", async () => {
  const { store, meta } = memoryStore([ANSA]);
  const { fetcher } = scriptedFetcher({
    text: { [ANSA.feedUrl]: ANSA_FEED },
    defaultText: THIN_ARTICLE,
  });

  await runSync({ ...deps, store, fetcher, now: fakeClock() });

  assert.ok(Number(meta.get("lastSyncAt")) > 0, "a real run stamps lastSyncAt");
});
