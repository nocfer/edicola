// On-demand Extraction of a single Item: the seam the Reader's spinner sits
// behind. Given this Item and this fetcher, either an Article and its images
// are stored, or the Item is left Summary-only with the right reason — and the
// promise resolves either way, because both are states the Reader has copy
// for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchArticleNow } from "../src/fetch-one.js";
import { FetchFailure } from "../src/fetcher.js";

/** An Item as the `items` table holds it, with only what this module reads. */
function itemRow(overrides = {}) {
  return {
    id: "pub:1",
    publicationId: "pub",
    title: "A headline",
    link: "https://pub.test/story",
    ...overrides,
  };
}

/** A `SyncStore` that records the three calls this module can make. */
function fakeStore() {
  const calls = { articles: [], images: [], summaryOnly: [] };
  return {
    calls,
    async putArticle(article) {
      calls.articles.push(article);
    },
    async putImages(itemId, images) {
      calls.images.push({ itemId, images });
      return images.reduce((total, image) => total + image.blob.size, 0);
    },
    async markSummaryOnly(itemId, reason) {
      calls.summaryOnly.push({ itemId, reason });
    },
  };
}

/**
 * A fetcher over fixed answers. `text` may be an Error to throw, and every
 * attempt is recorded so the retry rule can be asserted.
 */
function fakeFetcher({ text, blobs = {} }) {
  const attempts = [];
  return {
    attempts,
    async fetchText(url) {
      attempts.push(url);
      if (text instanceof Error) throw text;
      return {
        text,
        finalUrl: url,
        via: "direct",
        status: 200,
        contentType: "",
      };
    },
    async fetchBlob(url, { maxBytes } = {}) {
      attempts.push(url);
      const blob = blobs[url];
      if (!blob) throw new FetchFailure("blocked", url);
      if (maxBytes !== undefined && blob.size > maxBytes) {
        throw new FetchFailure("too-large", url);
      }
      return {
        blob,
        finalUrl: url,
        via: "direct",
        status: 200,
        contentType: "",
      };
    },
  };
}

/** An Extraction that returns whatever the test says, ignoring the HTML. */
function extractorFor(article) {
  return () => article;
}

const OK_ARTICLE = {
  ok: true,
  title: "A headline",
  byline: "A Writer",
  html: "<p>Eight hundred words of prose.</p>",
  wordCount: 812,
  imageUrls: ["https://pub.test/a.jpg"],
  reason: null,
};

test("a successful Extraction stores the Article and its images", async () => {
  const store = fakeStore();
  const blob = new Blob(["bytes"], { type: "image/jpeg" });
  const result = await fetchArticleNow(itemRow(), {
    store,
    fetcher: fakeFetcher({
      text: "<html><body>page</body></html>",
      blobs: { "https://pub.test/a.jpg": blob },
    }),
    extractArticle: extractorFor(OK_ARTICLE),
    now: () => 1000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.images, 1);
  assert.equal(result.reason, null);
  assert.equal(store.calls.summaryOnly.length, 0);
  assert.deepEqual(store.calls.articles, [
    {
      itemId: "pub:1",
      title: "A headline",
      byline: "A Writer",
      html: OK_ARTICLE.html,
      wordCount: 812,
      bytes: new TextEncoder().encode(OK_ARTICLE.html).length,
      extractedAt: 1000,
    },
  ]);
  assert.equal(result.article?.itemId, "pub:1");
  assert.equal(store.calls.images[0].itemId, "pub:1");
  assert.equal(store.calls.images[0].images[0].url, "https://pub.test/a.jpg");
});

test("an Item with no link is Summary-only with `no-link`", async () => {
  const store = fakeStore();
  const fetcher = fakeFetcher({ text: "unused" });
  const result = await fetchArticleNow(itemRow({ link: null }), {
    store,
    fetcher,
    extractArticle: extractorFor(OK_ARTICLE),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-link");
  assert.deepEqual(fetcher.attempts, []);
  assert.deepEqual(store.calls.summaryOnly, [
    { itemId: "pub:1", reason: "no-link" },
  ]);
});

test("too little text leaves the Item Summary-only with Extraction's reason", async () => {
  const store = fakeStore();
  const result = await fetchArticleNow(itemRow(), {
    store,
    fetcher: fakeFetcher({ text: "<html><body>teaser</body></html>" }),
    extractArticle: extractorFor({
      ok: false,
      title: "",
      byline: null,
      html: "<p>A teaser.</p>",
      wordCount: 23,
      imageUrls: [],
      reason: "too-short",
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too-short");
  assert.equal(store.calls.articles.length, 0);
  assert.deepEqual(store.calls.summaryOnly, [
    { itemId: "pub:1", reason: "too-short" },
  ]);
});

test("a blocked Original is attempted twice, then recorded", async () => {
  const store = fakeStore();
  const fetcher = fakeFetcher({
    text: new FetchFailure("blocked", "https://pub.test/story"),
  });
  const result = await fetchArticleNow(itemRow(), {
    store,
    fetcher,
    extractArticle: extractorFor(OK_ARTICLE),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "blocked");
  assert.equal(fetcher.attempts.length, 2);
  assert.deepEqual(store.calls.summaryOnly, [
    { itemId: "pub:1", reason: "blocked" },
  ]);
});

test("a 404 is final: one attempt, no retry", async () => {
  const store = fakeStore();
  const fetcher = fakeFetcher({
    text: new FetchFailure("not-found", "https://pub.test/story"),
  });
  const result = await fetchArticleNow(itemRow(), {
    store,
    fetcher,
    extractArticle: extractorFor(OK_ARTICLE),
  });
  assert.equal(result.reason, "not-found");
  assert.equal(fetcher.attempts.length, 1);
});

test("images stop at the per-Article budget and never block the Article", async () => {
  const store = fakeStore();
  const small = new Blob(["ab"], { type: "image/jpeg" });
  const large = new Blob(["a".repeat(64)], { type: "image/jpeg" });
  const result = await fetchArticleNow(itemRow(), {
    store,
    fetcher: fakeFetcher({
      text: "page",
      blobs: {
        "https://pub.test/a.jpg": small,
        "https://pub.test/b.jpg": large,
      },
    }),
    extractArticle: extractorFor({
      ...OK_ARTICLE,
      imageUrls: ["https://pub.test/a.jpg", "https://pub.test/b.jpg"],
    }),
    limits: { maxImageBytesPerArticle: 8 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.images, 1);
  assert.deepEqual(
    store.calls.images[0].images.map((image) => image.url),
    ["https://pub.test/a.jpg"],
  );
});
