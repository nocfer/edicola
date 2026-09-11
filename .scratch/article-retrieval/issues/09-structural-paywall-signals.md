# 09 — Which structural signal separates a gated page from a short one?

Type: research
Status: resolved
Blocked by: —

## Question

Ticket 08 rejected the Feed Summary comparison as too thin. Which signal in the
page itself separates a gated Original from a complete short one?

Candidates, strongest first:

- **`isAccessibleForFree`** in the page's JSON-LD. This is schema.org's declared
  paywall field and the markup Google requires publishers to use for metered
  content, alongside `hasPart` entries carrying a `cssSelector` and
  `isAccessibleForFree: false`. If a publisher declares it, no threshold is
  needed and nothing is being inferred — we would be reading what the page says
  about itself.
- Paywall furniture: a container whose class or id names a paywall, premium
  tier, or subscription, and subscribe controls in the page's own language.
- Prose ratio: extracted words over the whole document's words, which measures
  how much of the page Readability had to discard.

Measure all of them across the three known behaviours — ansa's complete briefs,
la Repubblica's stable teasers, la Stampa's two variants — and include
**successful** Originals from the same Publications as controls. A signal that
fires on the teasers but also on the articles is worthless.

Resolved when one signal is shown to separate the cases, or all three are shown
not to.

## Answer

**All three fail. None separates a gated page from a complete short one.**

Eight Originals per Publication, successful ones included as controls.

**`isAccessibleForFree` is wrong in both directions.** la Repubblica declares
`false` on all eight of its pages, *including* the one that extracted 216 words
without trouble. la Stampa declares `true` on a 41-word teaser and `false` on
the 957-word Article. The field is set by the page template, not per Article,
so it carries no information about the Article in front of us. ansa omits it
entirely. This is the identical failure ADR-0013 records for the
hand-maintained `truncated` flag, arriving from the publisher instead of from
us. `hasPart` with a `cssSelector` never appeared once.

**Paywall furniture tracks the publisher, not the outcome.** ansa scores 7-9 on
its successes and 7 on its failure; la Repubblica 3-4 on both; la Stampa 1-2 on
both. A per-Publication constant, useless as a discriminator.

**Prose ratio separates within a Publication but not across.** ansa's successes
run 0.12-0.29 against 0.05 for its failure; la Stampa's run 0.49-0.73 against
0.14-0.16. But ansa's *successful* 0.12 sits below la Repubblica's *failed*
0.13, so no global threshold exists. It is also largely a restatement of the
word count it would be used to overrule.

### What did separate: the word counts themselves

| | `too-short` word counts |
|---|---|
| la Stampa bad variant | 34, 39, 39, 41, 42 |
| la Repubblica teasers | 50, 52, 55, 56, 59, 60, 63, 66 |
| ansa complete briefs | 70, 105, 150 |

Every la Repubblica teaser measured is 66 words or fewer. Every ansa brief is 70
or more. The three behaviours occupy three non-overlapping bands, and a floor
near 70 would accept ansa's briefs whole while still rejecting every teaser in
this sample.

Two honest limits on that. It is 16 failures from one run on three
Publications, so the gap between 66 and 70 is a gap in *this* sample, not a
demonstrated constant. And ticket 08's earlier measurement found la Stampa
`too-short` bodies of **144 and 173 words**, which a 70-word floor would accept
— though those are the variant-lottery pages whose good variant carries 696-957
words, so ticket 07's retry would reach the real Article anyway.

The wider conclusion for ticket 08: **no single response can be inspected to
tell a complete brief from a teaser.** The only signal that proved reliable
across this whole map is repetition — la Stampa flips and is therefore
detectable by retrying, while ansa and la Repubblica are stable. Whatever 08
decides has to rest on the word count, on a retry, or on honest copy, because
the page itself does not say.
