# 02 — Feed parsing: any real-world Feed becomes normalized Items

**What to build:** A pure module that turns the text of a Feed in RSS 2.0,
Atom, RSS 1.0/RDF or JSON Feed into a normalized Feed with Items, leniently,
plus feed autodiscovery from a site's HTML. Proven against a corpus of real
fixtures. No UI.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Owns:** `src/feed.js`, `test/feed.test.js`, `test/discover.test.js`,
`test/fixtures/feeds/**`.

- [ ] `parseFeed(text, { url, DOMParser })` returns `{ title, siteUrl, description, items }` where each Item is `{ id, title, link, publishedAt (ISO string or null), summaryHtml (raw, unsanitized), contentHtml (raw, from content:encoded / atom content / JSON content_html, or null), thumbnailUrl (from media:thumbnail, media:content, enclosure image, or first img in content, or null), author }`. `id` is the guid/id when present, else a stable hash of link+title.
- [ ] Format detection by content, not by URL or content-type: JSON starts with `{`; XML root `rss`, `feed` (Atom), `rdf:RDF`. Unknown root throws a typed `FeedParseError` with a `reason`.
- [ ] Lenient: tolerates a missing `<?xml?>` prolog, a leading BOM or whitespace, HTML entities in titles, `pubDate` in RFC 822 and ISO forms, `dc:date`, `updated` when `published` is missing, relative links resolved against `url`.
- [ ] On a document the DOM parser reports as malformed (`parsererror`), a best-effort second pass strips control characters and unescaped `&` before giving up.
- [ ] Output is documented as **raw**: the caller sanitizes (`sanitizeSummary` in ticket 03) before storing. Say so in JSDoc.
- [ ] `discoverFeeds(html, { url, DOMParser })` returns candidate `{ url, type, title }` from `<link rel="alternate">` with RSS, Atom and JSON Feed types, absolute URLs, de-duplicated, in document order. If none are found, returns common fallbacks to probe: `/feed`, `/rss`, `/feed.xml`, `/atom.xml`, `/index.xml`, `/rss.xml` relative to the site root, flagged `guess: true`.
- [ ] Fixtures, real and checked in: an RSS 2.0 feed with `content:encoded` (e.g. a WordPress blog), a Truncated RSS 2.0 feed from a newspaper, an Atom feed (e.g. a GitHub releases feed), an RSS 1.0/RDF feed, a JSON Feed, a feed with `media:thumbnail` or `media:content`, a feed with malformed XML (unescaped ampersand), an HTML page with alternate links for discovery, and an HTML page with none.
- [ ] Tests use `DOMParser` from `tools/testing/dom.js` and assert on Items (count, first title, link, date, presence of content vs summary, thumbnail), never on parser internals.
- [ ] Gates green (test, Biome, typecheck, check-imports).
