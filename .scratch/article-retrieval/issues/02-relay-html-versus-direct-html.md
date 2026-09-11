# 02 — Does the shipped relay receive different HTML than a direct fetch?

Type: research
Status: resolved
Blocked by: —

## Question

For the same Original, does the HTML that arrives through the shipped default
Proxy differ from the HTML a direct server-side fetch gets — and does
`extractArticle` reach a different verdict on the two?

This is the one discriminator no existing instrument covers. `qa-diagnose.mjs`
fetches **direct** from Node (no CORS, no relay) and `qa-run.mjs` points the app
at a **localhost** relay, so the shipped relay's own view of a page has never
been compared with anything. If a publisher serves the relay a consent wall, a
bot check, or a JS shell, `extractArticle` sees a teaser and reports
`too-short` — and the Reader then tells the reader it is a subscription
problem.

Resolved when the answer states, per sampled Publication, whether the two
sources agree, and if not, what the relay's copy actually contains.

## Answer

**The shipped relay is not the cause.** 12 Originals across 6 Publications,
each fetched direct from Node and through `DEFAULT_PROXY_TEMPLATE`:
11 of 12 came back **byte-identical** with an identical `extractArticle`
verdict. The relay faithfully relays.

One divergence, worth its own follow-up: a la Stampa Original was
`144932B → ok 653w` direct and `131947B → too-short 39w` through the relay —
and that 39w exactly matches the word count of a *different* la Stampa
Original in the same batch. That looks like the relay serving a cached body for
the wrong URL, not a publisher difference. Folded into ticket 06.

**The finding that redirects the map:** on real feed links fetched direct from
Node, the two Publications with the worst baseline extract *fine*.

| Publication | verdicts on the 4 newest Items | baseline article rate |
|---|---|---|
| la-stampa | 4/4 ok (213-778 words) | 0.5 |
| la-repubblica | 3/4 ok (216-1147 words) | 0.2 |

Every one of those pages carries `articleBody` and puts its prose in
`div.story__text`, which Readability finds without help.

So the same HTML that yields 4/4 and 3/4 in **Node** yields 0.5 and 0.2 in the
**browser**, and ticket 02 has just proved the bytes are the same. Two
candidates survive, and they are now tickets 05 and 06:

- The extraction *environment* differs — jsdom + Node DOMPurify here, the
  browser's own DOMParser and DOMPurify there (ticket 05).
- Or my sample is biased: I took the 4 newest Items, while a Sync attempts 10
  and the withheld ones may sit deeper in the Feed (also ticket 05).
- Or the relay's limit is cumulative per IP, so one Sync's few hundred requests
  poisons everything after it — including the reader's manual retry, which is
  the observation that killed the per-request relay theory (ticket 06).

Method note: an earlier pass of this ticket probed two URLs I had
reconstructed by hand from truncated output; both were `article.error-page` and
those numbers were discarded. Every figure above comes from links pulled
straight from the Feed.
