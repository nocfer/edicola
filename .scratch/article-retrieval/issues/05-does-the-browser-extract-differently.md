# 05 — Does the browser reach a different verdict than Node on identical HTML?

Type: research
Status: resolved
Blocked by: —

## Question

Given HTML that ticket 02 proved is byte-identical, does `extractArticle`
reach a different verdict in the browser than in Node — and if so, on what?

Ticket 02 leaves this as the leading candidate: la Stampa extracts 4/4 in Node
and scores 0.5 in the app; la Repubblica 3/4 in Node against 0.2 in the app.
The bytes are the same, so either the environment differs or the sample does.
The environment differs in two known ways: `tools/testing/dom.js` builds a
jsdom window while `src/extract.js` uses the page's own `DOMParser`, and each
loads its own DOMPurify.

Both halves must be measured, because a sampling artefact would explain the
gap just as well:

1. Same URL, both engines, same verdict? Use the `qa-run.mjs` eval trick — the
   page serves ES modules, so an eval can `import('/src/extract.js')` and run
   the real browser path on a body Node has already scored.
2. Score the **10** Items a Sync would attempt, not the 4 newest, so the
   comparison is against what the baseline actually measures.

Resolved when the answer says whether the two engines agree, and if they
disagree, which step diverges.

## Answer

**The two engines agree completely, and the gap ticket 02 reported was a
sampling artefact.**

Same HTML string handed to both paths — `extractArticle` under jsdom in Node,
and `extractArticleInBrowser` evaluated in the real page at localhost:8000 via
`tools/testing/cdp.js`. 20 Originals across la Stampa and la Repubblica:

- **agree 20, disagree 0.** Identical `ok`, identical `reason`, identical
  `wordCount` on every single one, down to the word.

So the jsdom/browser DOMParser difference and the two DOMPurify builds change
nothing here. The equivalence question raised in the map's fog is closed with
it: there is no disagreement to write a test against.

The second half of the ticket explains the apparent contradiction in ticket 02.
Scored over the **10** Items a Sync attempts rather than the 4 newest:

| Publication | ok / attempted | baseline |
|---|---|---|
| la-stampa | 4/10 | 0.5 |
| la-repubblica | 1/10 | 0.2 |

That reproduces the baseline. Ticket 02's "extracts fine in Node" was true only
of the newest Items; the withheld ones sit deeper in the Feed, exactly as that
ticket warned it might be.

**What this leaves.** The app is not mis-measuring anything. Those pages really
do carry 34-144 words to an anonymous fetcher, in Node and in the browser
alike, and ticket 02 already proved the relay delivers them faithfully. Both
Publications belong to the same group and both gate the body behind a cookie
and consent state that a reader-mode fetch does not have — which ADR-0004 puts
out of reach by design.

That makes two things urgent rather than optional:

1. **Ticket 01 is now the whole map.** The reader's report is that free-readable
   articles show as Summary-only. If their failures are mostly GEDI titles, the
   app is behaving correctly and the fix is honest copy (ticket 04). If they are
   spread across Publications that *do* syndicate, there is a real defect still
   hidden. Nothing distinguishes those two worlds except the histogram.
2. The copy question is no longer cosmetic. For these Publications
   "does not send the full article to non-subscribers" is **accurate**, so
   ticket 04 has at least one reason token that keeps its sentence.
