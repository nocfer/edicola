# 04 — What each reason may honestly claim

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

Which reasons are entitled to the subscription sentence, and what should the
rest say?

`src/views/reader.js:667-673` routes `too-short` and `no-content` to
`reader.summaryOnlyBody` — "This publisher does not send the full article to
non-subscribers." The comment above `fallbackCard()` argues that Extraction
having run and found little *is* the paywall case. Ticket 02 may show that a
consent wall reaches Extraction as the very same `too-short`, in which case that
sentence blames the publisher for something we did.

Needs 01 and 02 first: the mapping is only decidable once we know which reasons
occur and what is behind them.

Resolved when each reason token has an agreed sentence, and any new token the
answer requires is named.

## Answer

**Two headline states, and the subscription sentence survives but is gated on
exhausted attempts.**

The defect ticket 01 found is that `src/views/reader.js:676` prints its headline
unconditionally, so an Item nobody ever fetched is headed "Summary only" — an
assertion that a publisher withheld something. Two thirds of the reader's Items
are in that state.

### The mapping

| Condition | Headline | Body |
|---|---|---|
| no reason — never attempted | `reader.notFetchedHead` (new) | `reader.notFetched` (existing) |
| any reason | `reader.noArticleHead` (new) | as below |

Body, when there is a reason:

| Reason | Body | Why |
|---|---|---|
| `too-short`, `no-content`, **attempts exhausted** | `reader.summaryOnlyBody` — the subscription sentence | Ticket 09 proved nothing in the page declares this, so the claim rests on the app having tried and failed three times. At that point it is the honest reading and ADR-0004's case holds. |
| `too-short`, `no-content`, **attempts remain** | `reader.fetchFailed` | Ticket 06 proved these flip. Asserting a paywall while the app itself intends to retry states a conclusion the app has not reached. |
| every other reason | `reader.fetchFailed` | Unchanged. A request that failed is not a publisher withholding anything. |

The `reader.reason.*` line under the body is unchanged — `KNOWN_REASONS` already
gives each token its own sentence, and those sentences are accurate.

Retry state stays internal: the reader is not told a retry is coming. They
cannot act on it, and the Item simply improves on its own within a Sync
interval. Only the *sentence* consults `attempts`, not the headline.

### What this touches

- **Both dictionaries.** Add `reader.notFetchedHead` and `reader.noArticleHead`
  to `en` and `it`; remove `reader.summaryOnly`, which has no other caller.
  `today.summaryOnly` is a different key and stays — the Today badge and the
  Story badge both read `item.summaryOnly`, which is only ever set on a real
  failure, so both are already correct.
- **`index.html`** carries no `reader.*` strings in its IT fallback. Nothing to
  do there, contrary to what the usual i18n checklist would suggest.
- **`tools/qa-scenarios.mjs:123`** expects `reader.summaryOnlyBody`. That
  scenario must now seed its Item at the attempt cap, or the sentence it asserts
  will correctly no longer appear. Add a second scenario for the never-attempted
  state, which is the one the reader actually meets most often and which had no
  scenario at all — CLAUDE.md asks for a scenario per state, and this state
  existed without one, which is why the wrong headline shipped unnoticed.
