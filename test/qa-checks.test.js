// The QA checks are the half of a QA run that must never need a human, so
// they need to be right without one. Fixtures here are the smallest shape that
// makes each check fire, and the negative case for the ones most likely to
// cry wolf over a healthy Publication.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractArticle } from "../src/extract-core.js";
import { checkContent, checkRendered } from "../tools/qa-checks.js";
import { Readability, purifierFor, windowFor } from "../tools/testing/dom.js";

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

test("a thumbnail that is also the Article's first image is not a finding", () => {
  // `thumbnailUrl` renders on Today cards and nowhere else, so nothing shows
  // the picture twice on one screen, and `feed.js` derives the thumbnail from
  // the first image of the Feed body — making the two equal for every Article
  // built from a Feed. Flagging it fired on 27 of 27 healthy Articles.
  const findings = run(
    [item({ thumbnailUrl: "https://example.test/hero.jpg" })],
    [article({ html: '<img src="https://example.test/hero.jpg"><p>x</p>' })],
  );
  assert.deepEqual(findings, []);
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

// --- The healthy corpus ----------------------------------------------------
//
// Every check here is only useful if it stays quiet on content that is fine.
// Four of them did not: `placeholder-in-title` fired on the Italian words
// "nulla" and "annullato", `article-shorter-than-summary` called 595 words
// against 599 a loss, `no-items` conflated a failed Feed with an empty one,
// and a `duplicate-hero` check fired on 27 of 27 healthy Articles before it
// was removed. Each of those shipped, ran against the live web, and produced a
// report nobody could trust.
//
// So: run the checks over known-good content and assert silence. A check that
// cannot pass this does not belong in the file.
//
// The rendered fixtures are the app's own `body.innerHTML`, captured with
// `node tools/qa-run.mjs --only open --capture-dom test/fixtures/screens`.
// Refresh them when a template changes; do not hand-edit them, because the
// point is that they are what the app really emits.

const SCREENS = resolve(fileURLToPath(import.meta.url), "../fixtures/screens");

/** @param {string} name */
function screenFixture(name) {
  return readFileSync(resolve(SCREENS, `${name}.html`), "utf8");
}

test("checkContent stays quiet on a healthy Publication built from a real Article", () => {
  // A real page through the real Extraction, so the Article HTML under test is
  // the shape the pipeline actually stores rather than a hand-written stub.
  const purify = purifierFor(windowFor());
  const extracted = extractArticle(
    readFileSync(
      resolve(
        fileURLToPath(import.meta.url),
        "../fixtures/articles/bbc-news-long-article.html",
      ),
      "utf8",
    ),
    {
      url: "https://www.bbc.co.uk/news/articles/cr4vn1e207go",
      windowFor,
      Readability,
      purify,
    },
  );
  assert.ok(extracted.ok, "the fixture should extract, or this proves nothing");

  const items = [1, 2, 3].map((n) => ({
    id: `bbc:${n}`,
    publicationId: "bbc",
    title: `A perfectly ordinary headline ${n}`,
    link: `https://www.bbc.co.uk/news/${n}`,
    summaryText: "A short trailer for the piece.",
    thumbnailUrl: `https://ichef.bbci.co.uk/news/${n}.jpg`,
    hasArticle: true,
    summaryOnlyReason: null,
  }));
  const findings = checkContent({
    publication: { id: "bbc", name: "BBC News", lastError: null },
    items,
    articles: new Map(
      items.map((item) => [item.id, { ...extracted, itemId: item.id }]),
    ),
    windowFor,
  });
  assert.deepEqual(findings, []);
});

test("checkContent stays quiet on Italian headlines that merely contain placeholder words", () => {
  // Real headlines from a live run. Both contain the substring "null".
  const titles = [
    "Arrestato per uno scambio di persona: con quella violenza non c'entrava nulla",
    "Temptation Island, annullato il licenziamento del partecipante-poliziotto",
    "Il nulla osta è arrivato senza alcuna nota",
  ];
  const items = titles.map((title, n) => ({
    id: `it:${n}`,
    publicationId: "it",
    title,
    link: `https://example.test/${n}`,
    summaryText: "Sommario.",
    thumbnailUrl: null,
    hasArticle: true,
    summaryOnlyReason: null,
  }));
  const findings = checkContent({
    publication: { id: "it", name: "Testata", lastError: null },
    items,
    articles: new Map(),
    windowFor,
  });
  assert.deepEqual(findings, []);
});

for (const screen of ["today-list", "today-feed", "reader"]) {
  test(`checkRendered stays quiet on the real ${screen} markup`, () => {
    const window = windowFor(
      `<!doctype html><html><body>${screenFixture(screen)}</body></html>`,
    );
    const findings = checkRendered({
      document: window.document,
      screen,
    });
    // jsdom lays nothing out, so every box is 0x0 and the tap-target and
    // overflow checks cannot fire here — those two are covered in the browser
    // by tools/qa-run.mjs, and this corpus covers the content-shaped ones:
    // unnamed controls, placeholder text, leaked i18n keys, missing alt.
    assert.deepEqual(findings, []);
  });
}
