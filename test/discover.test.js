import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "../tools/testing/dom.js";
import { discoverFeeds } from "../src/feed.js";

const FIXTURES = new URL("./fixtures/feeds/", import.meta.url);

/** @param {string} name */
function fixture(name) {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}

/** @param {string} html @param {string} [url] */
function discover(html, url = "https://site.test/some/page") {
  return discoverFeeds(html, { url, DOMParser });
}

test("WordPress homepage: RSS alternates in document order, oEmbed and REST links ignored", () => {
  const found = discover(
    fixture("html-alternate-links-wordpress-news.html"),
    "https://wordpress.org/news/",
  );
  assert.deepEqual(found, [
    {
      url: "https://wordpress.org/news/feed/",
      type: "rss",
      title: "WordPress News » Feed",
      guess: false,
    },
    {
      url: "https://wordpress.org/news/comments/feed/",
      type: "rss",
      title: "WordPress News » Comments Feed",
      guess: false,
    },
    {
      url: "https://wordpress.org/news/feed/podcast",
      type: "rss",
      title: "Podcast RSS feed",
      guess: false,
    },
  ]);
});

test("minified homepage with unquoted attributes (Smashing Magazine)", () => {
  const found = discover(
    fixture("html-alternate-links-unquoted-smashing-magazine.html"),
    "https://www.smashingmagazine.com/",
  );
  assert.deepEqual(found, [
    {
      url: "https://www.smashingmagazine.com/feed/",
      type: "rss",
      title: "Smashing Magazine &raquo; Feed",
      guess: false,
    },
  ]);
});

test("page with no alternate links (example.com): common paths to probe, flagged as guesses", () => {
  const found = discover(
    fixture("html-no-alternate-links-example-com.html"),
    "https://example.com/some/deep/page.html?x=1",
  );
  assert.deepEqual(
    found.map((c) => c.url),
    [
      "https://example.com/feed",
      "https://example.com/rss",
      "https://example.com/feed.xml",
      "https://example.com/atom.xml",
      "https://example.com/index.xml",
      "https://example.com/rss.xml",
    ],
  );
  for (const c of found) {
    assert.equal(c.guess, true);
    assert.equal(c.title, null);
    assert.ok(["rss", "atom", "json"].includes(c.type));
  }
  assert.equal(found.find((c) => c.url.endsWith("/atom.xml")).type, "atom");
});

test("resolves relative hrefs, de-duplicates, maps Atom and JSON Feed types, ignores case in rel", () => {
  const found = discover(
    `<!doctype html><html><head>
      <link rel="ALTERNATE" type="application/atom+xml" href="/atom.xml" title="Atom">
      <link rel="alternate" type="application/rss+xml" href="feed/">
      <link rel="alternate" type="application/rss+xml" href="https://site.test/some/feed/">
      <link rel="alternate" type="application/feed+json" href="/feed.json">
      <link rel="alternate" type="application/json" href="/api/pages/1">
      <link rel="alternate stylesheet" type="text/css" href="/alt.css">
      <link rel="alternate" hreflang="it" href="/it/">
      <link rel="stylesheet" href="/main.css">
    </head><body></body></html>`,
  );
  assert.deepEqual(found, [
    {
      url: "https://site.test/atom.xml",
      type: "atom",
      title: "Atom",
      guess: false,
    },
    {
      url: "https://site.test/some/feed/",
      type: "rss",
      title: null,
      guess: false,
    },
    {
      url: "https://site.test/feed.json",
      type: "json",
      title: null,
      guess: false,
    },
  ]);
});

test("honours <base href> when resolving", () => {
  const found = discover(
    '<html><head><base href="https://cdn.test/root/"><link rel="alternate" type="application/rss+xml" href="rss"></head></html>',
  );
  assert.equal(found[0].url, "https://cdn.test/root/rss");
});

test("without a URL, guesses are bare paths", () => {
  const found = discoverFeeds("<html></html>", { DOMParser });
  assert.equal(found[0].url, "/feed");
  assert.equal(found[0].guess, true);
});

test("requires a DOMParser", () => {
  assert.throws(
    () => discoverFeeds("<html></html>", /** @type {any} */ ({})),
    TypeError,
  );
});
