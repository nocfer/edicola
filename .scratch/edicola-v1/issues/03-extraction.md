# 03 — Extraction: an Original becomes a clean, sanitized Article or stays Summary-only

**What to build:** A pure module that turns the HTML of an Original into an
Article using Readability and DOMPurify passed in as parameters, collects its
image URLs, and decides whether the result is good enough or the Item must stay
Summary-only. Plus the tiny browser choke point that binds the CDN libraries.
No UI.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Owns:** `src/extract-core.js`, `src/extract.js`, `test/extract.test.js`,
`test/fixtures/articles/**`.

- [ ] `extractArticle(html, { url, windowFor, Readability, purify })` returns `{ ok, title, byline, excerpt, html, wordCount, imageUrls, reason }`. `ok` is true when `wordCount >= MIN_ARTICLE_WORDS` (exported constant, 200). When Readability returns null or the count is under the threshold, `ok` is false and `reason` is `"no-content"` or `"too-short"` and `html` is still returned if any.
- [ ] Before Readability: resolve every `href`/`src`/`srcset` to absolute against `url`; promote lazy-load attributes (`data-src`, `data-lazy-src`, `data-original`, first `srcset` candidate) into `src` so images survive extraction.
- [ ] After Readability: sanitize with DOMPurify using an explicit allowlist: text and structural tags, `a`, `img`, `figure`, `figcaption`, `blockquote`, `pre`, `code`, `table` family, `video`/`audio` **not** allowed, no `iframe`, `form`, `input`, `style`, `script`, `svg`. Strip `class`, `id`, `style`, and all `on*`. Force `rel="noopener"` and `target="_blank"` on links. Keep `alt`, `width`, `height`, `loading`.
- [ ] `imageUrls` is the ordered, de-duplicated list of `img src` values in the sanitized output (absolute https/http only; data: URIs are dropped from the list but kept inline only if under 32 KB, else removed).
- [ ] Document the contract for image storage: the Reader will later replace each `src` with a stored blob URL; the module exports `rewriteImageSources(html, mapFn, { windowFor })` that applies a URL→URL map so ticket 10 does not re-implement it.
- [ ] `sanitizeSummary(html, purify)` for Feed Summaries: text-level tags only (`p`, `br`, `em`, `strong`, `a`, `ul`, `ol`, `li`), everything else stripped, returned as a string. Also `toPlainText(html, windowFor)` for one-line excerpts.
- [ ] `src/extract.js` is the browser choke point: imports `@mozilla/readability` and `dompurify` from esm.sh pinned to the exact versions in `tools/ensure-test-deps.mjs`, and exports `extractArticleInBrowser(html, url)` and `sanitizeSummaryInBrowser(html)` that bind `window`/`DOMParser` and call the pure functions. Not tested in Node; keep it under 40 lines.
- [ ] Fixtures, real and checked in: a well-formed news article that extracts to a long Article; a page whose anonymous response contains only a teaser (so `ok` is false, `too-short`); a page with no article body (a category index) yielding `no-content`; an article with relative image URLs, `srcset`, and a lazy-loaded image; an article with an inline `<script>`, `onclick`, and a `javascript:` link that must all be gone after sanitizing.
- [ ] Tests use `windowFor`, `Readability`, `purifierFor` from `tools/testing/dom.js` and assert on `ok`, `reason`, word count bounds, image URL lists, and absence of dangerous markup. No assertions on Readability internals.
- [ ] Gates green.
