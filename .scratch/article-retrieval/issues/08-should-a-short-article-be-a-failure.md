# 08 — Should a complete short article count as a failure?

Type: grilling
Status: resolved
Blocked by: 09

## Question

What should happen to an Article that is complete but shorter than
`MIN_ARTICLE_WORDS`?

Today it is discarded and the Item is marked Summary-only with reason
`too-short`. Ticket 03 measured ansa serving complete wire briefs of 70, 105 and
150 words, deterministically, and all three were thrown away. The reader is then
told a subscription is the reason.

The 200-word floor exists for a good reason — ADR-0004 uses it to detect a
paywall teaser, and it does that correctly for la Repubblica, which stabilises
at 55-76 words. The floor is not wrong; it is being asked to distinguish two
things that a word count alone cannot separate. A 150-word wire brief and a
150-word paywall teaser have the same length.

What else is available to tell them apart is the real question:

- The Feed's own Summary. A teaser page usually repeats the Summary almost
  exactly; a complete brief says more than the Summary did. Both are already in
  hand at the moment of the decision, and `articleFromFeed` already compares
  bodies against the same floor (ADR-0013).
- Per-Publication knowledge. The Catalog already carries a hand-maintained
  `truncated` flag, and ADR-0013 records that it was wrong in both directions,
  so a second hand-maintained field would inherit that problem.
- Structural signals at the point of Extraction — a paywall container, a
  subscribe control, link density, the ratio of prose to furniture.

Whatever the answer, it must not weaken the paywall detection ADR-0004 relies
on: turning the floor off would let la Repubblica's 60-word teasers through as
Articles, which is a worse failure than the one being fixed.

Resolved when there is an agreed rule for accepting a short Article, and a
statement of what it costs on the la Repubblica case.

## Progress, not yet resolved

Measured the first candidate axis — comparing the extracted body against the
Feed Summary. `novel` is the share of body words absent from the Summary;
`summaryCovered` is the share of Summary words present in the body.

| | novel | summaryCovered |
|---|---|---|
| ansa briefs (70-150w) | 0.89-1.00 | 1.00 |
| la Repubblica teasers (50-66w) | 0.05-0.65 | 1.00 |
| la Stampa bad variant (39w) | 0.96 | 0.06 |

It separates ansa from la Repubblica, but only by 0.24 across 15 samples, and la
Stampa's 39-word stub scores `novel` 0.96 — it would pass as a complete brief on
that signal alone, caught only by its low `summaryCovered`. One ansa Item
carried an empty Feed Summary, so neither signal exists for it.

**Decision so far: the Summary comparison is too thin to build the rule on.**
Measure a structural axis before choosing. Blocked on ticket 09.

Worth carrying into that decision: the useful reframing is not "is this a
paywall?" but "is this Article worth more than the Summary the reader already
has?" A teaser is then rejected for being redundant rather than for being
judged, and ADR-0004's detection is preserved as a consequence instead of being
re-implemented.

## Answer

**Lower the floor Extraction applies to about 70 words — and split the constant
first, because it currently serves three jobs and only one of them should
move.**

`MIN_ARTICLE_WORDS = 200` is read at three sites:

| Site | Job |
|---|---|
| `src/extract-core.js:269` (`extractArticle`) | Is this Original a teaser? |
| `src/extract-core.js:346` (`articleFromFeed`) | Is this Feed body a *whole* Article? |
| `tools/check-catalog.mjs:365-366` | Catalog audit of the `truncated` flag, dead band at half the floor |

Only the first should drop. The other two get worse at 70:

- **`articleFromFeed` would regress.** ADR-0013 accepts a Feed body only when it
  is the whole Article; at a 70-word floor any Feed carrying a 70-word blurb
  becomes an accepted Article and Sync stops fetching the Original. The reader
  would get a blurb where they used to get the full text — a worse outcome than
  the bug being fixed, and the exact trap ADR-0013 was written to avoid.
- **The Catalog audit would drift.** `carriesArticles` at ≥70 with a dead band
  below 35 would start flagging `truncated: true` Publications as carrying
  Articles, which is the noisy direction the comment at
  `check-catalog.mjs:360-363` deliberately guards against.

### The spec

1. Keep `MIN_ARTICLE_WORDS = 200` for `articleFromFeed` and for the Catalog
   audit. Nothing about those two jobs changed.
2. Introduce a separate floor for `extractArticle` at **70**, named for what it
   does rather than for a length — it is the point below which a body is assumed
   to be a teaser rather than a short Article.
3. Comment it with the measurement, because the number is not a taste: la
   Repubblica's teasers measured 50-66 words and ansa's complete briefs 70-150,
   across 16 failures on three Publications.

### Known ceiling

The margin is **four words** — 66 against 70 — from one run. A future teaser at
72 words would be stored as an Article, and an ansa brief at 68 would still be
lost. This is a calibration, not a law, and it wants the comment to say so and
`test/qa-baseline.json` to notice if it drifts.

Its one measured gap is la Stampa's 144 and 173-word `too-short` bodies from
ticket 08's first pass, which a 70-word floor accepts. Those are the
variant-lottery pages whose good variant carries 696-957 words, so ticket 07's
retry is what reaches the real Article there. The floor is not asked to solve
that case.

### Consequences for the open tickets

- **Ticket 04** gains a distinction it needs: at a 70-word floor, `too-short`
  stops firing on complete short Articles, so the token narrows to teasers and
  stubs and can honestly keep a withheld-content sentence.
- **Ticket 07** still has to classify `too-short` as retryable, because la
  Stampa's stubs (34-42 words) sit below any floor and are recovered only by a
  retry.

No code changed: this map's destination is the spec, and ADR-0004 and ADR-0013
both want the split above recorded before an edit lands.
