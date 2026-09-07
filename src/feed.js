// Feed parsing: any real-world Feed becomes a normalized Feed with Items.
//
// Pure module. It takes the Feed text and a `DOMParser` implementation (the
// browser's own, or jsdom's in tests, ADR-0010) and never touches the network,
// the DOM of the page or storage. Format is detected from the content, not
// from the URL or the content-type: JSON Feed when the text starts with `{`,
// otherwise XML whose root is `rss` (RSS 2.0 and 0.9x), `feed` (Atom) or
// `rdf:RDF` (RSS 1.0).
//
// The output is RAW. `summaryHtml` and `contentHtml` are the publisher's HTML
// exactly as the Feed carried it, unsanitized. The caller MUST run it through
// the sanitizer (`sanitizeSummary` in src/extract.js) before storing or
// rendering it. Titles and authors are decoded to plain text.

/**
 * One entry of a Feed, normalized across formats.
 *
 * @typedef {object} Item
 * @property {string} id            The Feed's guid / id, else a stable hash of link and title.
 * @property {string} title         Plain text, entities decoded, tags stripped. Empty string when absent.
 * @property {string|null} link     Absolute URL of the Original, resolved against the Feed URL.
 * @property {string|null} publishedAt ISO 8601 timestamp, or null when the Feed gives no parseable date.
 * @property {string|null} summaryHtml RAW, unsanitized Summary HTML (`description`, `summary`, JSON `summary`).
 * @property {string|null} contentHtml RAW, unsanitized full content (`content:encoded`, Atom `content`, JSON `content_html`), or null when the Feed is Truncated.
 * @property {string|null} thumbnailUrl Absolute URL from `media:thumbnail`, `media:content`, an image `enclosure`, JSON `image`, or the first `<img>` in the content; else null.
 * @property {string|null} author   Plain text author name, or null.
 */

/**
 * A parsed Feed.
 *
 * @typedef {object} Feed
 * @property {string} title          Publication title, plain text. Falls back to the Feed URL's host.
 * @property {string|null} siteUrl   Absolute URL of the Publication's site. Falls back to the Feed URL's origin.
 * @property {string|null} description Plain text description / subtitle, or null.
 * @property {string|null} language  Language tag as declared by the Feed (`<language>`, `xml:lang`, JSON `language`), or null.
 * @property {"rss2"|"atom"|"rdf"|"json"} format Which syntax the Feed used.
 * @property {Item[]} items          Items in document order.
 */

/**
 * @typedef {"empty"|"unknown-format"|"unknown-root"|"malformed-xml"|"malformed-json"|"not-a-feed"} FeedParseReason
 */

/**
 * A `DOMParser` constructor: the browser global, or jsdom's in tests.
 * @typedef {new () => DOMParser} DomParserCtor
 */

/** Thrown when the text cannot be read as a Feed. `reason` says why. */
export class FeedParseError extends Error {
  /**
   * @param {FeedParseReason} reason
   * @param {string} [message]
   */
  constructor(reason, message) {
    super(message || `Could not parse feed: ${reason}`);
    this.name = "FeedParseError";
    /** @type {FeedParseReason} */
    this.reason = reason;
  }
}

/** Namespaces the extension prefixes conventionally map to. */
const NS = {
  atom: "http://www.w3.org/2005/Atom",
  content: "http://purl.org/rss/1.0/modules/content/",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  media: "http://search.yahoo.com/mrss/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rss1: "http://purl.org/rss/1.0/",
  itunes: "http://www.itunes.com/dtds/podcast-1.0.dtd",
  wfw: "http://wellformedweb.org/CommentAPI/",
  sy: "http://purl.org/rss/1.0/modules/syndication/",
  slash: "http://purl.org/rss/1.0/modules/slash/",
  georss: "http://www.georss.org/georss",
  xml: "http://www.w3.org/XML/1998/namespace",
};

const PARSERERROR_NS = "http://www.mozilla.org/newlayout/xml/parsererror.xml";

/**
 * Parse the text of a Feed into a normalized Feed with Items.
 *
 * Lenient by design: tolerates a BOM, leading whitespace, a missing XML prolog,
 * HTML entities in titles, RFC 822 and ISO dates, `dc:date`, Atom `updated`
 * when `published` is missing, relative links (resolved against `url`), and a
 * malformed document gets a second best-effort pass that strips control
 * characters, escapes bare `&` and declares undeclared namespace prefixes.
 *
 * The HTML fields of the result are RAW and unsanitized; sanitize before use.
 *
 * @param {string} text  The Feed document as text.
 * @param {{ url?: string, DOMParser: DomParserCtor }} options
 *   `url` is the address the Feed was fetched from, used to resolve relative
 *   links and as the fallback for `siteUrl`. `DOMParser` is the DOM parser
 *   implementation (browser global, or jsdom's in tests).
 * @returns {Feed}
 * @throws {FeedParseError} when the text is empty, not XML or JSON, XML with an
 *   unknown root element, malformed beyond repair, or JSON that is not a feed.
 */
export function parseFeed(text, { url, DOMParser }) {
  if (typeof DOMParser !== "function") {
    throw new TypeError("parseFeed needs a DOMParser implementation");
  }
  const base = validUrl(url);
  const src = stripLeading(String(text ?? ""));
  if (!src) throw new FeedParseError("empty", "Feed text is empty");

  if (src[0] === "{") return parseJsonFeed(src, base, DOMParser);
  if (src[0] !== "<") {
    throw new FeedParseError(
      "unknown-format",
      "Feed text is neither XML nor JSON",
    );
  }
  if (/^(?:<!doctype\s+html[\s>]|<html[\s>])/i.test(src)) {
    // A site's page pasted as a Feed URL. Say so before the XML parser
    // reports it as malformed (HTML rarely is well-formed XML).
    throw new FeedParseError(
      "unknown-root",
      "Document is an HTML page, not a feed",
    );
  }
  const doc = parseXmlLeniently(src, DOMParser);
  const root = doc.documentElement;
  const name = root.localName.toLowerCase();
  const ctx = { base, DOMParser };
  if (name === "rss") return parseRss2(root, ctx);
  if (name === "feed") return parseAtom(root, ctx);
  if (name === "rdf") return parseRdf(root, ctx);
  throw new FeedParseError(
    "unknown-root",
    `Unknown feed root element <${root.nodeName}>`,
  );
}

/**
 * Find Feed candidates advertised by a site's HTML.
 *
 * Reads `<link rel="alternate">` hints with RSS, Atom and JSON Feed types, in
 * document order, de-duplicated, with `href` resolved against `url`. When the
 * page advertises nothing, returns the conventional locations to probe,
 * relative to the site root and flagged `guess: true`.
 *
 * @param {string} html  The page's HTML.
 * @param {{ url?: string, DOMParser: DomParserCtor }} options
 *   `url` is the page address, used to resolve relative hrefs and to build the
 *   fallback guesses.
 * @returns {FeedCandidate[]}
 */
export function discoverFeeds(html, { url, DOMParser }) {
  if (typeof DOMParser !== "function") {
    throw new TypeError("discoverFeeds needs a DOMParser implementation");
  }
  const base = validUrl(url);
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const baseHref = doc.querySelector("base[href]")?.getAttribute("href");
  const resolveBase = (baseHref && resolveUrl(baseHref, base)) || base;

  /** @type {FeedCandidate[]} */
  const found = [];
  const seen = new Set();
  for (const link of doc.querySelectorAll("link[rel][href]")) {
    const rel = (link.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    if (!rel.includes("alternate")) continue;
    const href = link.getAttribute("href")?.trim();
    if (!href) continue;
    const type = feedTypeOf(link.getAttribute("type"), href);
    if (!type) continue;
    const abs = resolveUrl(href, resolveBase);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    const title = collapse(link.getAttribute("title") || "") || null;
    found.push({ url: abs, type, title, guess: false });
  }
  if (found.length) return found;

  const origin = base ? new URL(base).origin : "";
  return FALLBACK_PATHS.map(([path, type]) => ({
    url: origin ? origin + path : path,
    type,
    title: null,
    guess: true,
  }));
}

/**
 * A Feed location found in, or guessed from, a site's HTML.
 *
 * @typedef {object} FeedCandidate
 * @property {string} url          Absolute URL (or the bare path when no `url` was given).
 * @property {"rss"|"atom"|"json"} type Syntax hinted by the link's MIME type.
 * @property {string|null} title   The link's `title` attribute, or null.
 * @property {boolean} guess       True for the fallback probes returned when the page advertises nothing.
 */

/** @type {Array<[string, "rss"|"atom"|"json"]>} */
const FALLBACK_PATHS = [
  ["/feed", "rss"],
  ["/rss", "rss"],
  ["/feed.xml", "rss"],
  ["/atom.xml", "atom"],
  ["/index.xml", "rss"],
  ["/rss.xml", "rss"],
];

/**
 * Map a `<link type>` to a candidate type, or null when it is not a feed.
 * Generic `application/json` counts only when the href looks like a feed, so a
 * site's oEmbed or REST API links are not mistaken for JSON Feeds.
 * @param {string|null} mime
 * @param {string} href
 * @returns {"rss"|"atom"|"json"|null}
 */
function feedTypeOf(mime, href) {
  const t = (mime || "").toLowerCase().split(";")[0].trim();
  if (t === "application/rss+xml") return "rss";
  if (t === "application/atom+xml") return "atom";
  if (t === "application/feed+json") return "json";
  if (
    t === "application/rdf+xml" ||
    t === "text/xml" ||
    t === "application/xml"
  )
    return "rss";
  if (t === "application/json" && /feed|\.json(?:$|\?)/i.test(href))
    return "json";
  return null;
}

// ---------------------------------------------------------------------------
// XML parsing with a second, best-effort pass

/**
 * @param {string} src  Trimmed XML text.
 * @param {DomParserCtor} DOMParser
 * @returns {Document}
 */
function parseXmlLeniently(src, DOMParser) {
  const parser = new DOMParser();
  let doc = parser.parseFromString(src, "text/xml");
  if (!hasParserError(doc)) return doc;
  const repaired = repairXml(src);
  doc = parser.parseFromString(repaired, "text/xml");
  if (!hasParserError(doc)) return doc;
  throw new FeedParseError(
    "malformed-xml",
    `Malformed XML: ${collapse(parserErrorText(doc)).slice(0, 200)}`,
  );
}

/** @param {Document} doc */
function hasParserError(doc) {
  if (!doc.documentElement) return true;
  if (doc.documentElement.localName === "parsererror") return true;
  if (doc.getElementsByTagNameNS(PARSERERROR_NS, "parsererror").length)
    return true;
  // Chrome nests <parsererror> in the html namespace inside the root.
  const nested = doc.getElementsByTagName("parsererror");
  return nested.length > 0;
}

/** @param {Document} doc */
function parserErrorText(doc) {
  const el =
    doc.getElementsByTagNameNS(PARSERERROR_NS, "parsererror")[0] ||
    doc.getElementsByTagName("parsererror")[0] ||
    doc.documentElement;
  return el?.textContent || "unknown error";
}

/**
 * Best-effort repair of the defects real feeds most often carry: C0 control
 * characters, bare `&` that is not an entity, and namespace prefixes used
 * without a declaration (an error for a namespace-aware parser).
 * @param {string} src
 */
function repairXml(src) {
  let out = stripControlCharacters(src);
  out = out.replace(
    /&(?!(?:[A-Za-z][A-Za-z0-9._-]*|#[0-9]+|#x[0-9A-Fa-f]+);)/g,
    "&amp;",
  );
  out = declareMissingPrefixes(out);
  return out;
}

/**
 * Remove the characters XML 1.0 forbids: C0 controls other than tab, LF and
 * CR, plus the U+FFFE / U+FFFF non-characters.
 * @param {string} s
 */
function stripControlCharacters(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const forbidden =
      (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) ||
      c === 0xfffe ||
      c === 0xffff;
    if (!forbidden) out += s[i];
  }
  return out;
}

/** @param {string} xml */
function declareMissingPrefixes(xml) {
  const used = new Set();
  for (const m of xml.matchAll(/<([A-Za-z_][\w.-]*):[A-Za-z_]/g))
    used.add(m[1]);
  used.delete("xml");
  const missing = [...used].filter(
    (p) => !new RegExp(`xmlns:${p}\\s*=`).test(xml),
  );
  if (!missing.length) return xml;
  const decls = missing
    .map((p) => ` xmlns:${p}="${NS[p] || `urn:x-prefix:${p}`}"`)
    .join("");
  // Insert on the root start tag: the first tag that is not a prolog, comment,
  // doctype or processing instruction.
  return xml.replace(/<(?![?!])([^\s/>]+)/, `<$1${decls}`);
}

// ---------------------------------------------------------------------------
// RSS 2.0

/**
 * @param {Element} root
 * @param {{ base: string|null, DOMParser: DomParserCtor }} ctx
 * @returns {Feed}
 */
function parseRss2(root, ctx) {
  const channel = child(root, "channel") || root;
  const siteUrl =
    resolveUrl(text(child(channel, "link")), ctx.base) ||
    atomAlternateHref(channel, ctx.base) ||
    originOf(ctx.base);
  const items = [];
  const seen = new Set();
  for (const el of descendants(root, "item")) {
    const item = rssItem(el, ctx, siteUrl || ctx.base, items.length);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return {
    title: plainText(text(child(channel, "title")), ctx) || hostOf(ctx.base),
    siteUrl,
    description: plainText(text(child(channel, "description")), ctx) || null,
    language:
      collapse(text(child(channel, "language"))) ||
      collapse(text(child(channel, "dc:language"))) ||
      root.getAttributeNS(NS.xml, "lang") ||
      null,
    format: "rss2",
    items,
  };
}

/**
 * One RSS 2.0 or RSS 1.0 `<item>`.
 * @param {Element} el
 * @param {{ base: string|null, DOMParser: DomParserCtor }} ctx
 * @param {string|null} linkBase
 * @param {number} index
 * @returns {Item}
 */
function rssItem(el, ctx, linkBase, index) {
  const guidEl = child(el, "guid");
  const guid = collapse(text(guidEl));
  const guidIsLink =
    guidEl &&
    guidEl.getAttribute("isPermaLink") !== "false" &&
    /^https?:\/\//i.test(guid);
  const link =
    resolveUrl(text(child(el, "link")), linkBase) ||
    atomAlternateHref(el, linkBase) ||
    (guidIsLink ? guid : null) ||
    resolveUrl(el.getAttributeNS(NS.rdf, "about"), linkBase) ||
    null;
  const title = plainText(text(child(el, "title")), ctx);
  const summaryHtml = rawHtml(text(child(el, "description")));
  const contentHtml = rawHtml(text(child(el, "content:encoded")));
  const publishedAt =
    parseDate(text(child(el, "pubDate"))) ||
    parseDate(text(child(el, "dc:date"))) ||
    parseDate(text(child(el, "atom:published"))) ||
    parseDate(text(child(el, "atom:updated"))) ||
    parseDate(text(child(el, "dcterms:issued"))) ||
    parseDate(text(child(el, "dcterms:created"))) ||
    parseDate(text(child(el, "dcterms:modified"))) ||
    null;
  const author =
    personName(text(child(el, "dc:creator")), ctx) ||
    personName(text(child(el, "author")), ctx) ||
    personName(text(child(el, "itunes:author")), ctx) ||
    null;
  const thumbnailUrl =
    mediaThumbnail(el, link || linkBase) ||
    firstImageSrc(contentHtml || summaryHtml, link || linkBase);
  return {
    id:
      guid ||
      text(child(el, "atom:id")).trim() ||
      stableId(link, title, summaryHtml || contentHtml, index),
    title,
    link,
    publishedAt,
    summaryHtml,
    contentHtml,
    thumbnailUrl,
    author,
  };
}

// ---------------------------------------------------------------------------
// Atom

/**
 * @param {Element} root
 * @param {{ base: string|null, DOMParser: DomParserCtor }} ctx
 * @returns {Feed}
 */
function parseAtom(root, ctx) {
  const feedBase =
    resolveUrl(root.getAttributeNS(NS.xml, "base"), ctx.base) || ctx.base;
  const siteUrl = atomAlternateHref(root, feedBase) || originOf(ctx.base);
  const feedAuthor = personName(
    text(child(child(root, "author"), "name")),
    ctx,
  );
  const items = [];
  const seen = new Set();
  for (const el of descendants(root, "entry")) {
    const item = atomEntry(
      el,
      ctx,
      siteUrl || feedBase,
      feedAuthor,
      items.length,
    );
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return {
    title: atomText(child(root, "title"), ctx) || hostOf(ctx.base),
    siteUrl,
    description:
      atomText(child(root, "subtitle"), ctx) ||
      atomText(child(root, "tagline"), ctx) ||
      null,
    language:
      root.getAttributeNS(NS.xml, "lang") ||
      collapse(text(child(root, "dc:language"))) ||
      null,
    format: "atom",
    items,
  };
}

/**
 * @param {Element} el
 * @param {{ base: string|null, DOMParser: DomParserCtor }} ctx
 * @param {string|null} linkBase
 * @param {string|null} feedAuthor
 * @param {number} index
 * @returns {Item}
 */
function atomEntry(el, ctx, linkBase, feedAuthor, index) {
  const entryBase =
    resolveUrl(el.getAttributeNS(NS.xml, "base"), linkBase) || linkBase;
  const link = atomAlternateHref(el, entryBase);
  const title = atomText(child(el, "title"), ctx);
  const summaryHtml = atomHtml(child(el, "summary"));
  const contentHtml = atomHtml(child(el, "content"));
  const publishedAt =
    parseDate(text(child(el, "published"))) ||
    parseDate(text(child(el, "issued"))) ||
    parseDate(text(child(el, "updated"))) ||
    parseDate(text(child(el, "modified"))) ||
    parseDate(text(child(el, "dc:date"))) ||
    null;
  const author =
    personName(text(child(child(el, "author"), "name")), ctx) ||
    personName(text(child(el, "dc:creator")), ctx) ||
    feedAuthor ||
    null;
  const thumbnailUrl =
    mediaThumbnail(el, link || entryBase) ||
    atomEnclosureImage(el, link || entryBase) ||
    firstImageSrc(contentHtml || summaryHtml, link || entryBase);
  return {
    id:
      text(child(el, "id")).trim() ||
      stableId(link, title, summaryHtml || contentHtml, index),
    title,
    link,
    publishedAt,
    summaryHtml,
    contentHtml,
    thumbnailUrl,
    author,
  };
}

/**
 * Text of an Atom text construct (`type` text, html or xhtml) as plain text.
 * @param {Element|null} el
 * @param {{ DOMParser: DomParserCtor }} ctx
 */
function atomText(el, ctx) {
  if (!el) return "";
  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (type === "xhtml") return collapse(el.textContent || "");
  return plainText(el.textContent || "", ctx);
}

/**
 * Raw HTML of an Atom text construct, or null when absent or empty.
 * `type="text"` is escaped so it stays valid as HTML; `xhtml` is serialized.
 * @param {Element|null} el
 */
function atomHtml(el) {
  if (!el) return null;
  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (type === "xhtml") {
    const div = [...el.children].find((c) => c.localName === "div") || el;
    const inner = div.innerHTML?.trim();
    return inner || null;
  }
  const raw = el.textContent || "";
  if (type === "html" || type === "text/html") return rawHtml(raw);
  if (el.getAttribute("src") && !raw.trim()) return null;
  return rawHtml(escapeHtml(raw));
}

/**
 * The `href` of the best `<link rel="alternate">` (or an unqualified `<link>`)
 * among an element's children, resolved.
 * @param {Element|null} el
 * @param {string|null} base
 */
function atomAlternateHref(el, base) {
  if (!el) return null;
  const links = [...children(el, "link"), ...children(el, "atom:link")].filter(
    (l) => l.hasAttribute("href"),
  );
  if (!links.length) return null;
  const rel = (l) => (l.getAttribute("rel") || "alternate").toLowerCase();
  const isHtml = (l) =>
    /^text\/html\b/i.test(l.getAttribute("type") || "text/html");
  const pick =
    links.find((l) => rel(l) === "alternate" && isHtml(l)) ||
    links.find((l) => rel(l) === "alternate") ||
    null;
  return pick ? resolveUrl(pick.getAttribute("href"), base) : null;
}

/**
 * @param {Element} el
 * @param {string|null} base
 */
function atomEnclosureImage(el, base) {
  for (const l of children(el, "link")) {
    if ((l.getAttribute("rel") || "").toLowerCase() !== "enclosure") continue;
    if (!/^image\//i.test(l.getAttribute("type") || "")) continue;
    const u = resolveUrl(l.getAttribute("href"), base);
    if (u) return u;
  }
  return null;
}

// ---------------------------------------------------------------------------
// RSS 1.0 / RDF

/**
 * @param {Element} root
 * @param {{ base: string|null, DOMParser: DomParserCtor }} ctx
 * @returns {Feed}
 */
function parseRdf(root, ctx) {
  const channel = child(root, "channel");
  const siteUrl =
    resolveUrl(text(child(channel, "link")), ctx.base) || originOf(ctx.base);
  const items = [];
  const seen = new Set();
  for (const el of descendants(root, "item")) {
    const item = rssItem(el, ctx, siteUrl || ctx.base, items.length);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return {
    title: plainText(text(child(channel, "title")), ctx) || hostOf(ctx.base),
    siteUrl,
    description: plainText(text(child(channel, "description")), ctx) || null,
    language:
      collapse(text(child(channel, "dc:language"))) ||
      collapse(text(child(channel, "language"))) ||
      root.getAttributeNS(NS.xml, "lang") ||
      null,
    format: "rdf",
    items,
  };
}

// ---------------------------------------------------------------------------
// JSON Feed

/**
 * @param {string} src
 * @param {string|null} base
 * @param {DomParserCtor} DOMParser
 * @returns {Feed}
 */
function parseJsonFeed(src, base, DOMParser) {
  let data;
  try {
    data = JSON.parse(src);
  } catch (err) {
    throw new FeedParseError(
      "malformed-json",
      `Malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const looksLikeFeed =
    data &&
    typeof data === "object" &&
    (Array.isArray(data.items) ||
      (typeof data.version === "string" &&
        data.version.includes("jsonfeed.org")));
  if (!looksLikeFeed) {
    throw new FeedParseError("not-a-feed", "JSON document is not a JSON Feed");
  }
  const ctx = { base, DOMParser };
  const siteUrl = resolveUrl(str(data.home_page_url), base) || originOf(base);
  const feedAuthor = jsonAuthor(data, ctx);
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = [];
  const seen = new Set();
  rawItems.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const item = jsonItem(raw, ctx, siteUrl || base, feedAuthor, index);
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  });
  return {
    title: plainText(str(data.title), ctx) || hostOf(base),
    siteUrl,
    description: plainText(str(data.description), ctx) || null,
    language: collapse(str(data.language)) || null,
    format: "json",
    items,
  };
}

/**
 * @param {Record<string, any>} raw
 * @param {{ base: string|null, DOMParser: DomParserCtor }} ctx
 * @param {string|null} linkBase
 * @param {string|null} feedAuthor
 * @param {number} index
 * @returns {Item}
 */
function jsonItem(raw, ctx, linkBase, feedAuthor, index) {
  const link =
    resolveUrl(str(raw.url), linkBase) ||
    resolveUrl(str(raw.external_url), linkBase) ||
    null;
  const title = plainText(str(raw.title), ctx);
  const summaryHtml =
    raw.summary != null ? rawHtml(escapeHtml(str(raw.summary))) : null;
  let contentHtml = rawHtml(str(raw.content_html));
  if (!contentHtml && raw.content_text != null) {
    contentHtml = rawHtml(textToHtml(str(raw.content_text)));
  }
  const publishedAt =
    parseDate(str(raw.date_published)) ||
    parseDate(str(raw.date_modified)) ||
    null;
  const thumbnailUrl =
    resolveUrl(str(raw.image), link || linkBase) ||
    resolveUrl(str(raw.banner_image), link || linkBase) ||
    jsonImageAttachment(raw, link || linkBase) ||
    firstImageSrc(contentHtml || summaryHtml, link || linkBase);
  const id =
    raw.id != null && String(raw.id).trim()
      ? String(raw.id).trim()
      : stableId(link, title, summaryHtml || contentHtml, index);
  return {
    id,
    title,
    link,
    publishedAt,
    summaryHtml,
    contentHtml,
    thumbnailUrl,
    author: jsonAuthor(raw, ctx) || feedAuthor || null,
  };
}

/**
 * @param {Record<string, any>} obj
 * @param {{ DOMParser: DomParserCtor }} ctx
 */
function jsonAuthor(obj, ctx) {
  const a = Array.isArray(obj.authors) ? obj.authors[0] : obj.author;
  if (!a || typeof a !== "object") return null;
  return personName(str(a.name), ctx) || null;
}

/**
 * @param {Record<string, any>} raw
 * @param {string|null} base
 */
function jsonImageAttachment(raw, base) {
  if (!Array.isArray(raw.attachments)) return null;
  for (const a of raw.attachments) {
    if (a && /^image\//i.test(str(a.mime_type))) {
      const u = resolveUrl(str(a.url), base);
      if (u) return u;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Media / thumbnails

/**
 * Thumbnail from Media RSS: `media:thumbnail` first, then the best image among
 * `media:content` (largest declared width), then an image `enclosure`, then
 * `itunes:image`. Looks inside `media:group` too.
 * @param {Element} el
 * @param {string|null} base
 */
function mediaThumbnail(el, base) {
  const scopes = [el, ...children(el, "media:group")];
  for (const scope of scopes) {
    for (const t of children(scope, "media:thumbnail")) {
      const u = resolveUrl(t.getAttribute("url"), base);
      if (u) return u;
    }
  }
  /** @type {{ url: string, width: number }|null} */
  let best = null;
  for (const scope of scopes) {
    for (const c of children(scope, "media:content")) {
      const u = resolveUrl(c.getAttribute("url"), base);
      if (!u || !isImageMedia(c, u)) continue;
      const width = Number(c.getAttribute("width")) || 0;
      if (!best || width > best.width) best = { url: u, width };
      for (const t of children(c, "media:thumbnail")) {
        const tu = resolveUrl(t.getAttribute("url"), base);
        if (tu) return tu;
      }
    }
  }
  if (best) return best.url;
  for (const e of children(el, "enclosure")) {
    const u = resolveUrl(e.getAttribute("url"), base);
    if (
      u &&
      (/^image\//i.test(e.getAttribute("type") || "") || looksLikeImageUrl(u))
    )
      return u;
  }
  for (const i of children(el, "itunes:image")) {
    const u = resolveUrl(i.getAttribute("href") || i.getAttribute("url"), base);
    if (u) return u;
  }
  return null;
}

/**
 * @param {Element} c  A `media:content` element.
 * @param {string} url
 */
function isImageMedia(c, url) {
  const medium = (c.getAttribute("medium") || "").toLowerCase();
  const type = (c.getAttribute("type") || "").toLowerCase();
  if (medium) return medium === "image";
  if (type) return type.startsWith("image/");
  // Neither declared (the Guardian's case): accept unless the URL is clearly a
  // video or audio file.
  return !/\.(mp4|m4v|webm|mov|mp3|m4a|ogg|wav|aac)(?:$|\?)/i.test(url);
}

/** @param {string} url */
function looksLikeImageUrl(url) {
  return /\.(jpe?g|png|gif|webp|avif|svg)(?:$|\?)/i.test(url);
}

/**
 * The `src` of the first `<img>` in a raw HTML string, resolved.
 * @param {string|null} html
 * @param {string|null} base
 */
function firstImageSrc(html, base) {
  if (!html) return null;
  const m = html.match(
    /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
  );
  const src = m && (m[1] ?? m[2] ?? m[3]);
  if (!src) return null;
  const decoded = src
    .replace(/&amp;/g, "&")
    .replace(/&#0*38;/g, "&")
    .trim();
  if (/^data:/i.test(decoded)) return null;
  return resolveUrl(decoded, base);
}

// ---------------------------------------------------------------------------
// DOM helpers (namespace-lenient)

/**
 * Element children matching `name`. `name` is `local` or `prefix:local`; the
 * prefix matches either the element's own prefix or the namespace the prefix
 * conventionally maps to, so unusual prefixes and undeclared ones both work.
 * @param {Element|null} el
 * @param {string} name
 * @returns {Element[]}
 */
function children(el, name) {
  if (!el) return [];
  const [prefix, local] = splitName(name);
  const out = [];
  for (const c of el.children) {
    if (matches(c, prefix, local)) out.push(c);
  }
  return out;
}

/**
 * @param {Element|null} el
 * @param {string} name
 * @returns {Element|null}
 */
function child(el, name) {
  return children(el, name)[0] || null;
}

/**
 * All descendants matching `name` that are not nested inside another match.
 * @param {Element} root
 * @param {string} name
 * @returns {Element[]}
 */
function descendants(root, name) {
  const [prefix, local] = splitName(name);
  const out = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (matches(c, prefix, local)) out.push(c);
      else walk(c);
    }
  };
  walk(root);
  return out;
}

/** @param {string} name */
function splitName(name) {
  const i = name.indexOf(":");
  return i < 0 ? [null, name] : [name.slice(0, i), name.slice(i + 1)];
}

/**
 * @param {Element} c
 * @param {string|null} prefix
 * @param {string} local
 */
function matches(c, prefix, local) {
  if (c.localName !== local) return false;
  if (prefix === null) {
    // Unqualified names: accept no prefix, or the document's default namespace
    // element (Atom / RSS 1.0). Reject prefixed extension elements such as
    // <atom:link> next to <link>.
    return !c.prefix;
  }
  if (c.prefix === prefix) return true;
  const ns = NS[prefix];
  return Boolean(ns && c.namespaceURI === ns);
}

/** @param {Element|null} el */
function text(el) {
  return el ? el.textContent || "" : "";
}

// ---------------------------------------------------------------------------
// Text helpers

/**
 * Plain text from a string that may carry HTML markup and entities (feeds put
 * `&amp;#8217;` and even `<b>` in titles). Decoded with the HTML parser,
 * tags stripped, whitespace collapsed.
 * @param {string} s
 * @param {{ DOMParser: DomParserCtor }} ctx
 */
function plainText(s, ctx) {
  const t = collapse(s);
  if (!t) return "";
  if (!/[<&]/.test(t)) return t;
  try {
    const doc = new ctx.DOMParser().parseFromString(
      `<!doctype html><body>${t}`,
      "text/html",
    );
    return collapse(doc.body?.textContent || "");
  } catch {
    return t;
  }
}

/**
 * An RSS author is often `email (Name)` or `Name <email>`; keep the name.
 * @param {string} s
 * @param {{ DOMParser: DomParserCtor }} ctx
 */
function personName(s, ctx) {
  let t = plainText(s, ctx);
  if (!t) return null;
  const paren = t.match(/^\S+@\S+\s*\((.+)\)\s*$/);
  if (paren) t = paren[1].trim();
  else t = t.replace(/\s*<[^>]*@[^>]*>\s*$/, "").trim();
  return t || null;
}

/** Raw HTML: trimmed, or null when there is nothing but whitespace. @param {string} s */
function rawHtml(s) {
  const t = (s || "").trim();
  return t || null;
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text to paragraphs of escaped HTML. @param {string} s */
function textToHtml(s) {
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Collapse whitespace runs and trim. @param {string} s */
function collapse(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** Drop a BOM and leading whitespace. @param {string} s */
function stripLeading(s) {
  return s.replace(/^[\uFEFF\u200B\s]+/, "");
}

/** @param {unknown} v */
function str(v) {
  return v == null ? "" : String(v);
}

// ---------------------------------------------------------------------------
// Dates

/**
 * RFC 822 (`Mon, 07 Sep 2026 04:00:23 GMT`, `Mon, 7 Sep 2026 09:07:09 +0200`)
 * and ISO 8601 (`2026-09-07T04:00:23Z`) to an ISO string, or null.
 * @param {string} s
 * @returns {string|null}
 */
function parseDate(s) {
  let t = collapse(s);
  if (!t) return null;
  let ms = Date.parse(t);
  if (Number.isNaN(ms)) {
    // Common sloppiness: "UT", trailing timezone names, "YYYY-MM-DD HH:MM:SS",
    // a stray weekday, or a "+02:00" written as "+0200" after an ISO date.
    t = t
      .replace(/\bUT$/, "UTC")
      .replace(
        /\s+(?:[A-Z]{3,5}|[+-]\d{4})\s+[A-Z]{3,5}$/,
        (m) => ` ${m.trim().split(/\s+/)[0]}`,
      )
      .replace(/^([A-Za-z]{3,9}),?\s+(?=\d)/, "")
      .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, "$1T$2")
      .replace(
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})(\d{2})$/,
        "$1$2:$3",
      );
    ms = Date.parse(t);
  }
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// URLs and ids

/** @param {unknown} u  @returns {string|null} */
function validUrl(u) {
  if (typeof u !== "string" || !u.trim()) return null;
  try {
    return new URL(u.trim()).href;
  } catch {
    return null;
  }
}

/**
 * Resolve `href` against `base`; absolute when possible, the trimmed input
 * when there is no base, null when empty or unparseable.
 * @param {string|null|undefined} href
 * @param {string|null} base
 * @returns {string|null}
 */
function resolveUrl(href, base) {
  const h = (href || "").trim();
  if (!h) return null;
  try {
    return base ? new URL(h, base).href : new URL(h).href;
  } catch {
    return /^[a-z][a-z0-9+.-]*:/i.test(h) || !base ? h || null : null;
  }
}

/** @param {string|null} base */
function originOf(base) {
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/** @param {string|null} base */
function hostOf(base) {
  if (!base) return "";
  try {
    return new URL(base).hostname;
  } catch {
    return "";
  }
}

/**
 * Stable id for an Item without a guid: an FNV-1a hash over link and title,
 * falling back to the body and finally the position in the Feed.
 * @param {string|null} link
 * @param {string} title
 * @param {string|null} body
 * @param {number} index
 */
function stableId(link, title, body, index) {
  const key =
    link || title
      ? `${link || ""}\n${title || ""}`
      : body
        ? body.slice(0, 2000)
        : `#${index}`;
  return `h:${fnv1a(key)}`;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex digits. @param {string} s */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
