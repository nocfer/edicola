# 02 — Feed parsing: any real-world Feed becomes normalized Items

**What to build:** A pure module that turns the text of a Feed in RSS 2.0,
Atom, RSS 1.0/RDF or JSON Feed into a normalized Feed with Items, leniently,
plus feed autodiscovery from a site's HTML. Proven against a corpus of real
fixtures. No UI.

**Blocked by:** None — can start immediately.

**Status:** done

**Owns:** `src/feed.js`, `test/feed.test.js`, `test/discover.test.js`,
`test/fixtures/feeds/**`.

- [x] `parseFeed(text, { url, DOMParser })` returns `{ title, siteUrl, description, items }` where each Item is `{ id, title, link, publishedAt (ISO string or null), summaryHtml (raw, unsanitized), contentHtml (raw, from content:encoded / atom content / JSON content_html, or null), thumbnailUrl (from media:thumbnail, media:content, enclosure image, or first img in content, or null), author }`. `id` is the guid/id when present, else a stable hash of link+title.
- [x] Format detection by content, not by URL or content-type: JSON starts with `{`; XML root `rss`, `feed` (Atom), `rdf:RDF`. Unknown root throws a typed `FeedParseError` with a `reason`.
- [x] Lenient: tolerates a missing `<?xml?>` prolog, a leading BOM or whitespace, HTML entities in titles, `pubDate` in RFC 822 and ISO forms, `dc:date`, `updated` when `published` is missing, relative links resolved against `url`.
- [x] On a document the DOM parser reports as malformed (`parsererror`), a best-effort second pass strips control characters and unescaped `&` before giving up.
- [x] Output is documented as **raw**: the caller sanitizes (`sanitizeSummary` in ticket 03) before storing. Say so in JSDoc.
- [x] `discoverFeeds(html, { url, DOMParser })` returns candidate `{ url, type, title }` from `<link rel="alternate">` with RSS, Atom and JSON Feed types, absolute URLs, de-duplicated, in document order. If none are found, returns common fallbacks to probe: `/feed`, `/rss`, `/feed.xml`, `/atom.xml`, `/index.xml`, `/rss.xml` relative to the site root, flagged `guess: true`.
- [x] Fixtures, real and checked in: an RSS 2.0 feed with `content:encoded` (e.g. a WordPress blog), a Truncated RSS 2.0 feed from a newspaper, an Atom feed (e.g. a GitHub releases feed), an RSS 1.0/RDF feed, a JSON Feed, a feed with `media:thumbnail` or `media:content`, a feed with malformed XML (unescaped ampersand), an HTML page with alternate links for discovery, and an HTML page with none.
- [x] Tests use `DOMParser` from `tools/testing/dom.js` and assert on Items (count, first title, link, date, presence of content vs summary, thumbnail), never on parser internals.
- [x] Gates green (test, Biome, typecheck, check-imports).

## Notes

### Exported interface (`src/feed.js`, named exports only)

```js
export function parseFeed(text, { url, DOMParser }) // -> Feed, throws FeedParseError
export function discoverFeeds(html, { url, DOMParser }) // -> FeedCandidate[]
export class FeedParseError extends Error { name: "FeedParseError"; reason: FeedParseReason }
```

`DOMParser` is the constructor (browser global `DOMParser`, or the export from
`tools/testing/dom.js`). `url` is optional but should always be passed: it
resolves relative links and is the fallback for `siteUrl` / `title`. Both
functions throw a `TypeError` when `DOMParser` is missing.

### Shapes

```ts
type Feed = {
  title: string;              // plain text; falls back to the Feed URL's hostname
  siteUrl: string | null;     // absolute; falls back to the Feed URL's origin
  description: string | null; // plain text
  language: string | null;    // as declared: <language>, xml:lang, JSON `language` (extra, for ticket 08's country/language guess)
  format: "rss2" | "atom" | "rdf" | "json"; // extra
  items: Item[];              // document order, de-duplicated by id
};

type Item = {
  id: string;                 // guid / atom id / JSON id when present, else "h:" + 8-hex FNV-1a of link+title
  title: string;              // plain text, entities decoded, tags stripped; "" when absent
  link: string | null;        // absolute
  publishedAt: string | null; // ISO 8601 (Date#toISOString) or null
  summaryHtml: string | null; // RAW, unsanitized
  contentHtml: string | null; // RAW, unsanitized; null on a Truncated Feed
  thumbnailUrl: string | null;// absolute
  author: string | null;      // plain text name
};

type FeedCandidate = {
  url: string;                // absolute (bare path only when no `url` was given)
  type: "rss" | "atom" | "json";
  title: string | null;
  guess: boolean;             // true for the six fallback probes
};

type FeedParseReason =
  | "empty"            // nothing but whitespace/BOM
  | "unknown-format"   // neither `<` nor `{`
  | "unknown-root"     // XML root is not rss/feed/rdf:RDF, or the text is an HTML page
  | "malformed-xml"    // still a parsererror after the repair pass
  | "malformed-json"   // JSON.parse failed
  | "not-a-feed";      // JSON with no `items` array and no jsonfeed.org `version`
```

### Decisions the spec left open

- **Ids are per Feed, not global.** A guid such as `rep-locali:repubblica:425569591`
  or a hash `h:1a2b3c4d` can collide across Publications. Ticket 07 should key
  `items` by `publicationId + id` (or prefix the id) when storing.
- **`summaryHtml` and `contentHtml` are both raw.** JSON Feed `summary` and
  `content_text` are plain text in the spec, so they are HTML-escaped (and
  `content_text` is wrapped in `<p>`) to keep the field consistently HTML.
  Atom `type="text"` is escaped likewise; `type="xhtml"` is serialized with
  `innerHTML` (serializers may add an `xmlns` on the first element).
- **Thumbnail order:** `media:thumbnail` → widest image `media:content`
  (also inside `media:group`) → image `enclosure` → `itunes:image` → JSON
  `image` / `banner_image` / image attachment → first `<img src>` in content or
  Summary. `data:` URIs are ignored. The Guardian's `media:content` has no
  `type`/`medium`, so undeclared media counts as an image unless the URL has a
  video/audio extension.
- **Author:** `dc:creator` → `author` → `itunes:author`; Atom `author/name`
  then the feed-level author; JSON `authors[0].name` → `author.name` → feed
  authors. RSS `email (Name)` and `Name <email>` reduce to the name. Empty
  elements (`<dc:creator/>`) yield null.
- **Dates:** `Date.parse` first, then repairs for `UT`, a trailing timezone
  name after a numeric offset, `YYYY-MM-DD HH:MM:SS`, and `+0200` after an ISO
  time. RSS order: `pubDate` → `dc:date` → `atom:published` → `atom:updated` →
  `dcterms:issued/created/modified`. Atom: `published` → `issued` → `updated` →
  `modified` → `dc:date`. Unparseable dates are null, never a guess.
- **Repair pass** (only after a first `parsererror`): strips C0 controls other
  than tab/LF/CR and U+FFFE/U+FFFF, turns bare `&` into `&amp;`, and declares
  namespace prefixes used without an `xmlns:` (common: `content:encoded` with
  no declaration, which a namespace-aware parser rejects).
- **Element matching is namespace-lenient:** extension elements match by
  conventional prefix or by the prefix's well-known namespace URI, so an
  unusual prefix bound to the right URI, or the usual prefix left undeclared,
  both work. Unprefixed names (`link`, `title`) never match prefixed ones, so
  `<atom:link rel="self">` is not mistaken for the channel `<link>`.
- **Discovery MIME types:** `application/rss+xml` → rss, `application/atom+xml`
  → atom, `application/feed+json` → json; `application/rdf+xml`, `text/xml`,
  `application/xml` → rss (parseFeed sniffs the real format anyway);
  `application/json` only when the href looks like a feed (`feed` or `.json`),
  so WordPress's REST API and oEmbed links are ignored. `<base href>` is
  honoured. Fallback guesses are built on the origin of `url`.
- **HTML pasted as a Feed** (starts with `<!doctype html` or `<html`) throws
  `unknown-root` up front rather than `malformed-xml`, so ticket 08 can route
  straight to `discoverFeeds`.
- **`xml:base`** is honoured on the Atom root and entries only.

### Fixtures (`test/fixtures/feeds/`, ~119 KB total)

All fetched with `curl` on 2026-09-07 and trimmed to 2–4 items with the
document head and tail intact; the WordPress and GitHub ones keep the three
shortest items to stay small. Two are **derived**: the malformed ones start from
the real BBC and Repubblica documents with the defect introduced, and say so in
a comment at the top. Il Post's feed returned a 403 block page and was dropped.

| File | Exercises |
| --- | --- |
| `rss2-content-encoded-wordpress-news.xml` | content:encoded + description, dc:creator in CDATA, guid isPermaLink=false |
| `rss2-truncated-media-content-guardian.xml` | Truncated newspaper, `media:content` in three widths, dc:creator, dc:date |
| `rss2-media-thumbnail-bbc-news.xml` | `media:thumbnail`, CDATA titles, `&amp;` in links |
| `rss2-no-prolog-truncated-repubblica.xml` | no `<?xml?>` prolog (as served), `author` as `email (Name)`, non-URL guid |
| `rss2-empty-channel-link-ansa.xml` | empty channel `<link>`, single-digit day with `+0200` |
| `rss2-inline-img-description-corriere.xml` | thumbnail only as `<img>` in description, empty `<dc:creator/>` |
| `atom-github-releases-nodejs.xml` | Atom, `updated` only, `content type="html"`, `media:thumbnail`, xml:lang |
| `rdf-rss10-slashdot.xml` | RSS 1.0/RDF, items outside channel, dc:date, dc:creator, no guid |
| `jsonfeed-v1-jsonfeed-org.json` | JSON Feed 1, content_html, `-05:00` dates |
| `jsonfeed-v1.1-daring-fireball.json` | JSON Feed 1.1, `authors`, `external_url` vs `url` |
| `rss2-malformed-unescaped-ampersand-bbc-news.xml` | derived: bare `&` in `<link>`/`<guid>` |
| `rss2-malformed-control-characters-repubblica.xml` | derived: U+000B/U+000C/U+001F in a description |
| `html-alternate-links-wordpress-news.html` | three RSS alternates plus oEmbed/REST/markdown alternates to ignore |
| `html-alternate-links-unquoted-smashing-magazine.html` | minified HTML, unquoted attribute values |
| `html-no-alternate-links-example-com.html` | no hints → fallback guesses |

`test/fixtures/README.md` is not owned by this ticket and was not edited; the
integrator may want to point it at this table.

### For ticket 13 (`tools/check-catalog.mjs --fetch`)

`parseFeed(text, { url, DOMParser })` with `DOMParser` from
`tools/testing/dom.js` is all that is needed; a Feed that returns 200 but is
not a feed throws `FeedParseError` (check `.reason`), and one that parses but
carries nothing has `items.length === 0`.
