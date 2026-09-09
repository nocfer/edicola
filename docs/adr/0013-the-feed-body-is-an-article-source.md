---
status: accepted
---
# The Feed body is an Article source, not just a Summary

An Article can come from two places: Extraction of the Original
([ADR-0004](0004-extraction-is-reader-mode-only-no-paywall-circumvention.md)),
or the body the Feed already carried. Where the Feed body clears the same
quality floor Extraction has to clear, it becomes the Article and the Original
is never requested.

Until this decision Sync used the Feed body only as a Summary and always
fetched the Original. Measured against the shipped Catalog, fourteen of the
thirty Publications syndicate the whole Article — between 200 and 1168 words in
`content:encoded`, Atom `content`, or, for a few (il Foglio, the Guardian), in
a `description` that is not a summary at all. Every one of those Articles was
downloaded, discarded, and then derived a second time from a page fetched over
the network.

That was wasteful, and for some Publications it was the difference between an
Article and nothing. hdblog syndicates full text and serves its Originals
behind a JavaScript bot check that answers HTTP 429 to any client that does not
run it, so Extraction could never succeed: the reader was denied an Article the
publisher had already handed us. Enabling this path moved hdblog from 20% to
70% of attempted Articles.

## The rules

- **The same quality floor decides.** The Feed body goes through the same
  `ARTICLE_PURIFY_CONFIG`, the same `MIN_ARTICLE_WORDS`, and the same link
  density test as an extracted Original. A body under the floor is not an
  Article, and the Item falls through to Extraction exactly as before.
- **Readability is not run on it.** Readability's job is finding the article
  inside a page of navigation, and this input is already only the article: a
  publisher chose those bytes as the syndicated body. Relative URLs are
  resolved against the Item's link, the links are hardened, and images we
  cannot store are dropped — the steps that make any third-party HTML safe.
- **One budget for both sources.** The choice happens inside the Article phase,
  on a queue already capped at `prefetchPerPublication` and already
  age-filtered. An earlier draft stored Feed Articles during the Feed phase and
  gave each Publication its cap twice, which makes the reader's Retention
  setting decorative.
- **The `truncated` flag is not consulted.** It is hand-maintained Catalog
  metadata and it was wrong in both directions — hdblog was marked
  Summary-only while carrying full text. The body in front of the pipeline is a
  fact; the flag is a claim. `truncated` stays as Catalog documentation and as
  something the Publications screen shows.
- **This is not a circumvention.** Nothing here requests content a publisher
  withheld. It reads what the publisher chose to syndicate, at the address they
  advertise, which is the narrowest possible reading of ADR-0004 rather than an
  exception to it.

## Consequences

- Fewer network requests per Sync, and more content available offline sooner.
- Publications whose Originals are gated but whose Feeds are not now produce
  Articles. Publications that gate both still do not, and stay Summary-only.
- Article quality now varies by source. Publisher Feed markup is rougher than
  reader mode: inline promotions and the publisher's own image wrappers survive
  where Readability would have dropped them. The word floor is the only quality
  gate, and `tools/qa-checks.js` is where a specific recurring defect gets
  caught.
- `ARTICLE_PURIFY_CONFIG` is now load-bearing for two inputs. Loosening it to
  accommodate one publisher's markup loosens it for every Original too.
