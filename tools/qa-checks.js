// The machine-checkable half of a QA run.
//
// A QA pass over live Publications produces two kinds of finding. Some need
// judgement — does this crop make sense, does this read like an article — and
// belong to whoever is looking at the screenshots. The rest are mechanical,
// and those live here: a duplicated hero image, a button with no accessible
// name, an i18n key rendered instead of its translation. Mechanical findings
// must not cost a judgement pass, because a judgement pass over thirty
// Publications is expensive and its standards drift between runs.
//
// The rule that keeps this file worth having: when a judgement finding shows
// up twice, write the check here and stop paying for it.
//
// Both entry points take their DOM as a dependency (ADR-0010), so they run in
// the page against the real render and under `node --test` against jsdom. No
// imports at all, which is what lets the page load this file straight off the
// static server with `import('/tools/qa-checks.js')`.

/**
 * One thing that is wrong.
 * @typedef {object} Finding
 * @property {string} check Stable id, e.g. `duplicate-hero`.
 * @property {'high' | 'medium' | 'low'} severity
 * @property {string | null} publicationId
 * @property {string | null} itemId
 * @property {string} detail One sentence, with the specifics inline.
 */

/**
 * Article boilerplate that Readability keeps often enough to be worth naming.
 * Matched case-insensitively against the Article text, not its markup, so a
 * class name called "newsletter" does not trip it.
 */
const BOILERPLATE = Object.freeze([
  "leggi anche",
  "potrebbe interessarti",
  "iscriviti alla newsletter",
  "condividi su",
  "sign up for our newsletter",
  "read more:",
  "advertisement",
  "accetta i cookie",
  "accept cookies",
]);

// There is deliberately NO "the card thumbnail is also the Article's first
// image" check. It looks like a duplicate and it is not: `thumbnailUrl` is
// rendered on Today cards only and never in the Reader, so nothing shows the
// picture twice on one screen — tapping a card and finding the same photo at
// the top of the piece is the behaviour anyone would want. Worse, `feed.js`
// derives `thumbnailUrl` from the first image of the Feed body, so for every
// Article built from a Feed the two are equal by construction: the check fired
// on 27 of 27 healthy Articles before it was removed. The real duplicate is
// `duplicate-image-in-article`, one image twice inside one body.

/** Text that means a template rendered a value it did not have. */
const PLACEHOLDERS = Object.freeze([
  "undefined",
  "null",
  "NaN",
  "[object Object]",
]);

/**
 * The same list as a whole-word matcher. A plain substring test reported the
 * Italian headlines "non c'entrava nulla" and "annullato il licenziamento" as
 * placeholders, because both contain "null". A check that cries wolf on real
 * headlines gets ignored, which costs more than the check ever found.
 */
const PLACEHOLDER_WORD = new RegExp(
  `(^|\\W)(${PLACEHOLDERS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})($|\\W)`,
);

/**
 * How much shorter than its own Summary an Article has to be before it counts
 * as a loss. Feeds that carry the whole Article in `content:encoded` make the
 * two nearly identical, and 595 words against 599 is a tie, not a regression.
 */
const SUMMARY_LOSS_RATIO = 0.9;

/**
 * An i18n key that reached the screen instead of its translation: two or more
 * dot-separated lowerCamel segments and nothing else, e.g. `reader.reason.blocked`.
 */
const I18N_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){1,3}$/;

/** Smallest comfortable tap target, in CSS px, per the platform guidelines. */
const MIN_TAP_TARGET = 44;

/**
 * @param {string} text
 * @returns {number}
 */
function wordsIn(text) {
  const trimmed = String(text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * @param {Finding[]} out
 * @param {string} check
 * @param {'high' | 'medium' | 'low'} severity
 * @param {string | null} publicationId
 * @param {string | null} itemId
 * @param {string} detail
 */
function add(out, check, severity, publicationId, itemId, detail) {
  out.push({ check, severity, publicationId, itemId, detail });
}

/**
 * Every `img` src in one piece of Article markup, in document order.
 * @param {string} html
 * @param {(html: string) => { document: Document }} windowFor
 * @returns {string[]}
 */
function imageSourcesOf(html, windowFor) {
  const { document } = windowFor(
    `<!doctype html><html><body>${html || ""}</body></html>`,
  );
  return [...document.querySelectorAll("img")].map(
    (img) => img.getAttribute("src") || "",
  );
}

/**
 * The Article's text, for the checks that must not match markup.
 * @param {string} html
 * @param {(html: string) => { document: Document }} windowFor
 * @returns {string}
 */
function textOf(html, windowFor) {
  const { document } = windowFor(
    `<!doctype html><html><body>${html || ""}</body></html>`,
  );
  return document.body.textContent || "";
}

/**
 * @typedef {object} ContentInput
 * @property {{ id: string, name: string, lastError: string | null }} publication
 * @property {any[]} items Rows from `items` for this Publication.
 * @property {Map<string, any> | Record<string, any>} articles Article rows by `itemId`.
 * @property {(html: string) => { document: Document }} windowFor
 */

/**
 * Check what one Publication actually stored: the Items, their Articles and
 * the relationship between the two. This is the half that does not need the
 * app to be on screen, so it runs over a dump and stays cheap to re-run.
 *
 * @param {ContentInput} input
 * @returns {Finding[]}
 */
export function checkContent({ publication, items, articles, windowFor }) {
  /** @type {Finding[]} */
  const out = [];
  const pid = publication.id;
  const articleFor = (id) =>
    articles instanceof Map ? articles.get(id) : articles[id];

  if (items.length === 0) {
    add(
      out,
      "no-items",
      "high",
      pid,
      null,
      publication.lastError
        ? `${publication.name} stored no Items (lastError: ${publication.lastError}).`
        : `${publication.name} stored no Items and reported no error, so the Feed answered and nothing survived. Either it carries no Items Edicola can read, or every one of them is older than Retention's maxAgeDays and Eviction removed them in the same Sync. Fetch the Feed and look at its dates.`,
    );
    return out;
  }

  const withArticle = items.filter((item) => item.hasArticle);
  if (withArticle.length === 0) {
    add(
      out,
      "no-articles",
      "high",
      pid,
      null,
      `${publication.name} stored ${items.length} Items and not one Article. Reasons: ${histogramOf(items)}. Run qa-diagnose on one Original before blaming Extraction.`,
    );
  }

  // A thumbnail shared by most Items is a publisher placeholder, not a
  // picture of anything. It reads as a broken app: every card the same.
  const thumbnails = items
    .map((item) => item.thumbnailUrl)
    .filter((url) => typeof url === "string" && url.length > 0);
  const thumbCounts = new Map();
  for (const url of thumbnails) {
    thumbCounts.set(url, (thumbCounts.get(url) || 0) + 1);
  }
  for (const [url, count] of thumbCounts) {
    if (count > 2 && count >= thumbnails.length / 2) {
      add(
        out,
        "shared-thumbnail",
        "medium",
        pid,
        null,
        `${count} of ${items.length} Items share one thumbnail (${url}). Every card will look the same.`,
      );
    }
  }

  for (const item of items) {
    if (!item.link) {
      add(
        out,
        "item-without-link",
        "medium",
        pid,
        item.id,
        `"${item.title}" has no Original to open.`,
      );
    }
    const placeholderInTitle = PLACEHOLDER_WORD.exec(String(item.title || ""));
    if (placeholderInTitle) {
      add(
        out,
        "placeholder-in-title",
        "high",
        pid,
        item.id,
        `Title contains "${placeholderInTitle[2]}" as a word: ${item.title}`,
      );
    }

    const article = articleFor(item.id);
    if (!article) continue;

    const summaryWords = wordsIn(item.summaryText);
    if (
      summaryWords > 0 &&
      article.wordCount < summaryWords * SUMMARY_LOSS_RATIO
    ) {
      add(
        out,
        "article-shorter-than-summary",
        "high",
        pid,
        item.id,
        `Extraction kept ${article.wordCount} words where the Feed Summary already had ${summaryWords}. The Article is worse than the Summary it replaced.`,
      );
    }

    const sources = imageSourcesOf(article.html, windowFor);
    const seen = new Set();
    for (const src of sources) {
      if (!src) continue;
      if (seen.has(src)) {
        add(
          out,
          "duplicate-image-in-article",
          "medium",
          pid,
          item.id,
          `The same image appears more than once in the Article: ${src}. Extraction deduplicates images (see filterImages in extract-core.js), so this should be unreachable — if it fires, that dedup regressed.`,
        );
        break;
      }
      seen.add(src);
    }

    const text = textOf(article.html, windowFor).toLowerCase();
    for (const phrase of BOILERPLATE) {
      if (text.includes(phrase)) {
        add(
          out,
          "boilerplate-residue",
          "low",
          pid,
          item.id,
          `Extraction kept publisher furniture: "${phrase}".`,
        );
        break;
      }
    }
  }

  return out;
}

/**
 * A one-line `reason: count` histogram of why Items have no Article.
 * @param {any[]} items
 * @returns {string}
 */
function histogramOf(items) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  // No Article and no reason means Sync never reached this Item: it prefetches
  // only the newest `articlesPerPublication` (Retention, default 10), so a
  // Publication with more stored Items always has a tail it did not attempt.
  // Calling that "unknown" would read as a failure nobody can explain.
  for (const item of items) {
    const key = item.hasArticle
      ? "ok"
      : item.summaryOnlyReason || "not-attempted";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
}

/**
 * Check what is on screen right now. Runs in the page, where `document` is the
 * real render and layout has happened, so it can see what no fixture can: an
 * image that failed to load, a control too small to hit, a row wider than the
 * viewport.
 *
 * @param {object} input
 * @param {Document} input.document
 * @param {string} input.screen Where we are, for the finding text.
 * @param {string | null} [input.publicationId]
 * @returns {Finding[]}
 */
export function checkRendered({ document, screen, publicationId = null }) {
  /** @type {Finding[]} */
  const out = [];
  const where = (extra) => `${screen}: ${extra}`;

  for (const el of document.querySelectorAll(
    'button, [role="button"], a[href]',
  )) {
    const classes = String(el.className || "");
    const name =
      (el.textContent || "").trim() ||
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.querySelector("img")?.alt ||
      "";
    if (!name) {
      add(
        out,
        "control-without-name",
        "high",
        publicationId,
        null,
        where(
          `a ${el.tagName.toLowerCase()}${classes ? `.${classes.split(" ")[0]}` : ""} has no accessible name, so it is unusable with a screen reader and unlabelled to everyone else.`,
        ),
      );
    }
    // Two exemptions, both deliberate rather than convenient.
    //
    // `.btn--icon` is held at 40px by a decision recorded in styles.css: every
    // screen older than Feed mode uses it at that size, and `.btn--tap` is the
    // 44px variant for the ones that want the floor. Reporting it forever would
    // train everyone to ignore this check.
    //
    // A bare `<a>` with no control styling is a link inside prose, and its
    // target is its own text — "Open original" at 214x20 is ordinary typography,
    // not an undersized button.
    const isControl =
      el.tagName !== "A" || /\b(btn|chip|tab|seg)\b/.test(classes);
    const box = el.getBoundingClientRect();
    if (
      isControl &&
      !classes.includes("btn--icon") &&
      box.width > 0 &&
      (box.width < MIN_TAP_TARGET || box.height < MIN_TAP_TARGET)
    ) {
      add(
        out,
        "tap-target-too-small",
        "medium",
        publicationId,
        null,
        where(
          `"${name.slice(0, 30)}" is ${Math.round(box.width)}x${Math.round(box.height)} px, under the ${MIN_TAP_TARGET} px tap target.`,
        ),
      );
    }
  }

  const walker = document.createTreeWalker(document.body, 4 /* TEXT_NODE */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue || "").trim();
    if (!text) continue;
    if (PLACEHOLDERS.includes(text)) {
      add(
        out,
        "placeholder-rendered",
        "high",
        publicationId,
        null,
        where(
          `the text "${text}" is on screen, so a template rendered a value it did not have.`,
        ),
      );
    }
    if (I18N_KEY.test(text)) {
      add(
        out,
        "untranslated-key",
        "high",
        publicationId,
        null,
        where(
          `"${text}" looks like an i18n key rendered instead of its translation.`,
        ),
      );
    }
  }

  for (const img of document.querySelectorAll("img")) {
    if (img.complete && img.naturalWidth === 0) {
      add(
        out,
        "broken-image",
        "medium",
        publicationId,
        null,
        where(
          `an image failed to load: ${img.getAttribute("src") || "(no src)"}`,
        ),
      );
    }
    if (!img.getAttribute("alt") && img.getAttribute("alt") !== "") {
      add(
        out,
        "image-without-alt",
        "low",
        publicationId,
        null,
        where(
          `an image has no alt attribute: ${img.getAttribute("src") || "(no src)"}`,
        ),
      );
    }
  }

  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) {
    add(
      out,
      "horizontal-overflow",
      "high",
      publicationId,
      null,
      where(
        `the page scrolls sideways: ${root.scrollWidth} px of content in a ${root.clientWidth} px viewport.`,
      ),
    );
  }

  return out;
}
