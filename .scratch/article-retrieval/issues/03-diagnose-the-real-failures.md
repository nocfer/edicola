# 03 — What `qa-diagnose` says about the Items that actually failed

Type: research
Status: resolved
Blocked by: 01

## Question

Run `tools/qa-diagnose.mjs` over the failing links ticket 01 collected. For each,
which of its three verdicts lands: Extraction works direct (so the app's problem
is transport), `too-short` on a real article (a teaser — ADR-0004 says we stop),
or `no-content` (Readability found no prose on a page that loaded, which is ours
to fix)?

The sample must be the reader's *real* failures, not a Publication picked by
hand, which is why this waits on 01. Save a fixture with `--save` for every
`no-content`, since those are the ones that become test cases.

Resolved when each sampled failure carries a verdict and the counts say which
verdict dominates.

## Note after ticket 01

Ticket 01 unblocks this one and shrinks it to almost nothing: the reader's whole
failure set is **4 Items, all ansa, all `too-short`**. Run `qa-diagnose` over
those four, but the interesting question is now narrower than the ticket was
written for — ansa is `truncated: true` in the Catalog and scores 0.9 in the
baseline, so four `too-short` Items are either an honest teaser or the same
variant lottery ticket 06 measured on la Stampa. Fetch each of the four several
times before deciding which.

## Answer

**Honest teaser: no. Variant lottery: no. A third thing — the word floor
rejecting complete articles.**

Twelve ansa Originals, each fetched four times (48 requests):

```
flips 0   stable ok 9   stable short 3   of 12
```

Perfectly deterministic — the opposite of la Stampa, where the same test flipped
3 of 8. Nothing to retry here; ansa serves one response.

The three `too-short` Items carry **70, 105 and 150 words**. ansa is a wire
service and those are complete briefs, not truncated articles. `MIN_ARTICLE_WORDS`
is 200 (`src/extract-core.js:12`), so a finished 150-word dispatch is discarded
and the Item is marked Summary-only with reason `too-short`.

The Reader then tells the reader "This publisher does not send the full article
to non-subscribers." For ansa that sentence is false twice over: the publisher
sent the whole article, and there is no subscription involved.

### Three causes now wear the token `too-short`

| Publication | behaviour | what it means | retryable |
|---|---|---|---|
| la Stampa | flips 3 of 8 on identical requests | lost a coin flip | yes |
| la Repubblica | stable at 55-76 words | genuinely gated | no |
| ansa | stable at 70-150 words | complete, just short | no — never was a failure |

That makes `too-short` useless as a signal on its own, which is the finding
tickets 04 and 07 both need: 04 cannot map a reason token to a sentence while
one token means three things, and 07 cannot classify it terminal or retryable
for the same reason.

It also graduates the threshold question out of the map's fog, as ticket 08.

Method note: the reader's own four failing URLs were not usable — the console
table had elided them and hand-reconstructing a truncated URL already produced
one round of worthless numbers earlier in this map. Testing ansa's behaviour
directly answers the ticket's question without them.
