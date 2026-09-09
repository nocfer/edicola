// The QA checks are the half of a QA run that must never need a human, so
// they need to be right without one. Fixtures here are the smallest shape that
// makes each check fire, and the negative case for the ones most likely to
// cry wolf over a healthy Publication.

import assert from "node:assert/strict";
import test from "node:test";
import { checkContent, checkRendered } from "../tools/qa-checks.js";
import { windowFor } from "../tools/testing/dom.js";

/** @param {Partial<any>} [over] */
function item(over = {}) {
  return {
    id: "p:1",
    publicationId: "p",
    title: "A headline",
    link: "https://example.test/a",
    summaryText: "Two words",
    thumbnailUrl: null,
    hasArticle: true,
    summaryOnlyReason: null,
    ...over,
  };
}

/** @param {Partial<any>} [over] */
function article(over = {}) {
  return {
    itemId: "p:1",
    html: "<p>Body text here.</p>",
    wordCount: 900,
    ...over,
  };
}

const publication = { id: "p", name: "Example", lastError: null };

/** @param {any[]} items @param {any[]} articles */
function run(items, articles) {
  return checkContent({
    publication,
    items,
    articles: new Map(articles.map((a) => [a.itemId, a])),
    windowFor,
  });
}

/** @param {Finding[]} findings @param {string} check */
const ids = (findings) => findings.map((f) => f.check);

test("a healthy Publication produces no findings", () => {
  assert.deepEqual(run([item()], [article()]), []);
});

test("no Items at all is reported with the Publication's lastError", () => {
  const findings = checkContent({
    publication: { id: "p", name: "Example", lastError: "blocked" },
    items: [],
    articles: new Map(),
    windowFor,
  });
  assert.deepEqual(ids(findings), ["no-items"]);
  assert.match(findings[0].detail, /blocked/);
});

test("Items but no Articles reports the reason histogram", () => {
  const findings = run(
    [
      item({ id: "p:1", hasArticle: false, summaryOnlyReason: "blocked" }),
      item({ id: "p:2", hasArticle: false, summaryOnlyReason: "blocked" }),
      item({ id: "p:3", hasArticle: false, summaryOnlyReason: "too-short" }),
    ],
    [],
  );
  assert.ok(ids(findings).includes("no-articles"));
  assert.match(findings[0].detail, /blocked=2/);
});

test("an Article shorter than the Summary it replaced is a high finding", () => {
  const findings = run(
    [item({ summaryText: "one two three four five" })],
    [article({ wordCount: 3 })],
  );
  assert.ok(ids(findings).includes("article-shorter-than-summary"));
});

test("the same image twice in one Article is reported once", () => {
  const findings = run(
    [item()],
    [article({ html: '<img src="a.jpg"><p>x</p><img src="a.jpg">' })],
  );
  assert.deepEqual(ids(findings), ["duplicate-image-in-article"]);
});

test("a thumbnail that is also the Article's first image is a duplicate hero", () => {
  const findings = run(
    [item({ thumbnailUrl: "https://example.test/hero.jpg" })],
    [article({ html: '<img src="https://example.test/hero.jpg"><p>x</p>' })],
  );
  assert.ok(ids(findings).includes("duplicate-hero"));
});

test("one thumbnail shared by most Items is a publisher placeholder", () => {
  const shared = "https://example.test/logo.png";
  const items = [1, 2, 3, 4].map((n) =>
    item({ id: `p:${n}`, thumbnailUrl: shared }),
  );
  const findings = checkContent({
    publication,
    items,
    articles: new Map(),
    windowFor,
  });
  assert.ok(ids(findings).includes("shared-thumbnail"));
});

test("two Items sharing a thumbnail is not enough to complain", () => {
  const shared = "https://example.test/logo.png";
  const items = [1, 2].map((n) => item({ id: `p:${n}`, thumbnailUrl: shared }));
  const findings = checkContent({
    publication,
    items,
    articles: new Map(),
    windowFor,
  });
  assert.ok(!ids(findings).includes("shared-thumbnail"));
});

test("publisher furniture kept by Extraction is reported from the text, not the markup", () => {
  const kept = run([item()], [article({ html: "<p>Leggi anche: altro</p>" })]);
  assert.ok(ids(kept).includes("boilerplate-residue"));
  const classNameOnly = run(
    [item()],
    [article({ html: '<p class="leggi anche">Real prose.</p>' })],
  );
  assert.ok(!ids(classNameOnly).includes("boilerplate-residue"));
});

test("a placeholder value in a title is a high finding", () => {
  const findings = run([item({ title: "undefined - Example" })], []);
  assert.ok(ids(findings).includes("placeholder-in-title"));
});

test("an ordinary word that merely contains a placeholder is not one", () => {
  // Both of these are real headlines from a live run, and a substring test
  // reported both as placeholders because "nulla" and "annullato" contain
  // "null". A check that fires on real headlines gets ignored.
  for (const title of [
    "Arrestato per uno scambio di persona: con quella violenza non c'entrava nulla",
    "Temptation Island, annullato il licenziamento del partecipante",
  ]) {
    assert.ok(
      !ids(run([item({ title })], [])).includes("placeholder-in-title"),
      title,
    );
  }
});

test("an Article a few words shorter than its Summary is a tie, not a loss", () => {
  // A Feed carrying the whole Article in content:encoded makes the two nearly
  // identical; 595 words against 599 is not Extraction losing anything.
  const summary = new Array(599).fill("word").join(" ");
  const close = run(
    [item({ summaryText: summary })],
    [article({ wordCount: 595 })],
  );
  assert.ok(!ids(close).includes("article-shorter-than-summary"));
  const real = run(
    [item({ summaryText: summary })],
    [article({ wordCount: 120 })],
  );
  assert.ok(ids(real).includes("article-shorter-than-summary"));
});

/** @param {string} body */
function rendered(body) {
  const window = windowFor(`<!doctype html><html><body>${body}</body></html>`);
  return checkRendered({ document: window.document, screen: "Today" });
}

test("a control with no accessible name is reported", () => {
  const findings = rendered('<button class="btn"><svg></svg></button>');
  assert.ok(ids(findings).includes("control-without-name"));
});

test("a control named only by aria-label is accepted", () => {
  const findings = rendered('<button aria-label="Save"><svg></svg></button>');
  assert.ok(!ids(findings).includes("control-without-name"));
});

test("an i18n key on screen is reported, ordinary prose is not", () => {
  assert.ok(
    ids(rendered("<p>reader.reason.blocked</p>")).includes("untranslated-key"),
  );
  assert.ok(
    !ids(rendered("<p>The publisher refused.</p>")).includes(
      "untranslated-key",
    ),
  );
});

test("a rendered placeholder value is reported", () => {
  assert.ok(ids(rendered("<p>undefined</p>")).includes("placeholder-rendered"));
});

test('an image with no alt attribute is a low finding, alt="" is not', () => {
  assert.ok(ids(rendered('<img src="a.jpg">')).includes("image-without-alt"));
  assert.ok(
    !ids(rendered('<img src="a.jpg" alt="">')).includes("image-without-alt"),
  );
});
