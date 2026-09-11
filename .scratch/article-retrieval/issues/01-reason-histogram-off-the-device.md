# 01 — What the reader's own database says the reasons are

Type: task
Status: resolved
Blocked by: —

## Question

Which `summaryOnlyReason` values actually dominate in the reader's live
database, and on which Publications?

Nothing in the app aggregates this and ADR-0009 forbids reporting it, so it has
to come off the device by hand: a snippet run in the app's console that groups
`db.items` by `summaryOnlyReason`, plus the link of a few failing Items per
reason so ticket 03 has real URLs to diagnose.

Resolved when the answer records the histogram and a sample of failing links.
Everything else on this map is guessing until it does.

## How to run it

Open the app on the origin where your reading data actually lives, open
DevTools, and paste this into the console. It reads the database the app
already has and prints counts; nothing leaves the device.

```js
const { getDatabase } = await import("/src/db.js");
const rows = await getDatabase().items.toArray();
const failed = rows.filter((i) => i.summaryOnly);
const by = {};
for (const i of failed) (by[`${i.publicationId} · ${i.summaryOnlyReason}`] ??= []).push(i.link);
console.log(`items ${rows.length} · with Article ${rows.filter((i) => i.hasArticle).length} · Summary-only ${failed.length}`);
console.table(Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ key: k, n: v.length, sample: v[0] })));
copy(JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.slice(0, 3)])), null, 1));
```

The last line puts the table plus up to three sample links per bucket on your
clipboard, which is what ticket 03 needs as input. Paste that back.

## Answer

From the reader's live database:

```
items 90 · with Article 26 · Summary-only 4
ansa · too-short   n=4
```

**Summary-only failures are 4 Items out of 90.** They are one Publication and
one reason. The failure the map was chartered to chase barely exists in this
reader's data.

The number that matters is the one the histogram did not have a bucket for:
**60 of 90 Items have no Article and no Summary-only mark at all.** They were
never attempted. 90 Items with 30 attempted is three Publications at thirty
Feed Items each against `prefetchPerPublication: 10` — the Retention default
doing exactly what it says.

### Why the reader reports this as "Summary only"

`fallbackCard()` in `src/views/reader.js:676` prints its headline
unconditionally:

```js
<p class="reader__fallbackhead">${t("reader.summaryOnly")}</p>
<p class="reader__fallbackbody">${t(body)}</p>
```

Only the *body* branches on the reason. So an Item that was never fetched
renders as **"Summary only"** over "The full article has not been fetched yet."
The headline asserts the publisher withheld something. Nothing was withheld —
Retention simply never reached that Item. Two thirds of this reader's Items are
in that state, which is precisely the reported "most of the time".

### What this does to the map

Three distinct conditions wear the words "Summary only", in descending order of
how often this reader meets them:

1. **Never attempted** — 60/90. Retention's cap, correctly applied, wrongly
   labelled. Not a retrieval bug at all; a copy bug plus a Retention question.
2. **Lost a coin flip and was never reconsidered** — ticket 06's la Stampa
   variant lottery made permanent by `src/sync-plan.js:107`. Ticket 07.
3. **Genuinely withheld** — la Repubblica's stable teaser, and the 4 ansa
   `too-short` here. Honest, and ADR-0004 says we stop.

The map's original premise, that a retrieval failure was misreporting free
articles as paywalled, is only true of case 2. Case 1 is bigger and is a
different defect entirely.

Method note: `copy(...)` threw `ReferenceError` because the snippet ran outside
the DevTools top frame. The table had already printed, so nothing was lost.
