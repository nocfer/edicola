# 06 — Is the relay's limit cumulative per IP, and does it serve stale bodies?

Type: research
Status: resolved
Blocked by: —

## Question

Two questions about the shipped relay that ticket 02 raised but could not settle
at its sample size:

1. **Is the limit cumulative?** A Sync sends a few hundred requests through one
   public Worker — 30 Feeds, up to 160 Originals, plus every image. If the limit
   is per-IP over a window rather than per-request, one Sync poisons everything
   after it, including the reader's manual "Fetch the full article". That would
   reconcile the two observations that otherwise contradict: a manual retry
   fails the same way, yet 12 relayed fetches from a cold IP all succeeded.
2. **Does it serve the wrong body?** One of those 12 came back 13KB shorter
   through the relay than direct, with a word count exactly matching a
   *different* Original in the same batch. If the relay caches by a colliding
   key, some Summary-only marks are the relay handing us someone else's page.

Measure at the app's own request rate, not above it — this is a free public
service and the point is to characterise what Edicola already does to it, not
to stress it.

Resolved when the answer states whether failures correlate with cumulative
volume, and whether the stale-body case reproduces.

## Answer

**No to both questions as asked — and the measurement found the actual defect
instead.**

**1. The limit is not cumulative at Sync volume.** 60 sequential requests
through `DEFAULT_PROXY_TEMPLATE`, shaped like a Sync (every Catalog Feed, then
Originals): **60 of 60 returned 200**, no throttling onset, no latency ramp
(37-435ms throughout). The relay is not rate-limiting us.

**2. The relay does not serve stale bodies.** The size divergence ticket 02
flagged reproduces on **direct** fetches with no relay involved: the same la
Stampa URL fetched five times direct returned 133011, 133013, 133013, 133013
and 154931 bytes. The publisher varies its own response. The relay mirrors
whatever it is handed.

### What that variance actually does

Fetching one la Stampa Original eight times in a row, direct, and extracting
each response:

| Original | verdicts over 8 identical requests |
|---|---|
| `afd_vox_rn_destra_europa` | 5× `ok` (957w) / 3× `too-short` (39w) |
| `crisi_europea_e_il_tradimento_delle_elite` | 4× `ok` (696w) / 4× `too-short` (39w) |

The 155K variant carries the Article; the 133K variant carries a 39-word
teaser. **Which one you get is a coin flip**, and the word counts are identical
within each variant, so this is two fixed responses being alternated, not a
gradual truncation.

la Repubblica, by contrast, is **stable**: 8 of 8 `too-short` at exactly 60w and
76w on two Originals. That one is a real gate, and ADR-0004 says we stop there.

So the Catalog holds at least two different failures wearing one label.

### The scope correction this forces

The map ruled the permanent Summary-only mark **out of scope**, on the reasoning
that the reader's manual retry reproduced the failure and therefore the failure
could not be transient. That reasoning is now wrong. For la Stampa the failure
reproduces roughly half the time, so a reader who tries once or twice and sees
it fail both times has observed exactly what a 40-60% failure rate looks like.

`src/sync-plan.js:107-111` filters on `!item.summaryOnly`, so the first unlucky
variant condemns that Article permanently even though the very next request
would have carried it. That is no longer an adjacent bug — on this evidence it
is the mechanism that turns a coin flip into the reader's "most of the time".
It moves back in scope as ticket 07.

### Incidental finding, not this ticket's

hdblog answers a direct Node fetch with **429** and answers the relay with a
**3679-byte** body on every Original tried — a stub, not an article, returned
under status 200. Publishers that hand the relay a short non-article page are a
third failure mode distinct from both above. Ticket 03 should watch for it.
