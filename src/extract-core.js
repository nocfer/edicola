// Extraction, pure (ADR-0004, ADR-0010): an Original's HTML becomes an Article,
// or the Item stays Summary-only. Readability, DOMPurify and the DOM are passed
// in so this runs unchanged in Node tests (jsdom) and in the browser through
// `src/extract.js`. Reader mode only: nothing here tries to obtain content the
// publisher withheld from an anonymous visitor.
//
// Pipeline: promote lazy-load attributes and absolutize URLs -> Readability ->
// DOMPurify with an explicit allowlist -> harden links, filter images, count
// words -> decide `ok`.

/** Minimum words for an Extraction to count as an Article. */
export const MIN_ARTICLE_WORDS = 200;

/** Largest inline `data:` image kept in Article HTML, in characters (~bytes). */
export const MAX_INLINE_DATA_IMAGE_CHARS = 32 * 1024;

/**
 * Above this share of link text over all text, an Extraction is navigation
 * (a category index, a homepage), not an Article. Mirrors the link-density
 * cutoff Readability itself uses when cleaning link lists.
 */
export const MAX_LINK_DENSITY = 0.5;

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
export const ARTICLE_PURIFY_CONFIG = Object.freeze({
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
export const SUMMARY_PURIFY_CONFIG = Object.freeze({
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
 * or the text is mostly link labels (a listing, not prose); `"too-short"` when
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
  if (wordCount === 0 || linkDensity > MAX_LINK_DENSITY) reason = "no-content";
  else if (wordCount < MIN_ARTICLE_WORDS) reason = "too-short";

  return {
    ok: reason === null,
    title: collapseWhitespace(parsed.title || "") || documentTitle,
    byline: collapseWhitespace(parsed.byline || "") || null,
    excerpt: collapseWhitespace(parsed.excerpt || ""),
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
 * Every link opens in a new tab without an opener handle. In-page `#anchor`
 * links point at the Original when `baseUrl` is given: `id`s are stripped, so
 * they could not scroll the Reader anyway.
 * @param {HTMLElement} root
 * @param {string} [baseUrl]
 */
function hardenLinks(root, baseUrl) {
  for (const a of root.querySelectorAll("a[href]")) {
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
    const src = (img.getAttribute("src") || "").trim();
    if (/^https?:\/\//i.test(src)) {
      if (!seen.has(src)) {
        seen.add(src);
        urls.push(src);
      }
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
