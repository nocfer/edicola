import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "../tools/testing/dom.js";
import { parseFeed, FeedParseError } from "../src/feed.js";

const FIXTURES = new URL("./fixtures/feeds/", import.meta.url);

/** @param {string} name */
function fixture(name) {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}

/** @param {string} name @param {string} url */
function parseFixture(name, url) {
  return parseFeed(fixture(name), { url, DOMParser });
}

/** @param {string} text @param {string} [url] */
function parse(text, url = "https://example.test/feed.xml") {
  return parseFeed(text, { url, DOMParser });
}

/** True when `s` carries a C0 control character other than tab, LF or CR. */
function hasControlChars(s) {
  return [...s].some((ch) => {
    const c = ch.charCodeAt(0);
    return c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d;
  });
}

// ---------------------------------------------------------------------------
// RSS 2.0

test("RSS 2.0 with content:encoded (WordPress): both Summary and full content", () => {
  const feed = parseFixture(
    "rss2-content-encoded-wordpress-news.xml",
    "https://wordpress.org/news/feed/",
  );
  assert.equal(feed.format, "rss2");
  assert.equal(feed.title, "WordPress News");
  assert.equal(feed.siteUrl, "https://wordpress.org/news");
  assert.equal(feed.language, "en-US");
  assert.equal(feed.items.length, 3);

  const [first] = feed.items;
  assert.equal(
    first.title,
    "WordPress Signs the Open Weights and American AI Leadership Letter",
  );
  assert.equal(first.link, "https://wordpress.org/news/2026/08/open-weight/");
  assert.equal(first.id, "https://wordpress.org/news/?p=21341");
  assert.equal(first.publishedAt, "2026-08-27T17:00:32.000Z");
  assert.equal(first.author, "Mary Hubbard");
  assert.ok(first.summaryHtml?.startsWith("We’re proud to announce"));
  assert.match(first.contentHtml, /<p class="wp-block-paragraph">/);
  assert.ok(first.contentHtml.length > first.summaryHtml.length);
  assert.equal(first.thumbnailUrl, null);
});

test("Truncated newspaper RSS (Guardian): Summary only, media:content thumbnail, dc:creator", () => {
  const feed = parseFixture(
    "rss2-truncated-media-content-guardian.xml",
    "https://www.theguardian.com/uk/rss",
  );
  assert.equal(feed.title, "The Guardian");
  assert.equal(feed.siteUrl, "https://www.theguardian.com/uk");
  assert.equal(feed.language, "en-gb");
  assert.equal(feed.items.length, 4);

  const [first] = feed.items;
  assert.match(
    first.title,
    /^‘Work hard – nobody cares how good you used to be’/,
  );
  assert.equal(
    first.link,
    "https://www.theguardian.com/fashion/2026/sep/07/work-hard-nobody-cares-how-good-you-used-to-be-paul-smith-at-80-on-love-fun-and-his-fabulous-life-in-fashion",
  );
  assert.equal(first.publishedAt, "2026-09-07T04:00:23.000Z");
  assert.equal(first.author, "Emine Saner");
  assert.match(first.summaryHtml, /^<p>With the release of his new biography/);
  assert.equal(first.contentHtml, null);
  // The widest media:content wins.
  assert.match(
    first.thumbnailUrl,
    /^https:\/\/i\.guim\.co\.uk\/img\/media\/.*width=700/,
  );
  for (const item of feed.items) assert.equal(item.contentHtml, null);
});

test("RSS 2.0 with media:thumbnail (BBC): thumbnail, CDATA title, non-permalink guid", () => {
  const feed = parseFixture(
    "rss2-media-thumbnail-bbc-news.xml",
    "https://feeds.bbci.co.uk/news/rss.xml",
  );
  assert.equal(feed.title, "BBC News");
  assert.equal(feed.siteUrl, "https://www.bbc.co.uk/news");
  assert.equal(feed.items.length, 4);
  const [first] = feed.items;
  assert.equal(
    first.title,
    "Watch: Anti-migrant boat protesters block roads in Portsmouth",
  );
  assert.equal(
    first.link,
    "https://www.bbc.co.uk/news/videos/cje8lwzjz5lo?at_medium=RSS&at_campaign=rss",
  );
  assert.equal(first.id, "https://www.bbc.co.uk/news/videos/cje8lwzjz5lo#0");
  assert.equal(first.publishedAt, "2026-09-07T05:57:30.000Z");
  assert.equal(
    first.thumbnailUrl,
    "https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/c05a/live/266e03c0-aa91-11f1-b109-879e35c24276.jpg",
  );
  assert.equal(first.contentHtml, null);
  assert.equal(first.author, null);
  for (const item of feed.items) assert.ok(item.thumbnailUrl);
});

test("RSS 2.0 without an XML prolog (Repubblica): parses; author from 'email (Name)'", () => {
  const text = fixture("rss2-no-prolog-truncated-repubblica.xml");
  assert.ok(text.startsWith("<rss"), "fixture has no prolog");
  const feed = parse(text, "https://www.repubblica.it/rss/homepage/rss2.0.xml");
  assert.equal(feed.title, "Repubblica.it");
  assert.equal(feed.siteUrl, "https://repubblica.it/");
  assert.equal(feed.language, "it-it");
  assert.equal(feed.items.length, 4);
  const [first] = feed.items;
  assert.equal(
    first.title,
    "Pensione anticipata a 64 anni, con il ricalcolo l’assegno perde il 10%. Le simulazioni",
  );
  assert.equal(first.id, "rep-locali:repubblica:425569591");
  assert.equal(first.author, "Redazione Repubblica.it");
  assert.equal(first.publishedAt, "2026-09-07T07:49:58.000Z");
  assert.match(first.summaryHtml, /^La Cgil simula/);
  assert.equal(first.contentHtml, null);
});

test("RSS 2.0 with an empty channel link (ANSA): siteUrl falls back to the Feed's origin", () => {
  const feed = parseFixture(
    "rss2-empty-channel-link-ansa.xml",
    "https://www.ansa.it/sito/ansait_rss.xml",
  );
  assert.equal(feed.title, "Primo piano ANSA - ANSA.it");
  assert.equal(feed.siteUrl, "https://www.ansa.it");
  assert.equal(feed.items.length, 3);
  const [first] = feed.items;
  assert.match(first.title, /^Venezia, il programma di oggi/);
  // "Mon, 7 Sep 2026 09:07:09 +0200": single-digit day and numeric offset.
  assert.equal(first.publishedAt, "2026-09-07T07:07:09.000Z");
  assert.equal(first.id, first.link);
});

test("RSS 2.0 with only an <img> in the description (Corriere): thumbnail from it; empty dc:creator is null", () => {
  const feed = parseFixture(
    "rss2-inline-img-description-corriere.xml",
    "https://xml2.corriereobjects.it/rss/homepage.xml",
  );
  assert.equal(feed.title, "Corriere.it - Homepage");
  assert.equal(feed.siteUrl, "https://www.corriere.it/");
  assert.equal(feed.items.length, 3);
  const [first] = feed.items;
  assert.equal(
    first.title,
    "Codice della strada, ecco cosa cambia e perché non ridurrà il numero delle vittime",
  );
  assert.match(
    first.thumbnailUrl,
    /^https:\/\/images2\.corriereobjects\.it\/.*\.jpg$/,
  );
  assert.equal(first.author, null);
  assert.equal(first.publishedAt, "2024-05-13T04:05:06.000Z");
});

// ---------------------------------------------------------------------------
// Atom

test("Atom (GitHub releases): updated as date, html content, media:thumbnail, author name", () => {
  const feed = parseFixture(
    "atom-github-releases-nodejs.xml",
    "https://github.com/nodejs/node/releases.atom",
  );
  assert.equal(feed.format, "atom");
  assert.equal(feed.title, "Release notes from node");
  assert.equal(feed.siteUrl, "https://github.com/nodejs/node/releases");
  assert.equal(feed.language, "en-US");
  assert.equal(feed.items.length, 3);
  const [first] = feed.items;
  assert.equal(first.id, "tag:github.com,2008:Repository/27193779/v26.8.1");
  assert.equal(first.title, "2026-08-26, Version 26.8.1 (Current), @aduh95");
  assert.equal(
    first.link,
    "https://github.com/nodejs/node/releases/tag/v26.8.1",
  );
  assert.equal(first.publishedAt, "2026-08-26T22:10:37.000Z");
  assert.equal(first.author, "aduh95");
  assert.match(first.contentHtml, /^<h3>Notable Changes<\/h3>/);
  assert.equal(first.summaryHtml, null);
  assert.equal(
    first.thumbnailUrl,
    "https://avatars.githubusercontent.com/u/14309773?s=60&v=4",
  );
  // "&#39;Jod&#39;" in a title is decoded.
  assert.equal(
    feed.items[2].title,
    "2026-07-29, Version 22.23.2 'Jod' (LTS), @marco-ippolito",
  );
});

// ---------------------------------------------------------------------------
// RSS 1.0 / RDF

test("RSS 1.0 / RDF (Slashdot): items outside the channel, dc:date, dc:creator", () => {
  const feed = parseFixture(
    "rdf-rss10-slashdot.xml",
    "https://rss.slashdot.org/Slashdot/slashdotMain",
  );
  assert.equal(feed.format, "rdf");
  assert.equal(feed.title, "Slashdot");
  assert.equal(feed.siteUrl, "https://slashdot.org/");
  assert.equal(feed.language, "en-us");
  assert.equal(feed.items.length, 3);
  const [first] = feed.items;
  assert.equal(
    first.title,
    "Bitcoin-based Liquid Network Says $320 Million Withdrawn in Hack",
  );
  assert.match(
    first.link,
    /^https:\/\/yro\.slashdot\.org\/story\/26\/09\/07\/0727220\//,
  );
  assert.equal(first.publishedAt, "2026-09-07T07:30:00.000Z");
  assert.equal(first.author, "EditorDavid");
  assert.match(first.summaryHtml, /^Reuters reports:/);
  assert.equal(first.contentHtml, null);
  // No guid in RSS 1.0: the id is a stable hash, distinct per item.
  assert.equal(new Set(feed.items.map((i) => i.id)).size, 3);
  assert.deepEqual(
    feed.items.map((i) => i.id),
    parseFixture(
      "rdf-rss10-slashdot.xml",
      "https://rss.slashdot.org/Slashdot/slashdotMain",
    ).items.map((i) => i.id),
  );
});

// ---------------------------------------------------------------------------
// JSON Feed

test("JSON Feed 1 (jsonfeed.org): content_html, ISO dates, url as link", () => {
  const feed = parseFixture(
    "jsonfeed-v1-jsonfeed-org.json",
    "https://www.jsonfeed.org/feed.json",
  );
  assert.equal(feed.format, "json");
  assert.equal(feed.title, "JSON Feed");
  assert.equal(feed.siteUrl, "https://www.jsonfeed.org/");
  assert.equal(feed.items.length, 2);
  const [first] = feed.items;
  assert.equal(
    first.id,
    "http://jsonfeed.micro.blog/2020/08/07/json-feed-version.html",
  );
  assert.equal(first.title, "JSON Feed version 1.1");
  assert.equal(
    first.link,
    "https://www.jsonfeed.org/2020/08/07/json-feed-version.html",
  );
  assert.equal(first.publishedAt, "2020-08-07T16:44:36.000Z");
  assert.match(first.contentHtml, /^<p>We&rsquo;ve updated the/);
  assert.equal(first.summaryHtml, null);
});

test("JSON Feed 1.1 (Daring Fireball): authors array, url preferred over external_url", () => {
  const feed = parseFixture(
    "jsonfeed-v1.1-daring-fireball.json",
    "https://daringfireball.net/feeds/json",
  );
  assert.equal(feed.title, "Daring Fireball");
  assert.equal(feed.siteUrl, "https://daringfireball.net/");
  assert.equal(feed.items.length, 3);
  const [first] = feed.items;
  assert.match(first.link, /^https:\/\/daringfireball\.net\//);
  assert.equal(first.author, "John Gruber");
  assert.equal(first.publishedAt, "2026-09-06T20:44:27.000Z");
  assert.ok(first.contentHtml);
  for (const item of feed.items) assert.ok(item.id && item.title && item.link);
});

// ---------------------------------------------------------------------------
// Leniency

test("tolerates a BOM, leading whitespace and no prolog", () => {
  const feed = parse(
    '﻿  \n<rss version="2.0"><channel><title>T</title><link>https://a.test/</link><item><title>x</title><link>https://a.test/x</link></item></channel></rss>',
  );
  assert.equal(feed.title, "T");
  assert.equal(feed.items.length, 1);
});

test("decodes HTML entities and strips tags in titles", () => {
  const feed = parse(
    '<rss version="2.0"><channel><title>Tom &amp;amp; Jerry &amp;rsquo;s &amp;#8220;show&amp;#8221;</title><item><title>&lt;b&gt;Bold&lt;/b&gt; &amp;eacute;t&amp;eacute;</title><link>https://a.test/x</link></item></channel></rss>',
  );
  assert.equal(feed.title, "Tom & Jerry ’s “show”");
  assert.equal(feed.items[0].title, "Bold été");
});

test("resolves relative links against the Feed URL", () => {
  const feed = parse(
    '<rss version="2.0"><channel><title>T</title><link>/</link><item><title>x</title><link>/posts/1</link><enclosure url="img/1.jpg" type="image/jpeg"/></item></channel></rss>',
    "https://blog.test/feeds/all.xml",
  );
  assert.equal(feed.siteUrl, "https://blog.test/");
  assert.equal(feed.items[0].link, "https://blog.test/posts/1");
  assert.equal(feed.items[0].thumbnailUrl, "https://blog.test/posts/img/1.jpg");
});

test("accepts pubDate in RFC 822 and ISO forms, dc:date, and Atom updated without published", () => {
  const rss = parse(
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>T</title>' +
      "<item><title>a</title><pubDate>Mon, 7 Sep 2026 09:07:09 +0200</pubDate></item>" +
      "<item><title>b</title><pubDate>2026-09-07T07:07:09+02:00</pubDate></item>" +
      "<item><title>c</title><dc:date>2026-09-07T07:07:09Z</dc:date></item>" +
      "<item><title>d</title><pubDate>Mon, 07 Sep 2026 07:07:09 UT</pubDate></item>" +
      "<item><title>e</title><pubDate>not a date</pubDate></item>" +
      "<item><title>f</title></item>" +
      "</channel></rss>",
  );
  const dates = rss.items.map((i) => i.publishedAt);
  assert.deepEqual(dates, [
    "2026-09-07T07:07:09.000Z",
    "2026-09-07T05:07:09.000Z",
    "2026-09-07T07:07:09.000Z",
    "2026-09-07T07:07:09.000Z",
    null,
    null,
  ]);
  const atom = parse(
    '<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><entry><id>1</id><title>a</title><updated>2026-01-02T03:04:05Z</updated></entry></feed>',
  );
  assert.equal(atom.items[0].publishedAt, "2026-01-02T03:04:05.000Z");
});

test("ids: guid when present, else a stable hash of link and title", () => {
  const doc = (title) =>
    `<rss version="2.0"><channel><title>T</title><item><title>${title}</title><link>https://a.test/x</link></item></channel></rss>`;
  const a = parse(doc("Same")).items[0].id;
  const b = parse(doc("Same")).items[0].id;
  const c = parse(doc("Other")).items[0].id;
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^h:[0-9a-f]{8}$/);
  const withGuid = parse(
    '<rss version="2.0"><channel><title>T</title><item><guid isPermaLink="false">abc-123</guid><title>x</title></item></channel></rss>',
  );
  assert.equal(withGuid.items[0].id, "abc-123");
});

test("Atom: xhtml content is serialized, text content is escaped, enclosure image is the thumbnail", () => {
  const feed = parse(
    '<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><link href="https://a.test/"/>' +
      '<entry><id>1</id><title>x</title><link rel="alternate" href="/p/1"/><link rel="enclosure" type="image/png" href="/i.png"/>' +
      '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hi <em>there</em></p></div></content>' +
      '<summary type="text">a &lt; b</summary></entry></feed>',
    "https://a.test/atom.xml",
  );
  const [item] = feed.items;
  assert.equal(item.link, "https://a.test/p/1");
  assert.equal(item.thumbnailUrl, "https://a.test/i.png");
  // Serializers may carry the XHTML namespace onto the first element.
  assert.match(item.contentHtml, /^<p[^>]*>Hi <em>there<\/em><\/p>$/);
  assert.equal(item.summaryHtml, "a &lt; b");
});

test("JSON Feed: content_text becomes escaped paragraphs; image is the thumbnail", () => {
  const feed = parse(
    JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      title: "J",
      home_page_url: "https://j.test/",
      items: [
        {
          id: 7,
          url: "/one",
          content_text: "First <para>\n\nSecond",
          image: "/img.png",
          summary: "A & B",
          date_published: "2026-05-04T03:02:01Z",
        },
      ],
    }),
    "https://j.test/feed.json",
  );
  const [item] = feed.items;
  assert.equal(item.id, "7");
  assert.equal(item.link, "https://j.test/one");
  assert.equal(item.contentHtml, "<p>First &lt;para&gt;</p>\n<p>Second</p>");
  assert.equal(item.summaryHtml, "A &amp; B");
  assert.equal(item.thumbnailUrl, "https://j.test/img.png");
});

// ---------------------------------------------------------------------------
// Malformed XML: best-effort second pass

test("malformed XML with unescaped ampersands (derived from BBC) still yields all Items", () => {
  const text = fixture("rss2-malformed-unescaped-ampersand-bbc-news.xml");
  assert.match(
    text,
    /<link>[^<]*[^&;]&at_campaign/,
    "fixture carries a bare &",
  );
  const feed = parse(text, "https://feeds.bbci.co.uk/news/rss.xml");
  assert.equal(feed.items.length, 4);
  assert.equal(
    feed.items[0].link,
    "https://www.bbc.co.uk/news/videos/cje8lwzjz5lo?at_medium=RSS&at_campaign=rss",
  );
  assert.ok(feed.items[0].thumbnailUrl);
});

test("malformed XML with control characters (derived from Repubblica) still yields all Items", () => {
  const text = fixture("rss2-malformed-control-characters-repubblica.xml");
  assert.ok(hasControlChars(text), "fixture carries control characters");
  const feed = parse(text, "https://www.repubblica.it/rss/homepage/rss2.0.xml");
  assert.equal(feed.items.length, 4);
  assert.match(feed.items[0].summaryHtml, /^La Cgil simula la proposta/);
  assert.equal(hasControlChars(feed.items[0].summaryHtml), false);
});

test("an undeclared namespace prefix is declared on the second pass", () => {
  const feed = parse(
    '<rss version="2.0"><channel><title>T</title><item><title>x</title><content:encoded>&lt;p&gt;full&lt;/p&gt;</content:encoded><media:thumbnail url="https://a.test/t.jpg"/></item></channel></rss>',
  );
  assert.equal(feed.items[0].contentHtml, "<p>full</p>");
  assert.equal(feed.items[0].thumbnailUrl, "https://a.test/t.jpg");
});

// ---------------------------------------------------------------------------
// Errors

test("throws a typed FeedParseError with a reason", () => {
  const cases = [
    ["", "empty"],
    ["   \n", "empty"],
    ["hello world", "unknown-format"],
    [
      "<!doctype html><html><head><title>x</title></head><body></body></html>",
      "unknown-root",
    ],
    ['<opml version="2.0"><body/></opml>', "unknown-root"],
    [
      '<rss version="2.0"><channel><title>T</title><item><title>broken</channel></rss>',
      "malformed-xml",
    ],
    ["{ not json", "malformed-json"],
    ['{"hello": "world"}', "not-a-feed"],
  ];
  for (const [text, reason] of cases) {
    assert.throws(
      () => parse(text),
      (err) => {
        assert.ok(err instanceof FeedParseError, `${reason}: instance`);
        assert.ok(err instanceof Error);
        assert.equal(err.name, "FeedParseError");
        assert.equal(err.reason, reason);
        return true;
      },
      `expected ${reason}`,
    );
  }
});

test("requires a DOMParser", () => {
  assert.throws(() => parseFeed("<rss/>", /** @type {any} */ ({})), TypeError);
});
