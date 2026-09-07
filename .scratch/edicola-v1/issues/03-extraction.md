# 03 — Extraction: an Original becomes a clean, sanitized Article or stays Summary-only

**What to build:** A pure module that turns the HTML of an Original into an
Article using Readability and DOMPurify passed in as parameters, collects its
image URLs, and decides whether the result is good enough or the Item must stay
Summary-only. Plus the tiny browser choke point that binds the CDN libraries.
No UI.

**Blocked by:** None — can start immediately.

**Status:** done

**Owns:** `src/extract-core.js`, `src/extract.js`, `test/extract.test.js`,
`test/fixtures/articles/**`.

- [x] `extractArticle(html, { url, windowFor, Readability, purify })` returns `{ ok, title, byline, excerpt, html, wordCount, imageUrls, reason }`. `ok` is true when `wordCount >= MIN_ARTICLE_WORDS` (exported constant, 200). When Readability returns null or the count is under the threshold, `ok` is false and `reason` is `"no-content"` or `"too-short"` and `html` is still returned if any.
- [x] Before Readability: resolve every `href`/`src`/`srcset` to absolute against `url`; promote lazy-load attributes (`data-src`, `data-lazy-src`, `data-original`, first `srcset` candidate) into `src` so images survive extraction.
- [x] After Readability: sanitize with DOMPurify using an explicit allowlist: text and structural tags, `a`, `img`, `figure`, `figcaption`, `blockquote`, `pre`, `code`, `table` family, `video`/`audio` **not** allowed, no `iframe`, `form`, `input`, `style`, `script`, `svg`. Strip `class`, `id`, `style`, and all `on*`. Force `rel="noopener"` and `target="_blank"` on links. Keep `alt`, `width`, `height`, `loading`.
- [x] `imageUrls` is the ordered, de-duplicated list of `img src` values in the sanitized output (absolute https/http only; data: URIs are dropped from the list but kept inline only if under 32 KB, else removed).
- [x] Document the contract for image storage: the Reader will later replace each `src` with a stored blob URL; the module exports `rewriteImageSources(html, mapFn, { windowFor })` that applies a URL→URL map so ticket 10 does not re-implement it.
- [x] `sanitizeSummary(html, purify)` for Feed Summaries: text-level tags only (`p`, `br`, `em`, `strong`, `a`, `ul`, `ol`, `li`), everything else stripped, returned as a string. Also `toPlainText(html, windowFor)` for one-line excerpts.
- [x] `src/extract.js` is the browser choke point: imports `@mozilla/readability` and `dompurify` from esm.sh pinned to the exact versions in `tools/ensure-test-deps.mjs`, and exports `extractArticleInBrowser(html, url)` and `sanitizeSummaryInBrowser(html)` that bind `window`/`DOMParser` and call the pure functions. Not tested in Node; keep it under 40 lines.
- [x] Fixtures, real and checked in: a well-formed news article that extracts to a long Article; a page whose anonymous response contains only a teaser (so `ok` is false, `too-short`); a page with no article body (a category index) yielding `no-content`; an article with relative image URLs, `srcset`, and a lazy-loaded image; an article with an inline `<script>`, `onclick`, and a `javascript:` link that must all be gone after sanitizing.
- [x] Tests use `windowFor`, `Readability`, `purifierFor` from `tools/testing/dom.js` and assert on `ok`, `reason`, word count bounds, image URL lists, and absence of dangerous markup. No assertions on Readability internals.
- [x] Gates green.

## Notes

### Exported interfaces

`src/extract-core.js` (pure, Node-testable):

```js
export const MIN_ARTICLE_WORDS = 200;
export const MAX_INLINE_DATA_IMAGE_CHARS = 32 * 1024;
export const MAX_LINK_DENSITY = 0.5;
export const ARTICLE_PURIFY_CONFIG; // frozen DOMPurify config for Articles
export const SUMMARY_PURIFY_CONFIG; // frozen DOMPurify config for Summaries
export function extractArticle(html, { url, windowFor, Readability, purify }) // -> Article
export function rewriteImageSources(html, mapFn, { windowFor })              // -> string
export function sanitizeSummary(html, purify)                                // -> string
export function toPlainText(html, windowFor)                                 // -> string
export function countWordsInHtml(html, windowFor)                            // -> number
```

`windowFor(html, url?)` must return `{ document }` for a fresh, inert DOM;
`Readability` is the constructor; `purify` is a DOMPurify instance bound to a
window (`purifierFor(windowFor())` in tests).

`src/extract.js` (browser choke point, 36 lines, not tested in Node):

```js
export function windowFor(html, url?)             // DOMParser document with <base href=url>
export function extractArticleInBrowser(html, url) // -> Article
export function sanitizeSummaryInBrowser(html)     // -> string
```

Ticket 10 calls `rewriteImageSources(html, mapFn, { windowFor })` importing
`rewriteImageSources` from `src/extract-core.js` and `windowFor` from
`src/extract.js`. `mapFn(url)` returns the replacement (a blob URL) or
null/undefined to leave that image alone. The function does not re-sanitize
(so `blob:` URLs survive); feed it only stored, sanitized Article HTML.

### Article result shape

```js
{
  ok: boolean,                 // wordCount >= 200 and reason === null
  title: string,               // Readability title, else document.title, else ""
  byline: string | null,
  excerpt: string,             // plain text, whitespace-collapsed
  html: string,                // sanitized; "" only when Readability returned null
  wordCount: number,           // words in the sanitized HTML
  imageUrls: string[],         // ordered, de-duplicated absolute http(s) img src values
  reason: "no-content" | "too-short" | null
}
```

`reason` is `"no-content"` when Readability returns null, when the sanitized
text is empty, **or when more than half of the text sits inside links**
(`MAX_LINK_DENSITY`). The last rule is a decision the ticket left open: no real
category index makes Readability return null (it always finds the largest
text block, headlines included), so without it the Il Sole 24 Ore category
index fixture would extract as a 238-word "Article" of headlines. The 0.5
cutoff mirrors Readability's own link-density cleaning. `"too-short"` is prose
under 200 words (the Times teaser is 23 words). `html` is returned in both
not-ok cases so the Reader can still show it if it wants to.

### Pipeline and DOMPurify config

Before Readability, on the injected document: `data-src`, `data-lazy-src`,
`data-original` are promoted into `src` (unconditionally when present, since
`src` is then a placeholder); `data-srcset`/`data-lazy-srcset` into `srcset`;
an `img` with an empty or `data:` `src` gets the first `srcset` candidate.
Every `href`, `src` and `srcset` is resolved against `url` with `new URL`, so
the browser choke point does not depend on `document.baseURI`. In-page
`#anchor` hrefs are left relative through Readability (absolutizing them
makes Readability drop tables of contents as link lists) and resolved against
the Original after sanitizing.

After Readability, `purify.sanitize(content, { ...ARTICLE_PURIFY_CONFIG,
RETURN_DOM: true })`:

- `ALLOWED_TAGS`: p, br, hr, h1-h6, div, section, span, ul, ol, li, dl, dt,
  dd, em, strong, b, i, u, s, sub, sup, small, mark, abbr, cite, q, time, kbd,
  samp, var, del, ins, wbr, a, img, figure, figcaption, blockquote, pre, code,
  table, caption, colgroup, col, thead, tbody, tfoot, tr, th, td. Nothing else
  (no video/audio/iframe/form/input/button/style/script/svg/object/embed).
- `ALLOWED_ATTR`: href, src, alt, width, height, loading, title, colspan,
  rowspan, datetime, lang, dir. `ALLOW_DATA_ATTR: false`, `ALLOW_ARIA_ATTR:
  false`, `KEEP_CONTENT: true`. So class, id, style, every `on*`, `srcset` and
  `sizes` are gone. `srcset` is dropped on purpose: after ticket 10 rewrites
  `src` to a blob URL, a surviving `srcset` would make the browser fetch from
  the network instead.
- Post-pass on the returned DOM: every `a[href]` gets `target="_blank"
  rel="noopener"`; `img` with an http(s) `src` is listed in `imageUrls`;
  `data:image/*` under 32 KB stays inline and off the list; any other `img`
  (oversized data URI, no src, other scheme) is removed.

`sanitizeSummary` uses `SUMMARY_PURIFY_CONFIG` (p, br, em, strong, a, ul, ol,
li; only `href`) and the same link hardening. `toPlainText` turns block
boundaries into spaces, collapses whitespace and skips script/style/noscript/
template text.

### Fixtures (`test/fixtures/articles/`)

All fetched 2026-09-07 with plain anonymous `curl`; each file starts with a
comment stating source URL, what was trimmed and what was augmented. Trimming
removed scripts (JSON-LD kept, Readability reads it for title/byline), style
blocks, inline SVG, stylesheet/preload links and comments.

- `bbc-news-long-article.html` — BBC News article, 881 words, 4 images, ok.
- `thetimes-paywall-teaser.html` — The Times, hard paywall; anonymous response
  carries the standfirst only (23 words), too-short. FT returned 403, WSJ 403
  and the Telegraph 402 to curl, so the Times stands in for them.
- `ilsole24ore-category-index.html` — Il Sole 24 Ore "Italia" section index,
  no-content via the link-density rule.
- `wpbeginner-lazy-relative-images.html` — WordPress article using the
  perfmatters lazy loader (SVG `data:` placeholder in `src`, real URL in
  `data-src`, candidates in `data-srcset`) plus regular `srcset`. **Augmented:**
  inside `.entry-content` the absolute prefix
  `https://www.wpbeginner.com/wp-content/uploads/` was replaced with
  `/wp-content/uploads/` so the fixture exercises relative image URLs (no real
  page I found puts relative image URLs inside the article body). The comment
  thread and cookie-consent root were removed for size.
- `ilpost-article-with-injected-markup.html` — Il Post article. **Augmented:**
  a block with an inline `<script>`, `onclick`/`onmouseover`/`class`/`id`/
  `style`, `href="javascript:"`, `<img onerror>`, `<iframe>`, `<form>`,
  `<style>`, `<svg onload>`, `<video>`/`<audio>` was inserted at the top of the
  body; tests assert all of it is gone and the surrounding prose survives.

### For the integrator

- Add `src/extract.js` and `src/extract-core.js` to the `SHELL` array in
  `sw.js`, then `npm run stamp`.
- **`src/extract.js` needs a window with `DOMParser` and cannot run in a Web
  Worker** (no DOM there; DOMPurify would also report `isSupported === false`).
  Ticket 07 plans to import it from `src/sync-worker.js`; Extraction has to be
  done on the page (for example the worker posts the fetched HTML back and the
  page runs `extractArticleInBrowser`), or the worker design has to change.
- DOMPurify's ESM build has only a default export, so the choke point uses
  `import { default as createDOMPurify } from ".../dompurify@3.2.6"` and binds
  it to `window`. `tools/check-imports.mjs` ignores CDN specifiers, so this is
  fine for the import check.
- The two CDN imports carry `// @ts-expect-error` because `checkJs` cannot
  resolve URL modules. If ticket 01 adds `declare module "https://esm.sh/..."`
  stubs to `src/globals.d.ts`, those two lines must be removed or the
  typecheck will fail on an unused expectation.
- Readability's byline is best-effort (the BBC page yields "Max Matza" from
  JSON-LD; pages without JSON-LD may yield a date or nothing). Tests do not
  assert on it.
- Fixture pages had their `<style>` blocks stripped partly because jsdom logs
  "Could not parse CSS stylesheet" errors for modern CSS; keep doing that for
  new fixtures or test output gets noisy.
