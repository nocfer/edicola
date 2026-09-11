// Extraction, pure (ADR-0004, ADR-0010): an Original's HTML becomes an Article,
// or the Item stays Summary-only. Readability, DOMPurify and the DOM are passed
// in so this runs unchanged in Node tests (jsdom) and in the browser through
// `src/extract.js`. Reader mode only: nothing here tries to obtain content the
// publisher withheld from an anonymous visitor.
//
// Pipeline: promote lazy-load attributes and absolutize URLs -> Readability ->
// DOMPurify with an explicit allowlist -> harden links, filter images, count
// words -> decide `ok`.

/**
 * Minimum words for a body the Feed itself carried to count as an Article
 * (ADR-0013). High on purpose: a Feed body is accepted INSTEAD of fetching the
 * Original, so a low floor here trades a whole Article for a blurb. Also the
 * floor `tools/check-catalog.mjs` audits the Catalog's `truncated` flag
 * against.
 */
export const MIN_ARTICLE_WORDS = 200;

/**
 * Minimum words for an Extraction of an Original to count as an Article.
 * Below this the body is taken as a teaser rather than a short Article.
 *
 * Lower than `MIN_ARTICLE_WORDS` because it answers a different question. Here
 * the Original has already been fetched, so there is nothing better to hold
 * out for, and the cost of the floor is discarding a complete Article. A wire
 * service's finished dispatches were measured at 70, 105 and 150 words while
 * one publisher's paywall teasers sat between 50 and 66, so 200 threw away
 * whole Articles and told the reader a subscription was the reason.
 *
 * The margin is four words, from 16 failures in one run. A calibration, not a
 * law: `test/qa-baseline.json` is what notices if it drifts.
 */
export const MIN_ORIGINAL_WORDS = 70;

/** Largest inline `data:` image kept in Article HTML, in characters (~bytes). */
const MAX_INLINE_DATA_IMAGE_CHARS = 32 * 1024;

/**
 * Above this share of link text over all text, an Extraction is navigation
 * (a category index, a homepage), not an Article. Mirrors the link-density
 * cutoff Readability itself uses when cleaning link lists.
 */
const MAX_LINK_DENSITY = 0.5;

/**
 * Shortest headline, in distinctive words, the off-topic test will judge. A
 * headline with fewer than this has too little to disagree with.
 */
const MIN_HEADLINE_WORDS = 4;

/** The separators publishers hang a section and a site name off a title with. */
const TITLE_SEPARATOR = /\s+[|\u00b7\u2013\u2014]\s+|\s+-\s+/;

/**
 * @typedef {object} Article
 * @property {boolean} ok True when the Extraction is good enough to store as an Article.
 * @property {string} title Article title, plain text ("" when unknown).
 * @property {string | null} byline Author line as Readability found it, plain text.
 * @property {string} excerpt One-line plain-text excerpt ("" when none).
 * @property {string} html Sanitized Article HTML ("" when Readability found nothing). Returned even when `ok` is false.
 * @property {number} wordCount Words in the sanitized HTML.
 * @property {string[]} imageUrls Ordered, de-duplicated absolute http(s) `img src` values in `html`.
 * @property {"no-content" | "too-short" | null} reason Why `ok` is false; null when `ok`.
 */

/**
 * @typedef {(html: string, url?: string) => { document: Document }} WindowFor
 * Builds a fresh DOM for one HTML string. Tests pass jsdom; the browser passes
 * a `DOMParser` wrapper (see `src/extract.js`).
 */

/**
 * @typedef {object} Purifier DOMPurify instance bound to a window.
 * @property {(html: string, config: object) => any} sanitize
 */

/** @typedef {new (doc: Document, options?: object) => { parse(): ReadabilityResult | null }} ReadabilityCtor */

/**
 * @typedef {object} ReadabilityResult
 * @property {string | null} title
 * @property {string | null} byline
 * @property {string | null} excerpt
 * @property {string} content
 * @property {string} textContent
 */

const LAZY_SRC_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original"];
const LAZY_SRCSET_ATTRIBUTES = ["data-srcset", "data-lazy-srcset"];

const SKIPPED_TEXT_TAGS = new Set(["script", "style", "noscript", "template"]);

/**
 * A closing tag sitting in a text node, once the parse has decoded the Feed's
 * entities: the fingerprint of a body whose own markup was escaped.
 *
 * A CLOSING tag is the signal and not any tag, because prose that mentions
 * `<canvas>` once means it literally, and decoding that would delete the word
 * when the sanitizer drops the element it became.
 */
const TAG_LEFT_AS_TEXT = /<\/[a-z][a-z0-9]*>/i;

/**
 * A WordPress shortcode a Feed left unrendered in its own body, e.g.
 * `[gallery ids="1,2,3"]`. Named one by one on purpose: over the whole Catalog
 * the only real shortcode is `gallery`, while a generic `[word …]` pattern
 * matches the bracketed insertions Italian and British reporting is full of —
 * `[Jack] said`, `[ndr]`, `[the minister]` — and would eat them.
 */
const FEED_SHORTCODE =
  /\[\/?(?:gallery|caption|embed|playlist|video|audio|wpvideo)\b[^\]]{0,200}\]/gi;

/**
 * Words below which a run of blocks after the Article's last horizontal rule
 * is the Feed's footer rather than the Article's ending.
 *
 * ponytail: a threshold, and the corpus is what sets it. HDblog's footer — a
 * rotating affiliate advert and a "click here to keep reading" link — is 23
 * words, while Galileo and openDemocracy use a rule inside the Article and
 * carry 208 to 465 words after the last one. Re-measure before moving it.
 */
const MAX_FEED_FOOTER_WORDS = 40;

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

/**
 * DOMPurify config for Article HTML. Text and structural tags, links, images,
 * figures, quotes, code and tables. No media, frames, forms, styles, scripts
 * or SVG. `class`, `id`, `style` and every `on*` handler go; `srcset`/`sizes`
 * go too, so a rewritten `src` (ticket 10) is the only source the browser sees.
 */
const ARTICLE_PURIFY_CONFIG = Object.freeze({
  ALLOWED_TAGS: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "div",
    "section",
    "span",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    "em",
    "strong",
    "b",
    "i",
    "u",
    "s",
    "sub",
    "sup",
    "small",
    "mark",
    "abbr",
    "cite",
    "q",
    "time",
    "kbd",
    "samp",
    "var",
    "del",
    "ins",
    "wbr",
    "a",
    "img",
    "figure",
    "figcaption",
    "blockquote",
    "pre",
    "code",
    "table",
    "caption",
    "colgroup",
    "col",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
  ],
  ALLOWED_ATTR: [
    "href",
    "src",
    "alt",
    "width",
    "height",
    "loading",
    "title",
    "colspan",
    "rowspan",
    "datetime",
    "lang",
    "dir",
  ],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: true,
});

/** DOMPurify config for Feed Summaries: text-level tags only. */
const SUMMARY_PURIFY_CONFIG = Object.freeze({
  ALLOWED_TAGS: ["p", "br", "em", "strong", "a", "ul", "ol", "li"],
  ALLOWED_ATTR: ["href"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: true,
});

/**
 * Extract an Article from an Original's HTML.
 *
 * `ok` is true when the sanitized text has at least `MIN_ARTICLE_WORDS` words.
 * `reason` is `"no-content"` when Readability found nothing, the text is empty,
 * it is mostly link labels (a listing, not prose), or it is about something
 * else entirely (the page's own furniture, not the piece); `"too-short"` when
 * there is prose but under the threshold. `html` is returned in every case it
 * exists so the caller may still show it.
 *
 * @param {string} html Raw HTML of the Original, as served to an anonymous visitor.
 * @param {{ url: string, windowFor: WindowFor, Readability: ReadabilityCtor, purify: Purifier }} deps
 * @returns {Article}
 */
export function extractArticle(html, { url, windowFor, Readability, purify }) {
  const { document } = windowFor(html, url);
  promoteLazyImages(document);
  absolutizeUrls(document, url);
  const documentTitle = collapseWhitespace(document.title || "");

  const parsed = new Readability(document).parse();
  if (!parsed?.content) {
    return {
      ok: false,
      title: documentTitle,
      byline: null,
      excerpt: "",
      html: "",
      wordCount: 0,
      imageUrls: [],
      reason: "no-content",
    };
  }

  /** @type {HTMLElement} */
  const body = purify.sanitize(parsed.content, {
    ...ARTICLE_PURIFY_CONFIG,
    RETURN_DOM: true,
  });
  hardenLinks(body, url);
  const imageUrls = filterImages(body);
  const text = textOf(body);
  const wordCount = countWords(text);
  const linkDensity = linkDensityOf(body, text);

  /** @type {Article["reason"]} */
  let reason = null;
  const title = collapseWhitespace(parsed.title || "") || documentTitle;
  if (wordCount === 0 || linkDensity > MAX_LINK_DENSITY) reason = "no-content";
  else if (wordCount < MIN_ORIGINAL_WORDS) reason = "too-short";
  else if (sharesNothingWithHeadline(title, text)) reason = "no-content";

  return {
    ok: reason === null,
    title,
    byline: collapseWhitespace(parsed.byline || "") || null,
    excerpt: collapseWhitespace(parsed.excerpt || ""),
    html: body.innerHTML,
    wordCount,
    imageUrls,
    reason,
  };
}

/**
 * Build an Article out of the body a Feed already handed us, with no
 * Readability pass and no second network request.
 *
 * Fourteen of the thirty Publications in the Catalog syndicate the whole
 * Article in the Feed — `content:encoded`, Atom `content`, or in a few cases a
 * `description` that is not a summary at all — between two hundred and eleven
 * hundred words. Sync used to drop all of it on the floor and then fetch the
 * Original to derive the same text again, which is a wasted request per Item
 * and, for a publisher that gates the Original behind a bot challenge, an
 * Article the reader never got at all despite it having arrived with the Feed.
 *
 * Readability is deliberately not run here. Its job is to find the article
 * inside a page full of navigation, and this input is already only the article:
 * a publisher chose these bytes as the syndicated body. So the steps are the
 * ones that make any third-party HTML safe and self-contained — resolve
 * relative URLs against the Item's own link, sanitize with the SAME
 * `ARTICLE_PURIFY_CONFIG` the Extraction path uses, harden the links, drop the
 * images we cannot store — and then the same quality floor decides whether the
 * result is an Article at all.
 *
 * Returns the identical `Article` shape as `extractArticle`, so the caller
 * stores it through one path and neither the Reader nor the database can tell
 * which source it came from.
 *
 * @param {string} html RAW Feed body: `contentHtml`, or `summaryHtml` when the
 *   Feed puts the whole Article there.
 * @param {{ url: string, title?: string, windowFor: WindowFor, purify: Purifier }} deps
 *   `url` is the Item's link, used as the base for relative URLs.
 * @returns {Article}
 */
export function articleFromFeed(html, { url, title = "", windowFor, purify }) {
  // No early return for empty input: the path below already answers
  // `no-content` for it, because an empty body sanitizes to an empty body and
  // counts zero words.
  const source = String(html || "").trim();

  // A Feed body is a fragment, so it is wrapped before parsing; `url` is the
  // Item's own link and not the Feed's, because a relative path in the body is
  // relative to the Original.
  const { document } = windowFor(
    `<!doctype html><html><body>${source}</body></html>`,
    url,
  );
  decodeTagsLeftAsText(document);
  promoteLazyImages(document);
  absolutizeUrls(document, url);

  /** @type {HTMLElement} */
  const body = purify.sanitize(document.body.innerHTML, {
    ...ARTICLE_PURIFY_CONFIG,
    RETURN_DOM: true,
  });
  dropFeedFooter(body);
  hardenLinks(body, url);
  const imageUrls = filterImages(body);
  const text = textOf(body);
  const wordCount = countWords(text);
  const linkDensity = linkDensityOf(body, text);

  /** @type {Article["reason"]} */
  let reason = null;
  if (wordCount === 0 || linkDensity > MAX_LINK_DENSITY) reason = "no-content";
  else if (wordCount < MIN_ARTICLE_WORDS) reason = "too-short";

  return {
    ok: reason === null,
    title: collapseWhitespace(title),
    byline: null,
    excerpt: "",
    html: body.innerHTML,
    wordCount,
    imageUrls,
    reason,
  };
}

/**
 * Apply a URL-to-URL map to every `img src` in sanitized Article HTML. The
 * Reader uses it to point images at stored blobs. `mapFn` returns the new URL,
 * or null/undefined to leave that image untouched. The input must already be
 * sanitized Article HTML: this does not sanitize, so `blob:` URLs survive.
 *
 * @param {string} html Sanitized Article HTML.
 * @param {(url: string) => string | null | undefined} mapFn
 * @param {{ windowFor: WindowFor }} deps
 * @returns {string}
 */
export function rewriteImageSources(html, mapFn, { windowFor }) {
  const { document } = windowFor(
    `<!doctype html><html><body>${html}</body></html>`,
  );
  for (const img of document.body.querySelectorAll("img[src]")) {
    const next = mapFn(img.getAttribute("src") || "");
    if (typeof next === "string" && next) img.setAttribute("src", next);
  }
  return document.body.innerHTML;
}

/**
 * Sanitize a Feed Summary for storage and render: `p`, `br`, `em`, `strong`,
 * `a`, `ul`, `ol`, `li` survive, everything else is unwrapped or dropped, and
 * links get `rel="noopener" target="_blank"`.
 *
 * @param {string} html Raw Summary HTML from a Feed.
 * @param {Purifier} purify
 * @returns {string}
 */
export function sanitizeSummary(html, purify) {
  /** @type {HTMLElement} */
  const body = purify.sanitize(html || "", {
    ...SUMMARY_PURIFY_CONFIG,
    RETURN_DOM: true,
  });
  hardenLinks(body);
  return body.innerHTML;
}

/**
 * Plain text of an HTML fragment for one-line excerpts: tags dropped, block
 * boundaries become spaces, whitespace collapsed. Nothing is executed.
 *
 * @param {string} html
 * @param {WindowFor} windowFor
 * @returns {string}
 */
export function toPlainText(html, windowFor) {
  if (!html) return "";
  const { document } = windowFor(
    `<!doctype html><html><body>${html}</body></html>`,
  );
  return textOf(document.body);
}

/**
 * Words in an HTML fragment, counted the way `extractArticle` counts them.
 * Used by `tools/check-catalog.mjs` to score a Feed's own Summaries.
 *
 * @param {string} html
 * @param {WindowFor} windowFor
 * @returns {number}
 */
export function countWordsInHtml(html, windowFor) {
  return countWords(toPlainText(html, windowFor));
}

// --- before Readability ------------------------------------------------------

/**
 * Re-parse text that is really markup the Feed escaped inside its own body.
 *
 * HDblog puts its Article in CDATA — so the XML parse decodes nothing — and
 * escapes the inner tags anyway, so `<strong>` arrives as text and the Reader
 * showed a literal tag in the middle of a sentence, `<h2>` headings included.
 * Only text nodes are touched, so an escaped tag inside an attribute (Physics
 * World's `data-caption`) is left alone, and never inside `code` or `pre`,
 * where markup as text is the point. Everything is sanitized afterwards like
 * any other Feed body, so decoding cannot smuggle a tag past DOMPurify.
 *
 * ponytail: one text node at a time, so a pair split across two nodes stays
 * text. No Feed in the Catalog does that; widen the scan if one starts.
 *
 * @param {Document} document
 */
function decodeTagsLeftAsText(document) {
  // 4 is NodeFilter.SHOW_TEXT, which is a window global this module never has.
  const walker = document.createTreeWalker(document.body, 4);
  /** @type {any[]} */
  const targets = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!TAG_LEFT_AS_TEXT.test(node.nodeValue || "")) continue;
    if (node.parentElement?.closest("code, pre")) continue;
    targets.push(node);
  }
  for (const node of targets) {
    const holder = document.createElement("div");
    holder.innerHTML = node.nodeValue || "";
    node.replaceWith(...holder.childNodes);
  }
}

/**
 * Copy lazy-load attributes into `src`/`srcset` so Readability keeps the image
 * and the real URL, not a placeholder.
 * @param {Document} document
 */
function promoteLazyImages(document) {
  for (const img of document.querySelectorAll("img")) {
    const lazySrc = firstAttribute(img, LAZY_SRC_ATTRIBUTES);
    if (lazySrc) img.setAttribute("src", lazySrc);
    const lazySrcset = firstAttribute(img, LAZY_SRCSET_ATTRIBUTES);
    if (lazySrcset && !img.getAttribute("srcset"))
      img.setAttribute("srcset", lazySrcset);
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) {
      const first = parseSrcset(img.getAttribute("srcset") || "")[0];
      if (first) img.setAttribute("src", first.url);
    }
  }
}

/**
 * Resolve every `href`, `src` and `srcset` against the Original's URL. In-page
 * `#anchor` links are left alone here so Readability still recognises a table
 * of contents; `hardenLinks` resolves them after sanitizing.
 * @param {Document} document
 * @param {string} baseUrl
 */
function absolutizeUrls(document, baseUrl) {
  for (const attr of ["href", "src"]) {
    for (const el of document.querySelectorAll(`[${attr}]`)) {
      const value = el.getAttribute(attr);
      const resolved = resolveUrl(value, baseUrl);
      if (resolved !== null && resolved !== value)
        el.setAttribute(attr, resolved);
    }
  }
  for (const el of document.querySelectorAll("[srcset]")) {
    const candidates = parseSrcset(el.getAttribute("srcset") || "");
    if (!candidates.length) continue;
    const rewritten = candidates
      .map((c) => {
        const url = resolveUrl(c.url, baseUrl) ?? c.url;
        return c.descriptor ? `${url} ${c.descriptor}` : url;
      })
      .join(", ");
    el.setAttribute("srcset", rewritten);
  }
}

/**
 * @param {string | null} value
 * @param {string} baseUrl
 * @returns {string | null} Absolute URL, or null when it cannot be resolved.
 */
function resolveUrl(value, baseUrl) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^(?:data|javascript|mailto|tel|blob):/i.test(trimmed)) return null;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Parse a `srcset` value into candidates, following the HTML algorithm closely
 * enough for real markup: a URL is a run of non-whitespace; a trailing comma
 * ends the candidate, otherwise descriptors run up to the next comma.
 * @param {string} srcset
 * @returns {{ url: string, descriptor: string }[]}
 */
function parseSrcset(srcset) {
  const out = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i])) i++;
    if (i >= srcset.length) break;
    const start = i;
    while (i < srcset.length && !/\s/.test(srcset[i])) i++;
    let url = srcset.slice(start, i);
    let descriptor = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      const end = srcset.indexOf(",", i);
      descriptor = (end === -1 ? srcset.slice(i) : srcset.slice(i, end)).trim();
      i = end === -1 ? srcset.length : end + 1;
    }
    if (url) out.push({ url, descriptor });
  }
  return out;
}

/**
 * @param {Element} el
 * @param {string[]} names
 * @returns {string} First non-empty attribute value among `names`, else "".
 */
function firstAttribute(el, names) {
  for (const name of names) {
    const value = (el.getAttribute(name) || "").trim();
    if (value) return value;
  }
  return "";
}

// --- after DOMPurify ---------------------------------------------------------

/**
 * Drop what a Feed appends to its own body and the Original never shows.
 *
 * Only the Feed path runs this. Readability does the same job for an Original
 * by ignoring everything outside the article it found, which is the quality
 * gap ADR-0013 accepted when the Feed body became an Article source: "inline
 * promotions and the publisher's own image wrappers survive where Readability
 * would have dropped them".
 *
 * Three things, each measured over the whole Catalog rather than guessed:
 *
 * 1. An unrendered shortcode, `[gallery ids="285039,285038,285037"]` in the
 *    middle of a sentence.
 * 2. The footer after the last horizontal rule, when it is short enough to be
 *    a footer — HDblog closes every Article with a rotating affiliate advert
 *    and a "CLICCA QUI PER CONTINUARE A LEGGERE" link, and the Reader already
 *    offers the Original in its own footer. A link is required so a short
 *    editorial note after a rule survives.
 * 3. Whatever rule or empty block is left at the end once those are gone.
 *
 * @param {HTMLElement} root Sanitized Article body.
 */
function dropFeedFooter(root) {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* TEXT_NODE */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue || "";
    const cleaned = text.replace(FEED_SHORTCODE, "");
    if (cleaned !== text) node.nodeValue = cleaned;
  }

  const blocks = [...root.children];
  const rule = blocks.findLastIndex((el) => el.tagName === "HR");
  if (rule > -1) {
    const footer = blocks.slice(rule + 1);
    const words = countWords(footer.map((el) => textOf(el)).join(" "));
    if (
      words < MAX_FEED_FOOTER_WORDS &&
      footer.some((el) => el.querySelector("a"))
    ) {
      for (const el of footer) el.remove();
      blocks[rule].remove();
    }
  }

  for (let last = root.lastElementChild; last; last = root.lastElementChild) {
    const empty = !textOf(last).trim() && !last.querySelector("img");
    if (last.tagName !== "HR" && !empty) break;
    last.remove();
  }
}

/**
 * Every link opens in a new tab without an opener handle. In-page `#anchor`
 * links point at the Original when `baseUrl` is given: `id`s are stripped, so
 * they could not scroll the Reader anyway.
 * @param {HTMLElement} root
 * @param {string} [baseUrl]
 */
function hardenLinks(root, baseUrl) {
  for (const a of root.querySelectorAll("a[href]")) {
    // An anchor whose only content is an undescribed image has no accessible
    // name by any route, so it is unusable with a screen reader and unlabelled
    // to everyone else. Measured over the Catalog it is never a link a reader
    // would want: HDblog wraps all nine of its photos in a link to the same
    // photo, TechRadar wraps affiliate banners. Unwrap it, keep the picture.
    const wrapped = a.querySelector("img");
    if (
      wrapped &&
      !(a.textContent || "").trim() &&
      !wrapped.getAttribute("alt") &&
      !a.getAttribute("title")
    ) {
      a.replaceWith(...a.childNodes);
      continue;
    }

    const href = (a.getAttribute("href") || "").trim();
    if (baseUrl && href.startsWith("#")) {
      try {
        a.setAttribute("href", new URL(href, baseUrl).href);
      } catch {
        a.removeAttribute("href");
      }
    }
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
  }
}

/**
 * Keep http(s) images and small inline `data:` images; drop the rest. Returns
 * the ordered, de-duplicated http(s) URLs.
 * @param {HTMLElement} root
 * @returns {string[]}
 */
function filterImages(root) {
  /** @type {string[]} */
  const urls = [];
  const seen = new Set();
  for (const img of root.querySelectorAll("img")) {
    // The publisher described none of these: HDblog every picture, Linkiesta
    // half of them. An empty `alt` is the honest answer — a screen reader
    // skips an undescribed decoration instead of announcing a CDN filename —
    // and it stops a missing attribute here looking like one of our own
    // templates forgetting it.
    if (!img.hasAttribute("alt")) img.setAttribute("alt", "");
    const src = (img.getAttribute("src") || "").trim();
    if (/^https?:\/\//i.test(src)) {
      if (seen.has(src)) {
        // The same picture twice in one body is decoration, not content. It is
        // usually a no-JS placeholder: BBC articles carry three copies of a
        // grey "image unavailable" PNG with no lazy attribute to promote, so
        // `promoteLazyImages` cannot help and the reader used to get three grey
        // boxes and a download for one of them. A publisher who really did
        // repeat a photo loses nothing worth keeping.
        img.remove();
        continue;
      }
      seen.add(src);
      urls.push(src);
    } else if (
      src.startsWith("data:image/") &&
      src.length <= MAX_INLINE_DATA_IMAGE_CHARS
    ) {
      // Small inline image: kept in the HTML, not part of the download list.
    } else {
      img.remove();
    }
  }
  return urls;
}

/**
 * Text of a node with block boundaries turned into spaces and whitespace
 * collapsed.
 * @param {Node} node
 * @returns {string}
 */
function textOf(node) {
  /** @type {string[]} */
  const parts = [];
  walkText(node, parts);
  return collapseWhitespace(parts.join(""));
}

/**
 * @param {Node} node
 * @param {string[]} parts
 */
function walkText(node, parts) {
  if (node.nodeType === 3) {
    parts.push(/** @type {Text} */ (node).data);
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11)
    return;
  const tag = node.nodeType === 1 ? node.nodeName.toLowerCase() : "";
  if (SKIPPED_TEXT_TAGS.has(tag)) return;
  const block = BLOCK_TAGS.has(tag);
  if (block) parts.push(" ");
  for (const child of node.childNodes) walkText(child, parts);
  if (block) parts.push(" ");
}

/**
 * @param {string} text
 * @returns {string}
 */
function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} text Collapsed plain text.
 * @returns {number}
 */
function countWords(text) {
  return text
    ? text.split(" ").filter((w) => /\p{L}|\p{N}/u.test(w)).length
    : 0;
}

/**
 * Words a headline and a body can honestly be compared on: four letters or
 * more, lower-cased with the accents folded off, de-duplicated. Shorter words
 * are dropped because half of an Italian or English headline is articles and
 * prepositions, which every block on a page contains.
 * @param {string} value
 * @returns {Set<string>}
 */
function distinctiveWords(value) {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4),
  );
}

/**
 * True when the extracted prose has not one distinctive word in common with
 * the page's headline: Readability settled on a block that is not the Article.
 *
 * ANSA's photogallery pages carry no prose at all, so the winning candidate is
 * the cookie-consent wall and the subscription pitch under it - 211 words,
 * three times the floor, every one of them about cookies and none about the
 * piece. The Reader showed it as the Article. A word count cannot see that and
 * link density cannot either, because the wall is mostly plain text.
 *
 * The headline is the LONGEST segment of the title, not the whole of it: the
 * site name a publisher hangs off the end ("... - Primopiano - Ansa.it")
 * appears in that publisher's own boilerplate, and would match it.
 *
 * Measured over the whole Catalog, three Originals per Publication: every
 * Article that clears the word floor shares at least one headline word with
 * its body, and the only one this rejects is the ANSA wall.
 * @param {string} title
 * @param {string} text Collapsed plain text of the extracted body.
 * @returns {boolean}
 */
function sharesNothingWithHeadline(title, text) {
  const headline = title
    .split(TITLE_SEPARATOR)
    .reduce(
      (longest, part) => (part.length > longest.length ? part : longest),
      "",
    );
  const headlineWords = distinctiveWords(headline);
  if (headlineWords.size < MIN_HEADLINE_WORDS) return false;
  const bodyWords = distinctiveWords(text);
  for (const word of headlineWords) if (bodyWords.has(word)) return false;
  return true;
}

/**
 * Share of characters inside links over all characters.
 * @param {HTMLElement} root
 * @param {string} text Collapsed plain text of `root`.
 * @returns {number}
 */
function linkDensityOf(root, text) {
  if (!text.length) return 0;
  let linkChars = 0;
  for (const a of root.querySelectorAll("a")) linkChars += textOf(a).length;
  return Math.min(1, linkChars / text.length);
}
