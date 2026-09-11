# 07 — Should a Summary-only mark ever be reconsidered?

Type: grilling
Status: resolved
Blocked by: —

## Question

Under what conditions should a later Sync retry an Item it has already marked
Summary-only?

`src/sync-plan.js:107-111` filters candidates on `!item.summaryOnly`, so today
the answer is "never": the first failure is final until Eviction deletes the
Item. Ticket 06 showed that la Stampa serves the Article on roughly half of
identical requests, so that first failure is frequently a coin flip the Item
loses once and then loses forever.

The decision is not "retry everything". `summaryOnlyReason` already carries the
vocabulary needed to split the cases, and the split is the actual question:

- Which reasons describe a **verdict about the page** that a retry cannot
  change — and which describe **what happened on one attempt**?
  `too-short` looks terminal but ticket 06 proves it is not, for at least one
  Publication. `not-found` and `no-link` genuinely are.
- What bounds a retry, so this does not become an unbounded re-fetch loop that
  spends the reader's Retention budget on the same failing Items every Sync?
  A per-Item attempt count, an age cutoff, and the existing
  `prefetchPerPublication` cap all interact here.
- Does a retried Item compete with fresh Items for that cap, or get its own
  budget? Ticket 06's evidence says a retry is cheap and often succeeds, but a
  Publication that fails everything must not starve the Publications that work.

Depends on nothing: ticket 06 supplies the evidence and the reason vocabulary
already exists. Ticket 01's histogram will sharpen the per-reason split but is
not needed to open the question.

Resolved when each reason token is classified terminal or retryable, and the
retry bound is named.

## Answer

**A non-indexed attempt counter on the Item, capped at 3, with two terminal
reasons excluded.**

### Classification

| Reason | Terminal? | Why |
|---|---|---|
| `no-link` | terminal | There is no URL. No attempt can exist. |
| `not-found` | terminal | 404, and `fetcher.js` already treats it as final and never retries it through the Proxy. |
| `too-short`, `no-content` | **retryable** | Ticket 06 proved these flip: la Stampa serves the Article on ~5 of 8 identical requests. This is the counter-intuitive half and the reader's actual bug. |
| `offline`, `timeout`, `blocked`, `too-large`, `proxy-unconfigured` | retryable | All describe one attempt, not the page. `proxy-unconfigured` in particular becomes valid the moment the reader sets a Proxy. |

### The bound

A plain `attempts` number on `ItemRow`, **not indexed**, so it needs no
`db.version(n)` block — the precedent is `seen`, documented at `src/db.js:73`:
IndexedDB stores whole objects and only a declared index constrains their shape.
A row written before the field existed reads `undefined`, which the comparison
treats as zero. ADR-0008 stays satisfied without a migration.
`upsertItems` merges only `FEED_FIELDS` over an existing row, so a later Sync
seeing the same Item in the Feed does not reset the count.

`src/sync-plan.js:107-111` changes from excluding every Summary-only Item to
excluding only the ones that are out of attempts:

- keep `!item.hasArticle` and the `maxAgeDays` cutoff exactly as they are;
- replace `!item.summaryOnly` with: not Summary-only, **or** Summary-only with a
  retryable reason and fewer than 3 attempts.

Cap of 3 comes from ticket 06's measured ~0.6 success per request: 0.4³ ≈ **6%
of la Stampa Items unrecovered**, against 40% today. The stable cases pay for it
once — la Repubblica's gated Items cost 2 extra requests each and then fall out
of the candidate set permanently.

### Two interactions worth stating

**The Retention cap.** Retried Items stay in the candidate set, so they compete
with fresh Items for `prefetchPerPublication`. The existing newest-first sort
already handles the ordering, and a Publication that fails everything delays
reaching deeper Items by at most two Syncs before its failures go terminal. At a
15-minute Sync interval that is bounded and self-clearing, so no separate retry
budget is needed. Introducing one would be a second cap to keep consistent with
the first, for a case that resolves itself in half an hour.

**The Reader's manual fetch must not be capped.** `fetch-one.js` also calls
`store.markSummaryOnly`, but it bypasses `sync-plan.js` entirely and is the
reader explicitly asking. If it consumed attempts, three taps would permanently
condemn the Item — the reverse of the fix. So the increment does not belong
inside `markSummaryOnly` for every caller: give it an explicit opt-in
(`markSummaryOnly(id, reason, { countAttempt })`) that Sync passes and the
Reader does not. One function, one obvious call site difference.

### The check to leave behind

One test in `test/sync-plan.test.js` against `planArticleFetches`: a Summary-only
Item with a retryable reason and 2 attempts is queued; the same Item at 3
attempts is not; a `not-found` Item is never queued at any count. That is the
smallest thing that fails if the filter logic breaks, and the planners are
already pure functions with no I/O, so it needs no DOM and no fixture.
