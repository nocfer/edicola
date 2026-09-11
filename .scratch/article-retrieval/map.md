# Map: article retrieval marks free-readable pages Summary-only

Label: wayfinder:map

## Status

**The way is clear — no open tickets.** The diagnosis is in Decisions so far and
the fix spec is tickets 04, 07 and 08 together. Nothing below is blocking; the
one remaining fog patch is a Retention question that only opens if the shipped
copy fix turns out not to be enough.

## Destination

A diagnosis that names which cause actually produces a Summary-only mark on
pages a browser reads for free, plus a fix spec for that cause. Decisions, not
a fix applied.

## Notes

Domain vocabulary: `CONTEXT.md`. Every answer here is bounded by **ADR-0004**
(Extraction is reader mode only, no circumvention) and **ADR-0013** (the Feed
body is an Article source); **ADR-0001** bounds transport and **ADR-0009**
forbids telemetry — which is why the reason distribution has to be pulled off
the reader's own device by hand instead of being reported.

Skills: `/grilling` + `/domain-modeling` on the decision tickets. Ponytail is
on: reuse `tools/qa-diagnose.mjs` and `tools/qa-run.mjs`, do not build a third
instrument.

Established while charting, so no ticket re-asks it:

- The reader's Proxy is the **shipped default** public Worker.
- Pressing "Fetch the full article" in the Reader on a failing Item
  **reproduces the failure**. That rules out a *per-request* relay limit, but
  not a cumulative per-IP one, which ticket 06 now chases.
- `test/qa-baseline.json` (recorded 2026-09-09) puts 20 of 26 Publications at
  0.8-1.0 article rate — but `qa-run.mjs` measures through its **own localhost
  relay**, not the shipped one, so the baseline and the reader's experience are
  not the same transport and the gap is unexplained.
- No reason histogram exists anywhere: `summaryOnlyReason` is written by Sync
  and read only by one Reader branch (`src/views/reader.js:667`).

## Decisions so far

<!-- one line per resolved ticket -->

- [02 — Does the shipped relay receive different HTML than a direct fetch?](issues/02-relay-html-versus-direct-html.md)
  — No. 11 of 12 Originals were byte-identical direct vs. relayed, same verdict
  both ways. And the two worst-scoring Publications extract **fine** from Node
  (la Stampa 4/4, la Repubblica 3/4) on HTML the app scores 0.5 and 0.2, so the
  divergence is not in the bytes. Surfaced tickets 05 and 06.
- [05 — Does the browser reach a different verdict than Node?](issues/05-does-the-browser-extract-differently.md)
  — No: 20 of 20 identical, down to the word count. The 02 gap was sampling —
  over the 10 Items a Sync attempts, la Stampa is 4/10 and la Repubblica 1/10,
  which reproduces the baseline. The app measures correctly; those pages really
  do carry 34-144 words to an anonymous fetcher.
- [06 — Is the relay's limit cumulative, and does it serve stale bodies?](issues/06-is-the-relay-limit-cumulative.md)
  — No to both: 60/60 relay requests returned 200, and the size divergence
  reproduces on direct fetches with no relay. But it found the defect: la Stampa
  serves the Article on only ~5 of 8 identical requests, alternating a 155K
  body against a 133K 39-word teaser. la Repubblica is stably gated. Two
  different failures wear one label. Forced the scope correction below and
  opened ticket 07.
- [01 — What the reader's own database says the reasons are](issues/01-reason-histogram-off-the-device.md)
  — 90 Items, 26 with an Article, and only **4** Summary-only (ansa,
  `too-short`). The dominant state is the one with no bucket: **60 Items never
  attempted**, Retention's `prefetchPerPublication: 10` against thirty-Item
  Feeds. They reach the Reader headed "Summary only" because
  `src/views/reader.js:676` prints that headline unconditionally. Three
  conditions wear one label; the never-attempted one is the biggest by far.
- [03 — What `qa-diagnose` says about the Items that actually failed](issues/03-diagnose-the-real-failures.md)
  — ansa is deterministic: 0 flips in 48 fetches, 9/12 ok, 3/12 `too-short` at
  70, 105 and 150 words. Those are complete wire briefs killed by the 200-word
  floor, not teasers. `too-short` now provably means three different things
  across three Publications, which blocks 04 and 07 from treating it as one
  signal. Opened ticket 08.
- [09 — Which structural signal separates a gated page from a short one?](issues/09-structural-paywall-signals.md)
  — None of them. `isAccessibleForFree` is wrong in both directions (la
  Repubblica declares `false` on a page that extracts fine; la Stampa declares
  `true` on a 41-word teaser), `hasPart` never appears, and furniture and prose
  ratio track the Publication rather than the outcome. What does separate is the
  word counts: la Stampa stubs 34-42, la Repubblica teasers 50-66, ansa briefs
  70-150 — three non-overlapping bands on 16 failures from one run.
- [08 — Should a complete short article count as a failure?](issues/08-should-a-short-article-be-a-failure.md)
  — No. Lower the floor **Extraction** applies to 70 words, but split the
  constant first: `MIN_ARTICLE_WORDS` is also what `articleFromFeed` uses to
  decide a Feed body is a whole Article (ADR-0013) and what the Catalog audit
  keys its dead band on. Both stay at 200; only `extractArticle` drops. Known
  ceiling: four words of margin (66 vs 70) from one run.
- [07 — Should a Summary-only mark ever be reconsidered?](issues/07-a-summary-only-mark-that-can-be-reconsidered.md)
  — Yes. A non-indexed `attempts` counter (no migration, the `seen` precedent),
  capped at 3, with only `no-link` and `not-found` terminal. `too-short` and
  `no-content` are retryable, which is the counter-intuitive half ticket 06
  forced. Leaves ~6% of la Stampa unrecovered against 40% today; costs the
  stably-gated Publications 2 extra requests per Item, once. The Reader's manual
  fetch must not consume attempts.
- [04 — What each reason may honestly claim](issues/04-what-each-reason-may-honestly-claim.md)
  — Two headline states, split on whether a reason exists at all, which fixes
  the never-attempted mislabel. The subscription sentence survives but fires
  only once attempts are exhausted, because ticket 09 showed nothing in the page
  declares a paywall and ticket 06 showed the reasons flip. Retry state stays
  internal to the app.

## Not yet specified

- Whether `prefetchPerPublication: 10` against thirty-Item Feeds is the right
  default, now that ticket 01 shows it leaves two thirds of a reader's Items
  unfetched. This is a Retention question, not a retrieval one, and it only
  becomes worth opening if ticket 04 decides honest copy is not enough on its
  own.

<!-- Answered by ticket 07: the manual fetch must not consume attempts. -->

## Out of scope

- Circumventing a paywall, a consent gate or a bot check. ADR-0004, flat. If
  the diagnosis lands on "the publisher genuinely withholds this from
  anonymous readers", the honest outcome is Summary-only plus correct copy.
- Running our own relay, or any backend. ADR-0001.
- ~~The permanent Summary-only mark.~~ **Scope correction, reversed by ticket
  06.** This was ruled out on the reasoning that the reader's manual retry
  reproduced the failure, so the failure could not be transient. Ticket 06
  measured la Stampa failing on 3 of 8 identical requests, which is exactly what
  a reader who retries once or twice would report as "fails the same way". The
  premise was wrong, so the exclusion goes with it. Now live as ticket 07.

## Implemented

Tickets 04, 07 and 08 are in the working tree on `feed-body-cleanup`. All four
CI gates pass. Three things the spec had wrong or missing, found while building
it:

1. **A second filter the spec never named.** `store.js`'s
   `itemsNeedingArticles` also excluded Summary-only Items before the planner
   ever saw them, so ticket 07's filter change alone would have retried nothing.
   That condition is removed and the decision left to `planArticleFetches`,
   which is the one place documented as owning it.
2. **Tickets 04 and 07 contradicted each other.** 04 gated the subscription
   sentence on exhausted attempts; 07 ruled that the Reader's own fetch must not
   spend an attempt. Together they meant a reader tapping "Fetch the full
   article" on a genuinely gated Original would never see the honest sentence,
   and `tools/qa-scenarios.mjs`'s `summary-only-reader` scenario — which reaches
   the teaser through exactly that path — would have broken. Resolved by
   treating a fetch the reader triggered as settling the question immediately:
   they asked, it ran, nothing is pending behind it. The scenario needed no
   seeding after all.
3. **One new string, not two.** 04 specified two new headline keys, but "Not
   fetched yet" over "The full article has not been fetched yet." says the same
   thing twice. The never-attempted state uses the existing `reader.notFetched`
   as its headline with no body line, so only `reader.noArticleHead` is new.

Also updated: `test/extract.test.js` had a fixture asserting `too-short` at 91
words, which the 70-word floor makes an Article — the expectation moved to 4
paragraphs (61 words) and a new test covers the behaviour the change exists for.
`tools/qa-diagnose.mjs` now reports the Original's floor rather than the Feed
body's.
