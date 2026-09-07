import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { windowFor, Readability, purifierFor } from "../tools/testing/dom.js";
import {
  MIN_ARTICLE_WORDS,
  extractArticle,
  rewriteImageSources,
  sanitizeSummary,
  toPlainText,
} from "../src/extract-core.js";

const FIXTURES = resolve(
  fileURLToPath(import.meta.url),
  "../fixtures/articles",
);

/** @param {string} name */
function fixture(name) {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

const purify = purifierFor(windowFor());

/** @param {string} html @param {string} url */
function extract(html, url) {
  return extractArticle(html, { url, windowFor, Readability, purify });
}

/** Markup that must never survive sanitizing, as one regexp. */
const DANGEROUS =
  /<script|<iframe|<form|<input|<button|<style|<svg|<video|<audio|<object|<embed|javascript:|\son[a-z]+=|\sclass=|\sid=|\sstyle=|\ssrcset=|\sdata-[a-z-]+=/i;

/** Synthetic Original: enough plain prose to clear the threshold, plus `extra`. */
function proseOriginal(extra = "", paragraphs = 40) {
  const body = Array.from(
    { length: paragraphs },
    (_, i) =>
      `<p>Paragraph ${i} carries several ordinary words so that the synthetic article passes the word threshold.</p>`,
  ).join("");
  return `<!doctype html><html><head><title>Synthetic</title></head><body><article><h1>Synthetic</h1>${extra}${body}</article></body></html>`;
}

// --- real Originals ------------------------------------------------------------

test("a well-formed news article extracts to a long, clean Article", () => {
  const a = extract(
    fixture("bbc-news-long-article.html"),
    "https://www.bbc.com/news/articles/c0e3p1j7n3ro",
  );
  assert.equal(a.ok, true);
  assert.equal(a.reason, null);
  assert.ok(a.wordCount >= 600 && a.wordCount <= 1200, `words ${a.wordCount}`);
  assert.match(a.title, /Amazon cargo plane/);
  assert.ok(a.excerpt.length > 40);
  assert.ok(a.html.includes("<p>"));
  assert.doesNotMatch(a.html, DANGEROUS);
  assert.ok(a.imageUrls.length >= 3, `images ${a.imageUrls.length}`);
  for (const u of a.imageUrls) assert.match(u, /^https:\/\//);
  assert.ok(a.imageUrls.some((u) => u.includes("ichef.bbci.co.uk")));
  assert.equal(new Set(a.imageUrls).size, a.imageUrls.length);
});

test("a hard-paywalled Original whose anonymous response is a teaser is too-short", () => {
  const a = extract(
    fixture("thetimes-paywall-teaser.html"),
    "https://www.thetimes.com/business/companies-markets/article/bailout-jaguar-land-rover-4000-jobs-jonathan-reynolds-mllxdnlzd",
  );
  assert.equal(a.ok, false);
  assert.equal(a.reason, "too-short");
  assert.ok(a.wordCount > 0 && a.wordCount < MIN_ARTICLE_WORDS);
  assert.match(a.title, /Jaguar Land Rover/);
  assert.ok(a.html.length > 0, "the teaser HTML is still returned");
  assert.doesNotMatch(a.html, DANGEROUS);
});

test("a category index page with no article body is no-content", () => {
  const a = extract(
    fixture("ilsole24ore-category-index.html"),
    "https://www.ilsole24ore.com/sez/italia",
  );
  assert.equal(a.ok, false);
  assert.equal(a.reason, "no-content");
  for (const u of a.imageUrls) assert.match(u, /^https:\/\//);
  assert.doesNotMatch(a.html, DANGEROUS);
});

test("an empty document is no-content with no HTML", () => {
  const a = extract(
    "<!doctype html><html><head><title>Empty</title></head><body></body></html>",
    "https://example.test/empty",
  );
  assert.deepEqual(a, {
    ok: false,
    title: "Empty",
    byline: null,
    excerpt: "",
    html: "",
    wordCount: 0,
    imageUrls: [],
    reason: "no-content",
  });
});

test("lazy-loaded, srcset and relative images survive as absolute src values", () => {
  const url =
    "https://www.wpbeginner.com/beginners-guide/how-much-does-it-cost-to-build-a-wordpress-website/";
  const a = extract(fixture("wpbeginner-lazy-relative-images.html"), url);
  assert.equal(a.ok, true);
  assert.ok(a.wordCount >= MIN_ARTICLE_WORDS);
  assert.ok(a.imageUrls.length >= 5, `images ${a.imageUrls.length}`);
  for (const u of a.imageUrls)
    assert.match(u, /^https:\/\/www\.wpbeginner\.com\/wp-content\/uploads\//);
  // The hero image is served as an SVG data: placeholder with the real URL in data-src.
  assert.ok(
    a.imageUrls.some((u) =>
      u.endsWith("/how-much-does-it-cost-to-build-a-wordpress-website-og.png"),
    ),
  );
  assert.doesNotMatch(a.html, /data:image\/svg/);
  assert.doesNotMatch(a.html, /src="\//);
  assert.doesNotMatch(a.html, DANGEROUS);
  // Every link opens the Original in a new tab, in-page anchors included.
  const links = a.html.match(/<a [^>]*>/g) || [];
  assert.ok(links.length > 5);
  for (const l of links) {
    assert.match(l, /target="_blank"/);
    assert.match(l, /rel="noopener"/);
    assert.doesNotMatch(l, /href="#/);
  }
  assert.ok(links.some((l) => l.includes(`href="${url}#`)));
});

test("scripts, handlers, javascript: links and non-content elements are gone after sanitizing", () => {
  const a = extract(
    fixture("ilpost-article-with-injected-markup.html"),
    "https://www.ilpost.it/2024/01/23/effetti-psicologia-analcolici/",
  );
  assert.equal(a.ok, true);
  assert.doesNotMatch(a.html, DANGEROUS);
  assert.doesNotMatch(a.html, /__edicolaPwned|pwned|alert\(/);
  assert.doesNotMatch(a.html, /example\.com/);
  // The prose around the hostile markup is intact, and the harmless link is hardened.
  assert.ok(a.html.includes("gestori di eventi inline che devono sparire"));
  assert.match(
    a.html,
    /<a href="https:\/\/www\.ilpost\.it\/" target="_blank" rel="noopener">Il Post<\/a>/,
  );
  assert.ok(
    a.imageUrls.some((u) => u.endsWith("1706006516-cocktail-analcolico.jpg")),
  );
  assert.ok(a.wordCount > 1000);
});

// --- image rules on synthetic Originals ------------------------------------------

test("an image with only a relative srcset gets its first candidate as absolute src", () => {
  const a = extract(
    proseOriginal(
      '<figure><img srcset="/img/a-480.jpg 480w, /img/a-960.jpg 960w" alt="A"><figcaption>Cap</figcaption></figure>',
    ),
    "https://news.example.test/section/story.html",
  );
  assert.equal(a.ok, true);
  assert.deepEqual(a.imageUrls, ["https://news.example.test/img/a-480.jpg"]);
  assert.match(
    a.html,
    /<img (?=[^>]*src="https:\/\/news\.example\.test\/img\/a-480\.jpg")(?=[^>]*alt="A")[^>]*>/,
  );
  assert.match(a.html, /<figcaption>Cap<\/figcaption>/);
});

test("data-lazy-src wins over a placeholder src and URLs are de-duplicated in order", () => {
  const a = extract(
    proseOriginal(
      '<p><img src="https://cdn.example.test/blank.gif" data-lazy-src="/photos/one.jpg" alt="one"></p>' +
        '<p><img src="two.jpg" alt="two"></p>' +
        '<p><img data-original="https://cdn.example.test/photos/one.jpg" alt="one again"></p>',
    ),
    "https://cdn.example.test/blog/post/",
  );
  assert.deepEqual(a.imageUrls, [
    "https://cdn.example.test/photos/one.jpg",
    "https://cdn.example.test/blog/post/two.jpg",
  ]);
  assert.doesNotMatch(a.html, /blank\.gif/);
});

test("small data: images stay inline but off the list; large ones are removed", () => {
  const small = `data:image/png;base64,${"A".repeat(200)}`;
  const large = `data:image/png;base64,${"B".repeat(40 * 1024)}`;
  const a = extract(
    proseOriginal(
      `<p><img src="${small}" alt="small"></p><p><img src="${large}" alt="large"></p><p><img src="https://cdn.example.test/real.jpg" alt="real"></p>`,
    ),
    "https://cdn.example.test/blog/post/",
  );
  assert.deepEqual(a.imageUrls, ["https://cdn.example.test/real.jpg"]);
  assert.ok(a.html.includes(`src="${small}"`));
  assert.doesNotMatch(a.html, /alt="large"/);
});

test("too few words is too-short and still returns the HTML", () => {
  const a = extract(proseOriginal("", 6), "https://example.test/short");
  assert.equal(a.ok, false);
  assert.equal(a.reason, "too-short");
  assert.ok(a.wordCount > 0 && a.wordCount < MIN_ARTICLE_WORDS);
  assert.ok(a.html.includes("Paragraph 0"));
});

// --- rewriteImageSources ----------------------------------------------------------

test("rewriteImageSources applies the map and leaves unmapped images alone", () => {
  const html =
    '<p>Text</p><figure><img src="https://a.test/1.jpg" alt="1"><img src="https://a.test/2.jpg" alt="2"></figure>';
  const out = rewriteImageSources(
    html,
    (u) => (u.endsWith("1.jpg") ? "blob:https://app.test/abc" : null),
    { windowFor },
  );
  assert.equal(
    out,
    '<p>Text</p><figure><img src="blob:https://app.test/abc" alt="1"><img src="https://a.test/2.jpg" alt="2"></figure>',
  );
});

// --- sanitizeSummary and toPlainText ----------------------------------------------

test("sanitizeSummary keeps text-level tags only and hardens links", () => {
  const out = sanitizeSummary(
    '<div class="x"><p onclick="a()">Hello <em>there</em> <strong>you</strong><br><img src="https://a.test/t.jpg"></p>' +
      '<ul><li><a href="https://a.test/" style="color:red">link</a></li><li><a href="javascript:evil()">bad</a></li></ul>' +
      "<script>evil()</script><h2>Heading</h2><table><tr><td>cell</td></tr></table></div>",
    purify,
  );
  assert.equal(
    out,
    "<p>Hello <em>there</em> <strong>you</strong><br></p>" +
      '<ul><li><a href="https://a.test/" target="_blank" rel="noopener">link</a></li><li><a>bad</a></li></ul>' +
      "Headingcell",
  );
});

test("sanitizeSummary tolerates empty input", () => {
  assert.equal(sanitizeSummary("", purify), "");
  assert.equal(sanitizeSummary(undefined, purify), "");
});

test("toPlainText drops tags, separates blocks and collapses whitespace", () => {
  assert.equal(
    toPlainText(
      "<p>One&nbsp;two</p>\n<p>three<br>four</p><ul><li>five</li><li>six</li></ul><span>seven</span><b>eight</b>",
      windowFor,
    ),
    "One two three four five six seveneight",
  );
  assert.equal(toPlainText("", windowFor), "");
  assert.equal(toPlainText("<script>x()</script><p>y</p>", windowFor), "y");
});
