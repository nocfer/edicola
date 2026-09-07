# Edicola v1 — spec

**Status:** ready-for-agent (pending seam confirmation, see Testing Decisions)

## Problem Statement

People who want to follow a handful of newspapers and magazines have two bad
options. The publishers' own sites and apps are heavy, ad-laden, push
newsletters and accounts, and the Feeds most of them publish are Truncated, so
an RSS reader shows a paragraph and a link. Existing RSS clients assume a
power user who hunts for feed URLs, manages subscriptions and often pays for a
sync account. Neither works without a connection: on a train, a plane or a weak
signal, the article you meant to read is not there.

## Solution

Edicola is a newsstand you install once. You pick the Nations you care about
and switch on Publications from a curated Catalog. When the app is open and
online it Syncs: it fetches every Enabled Publication's Feed and Pre-fetches the
full Article for the newest Items, images included, straight into the browser's
own database. Today shows one timeline across your Publications; the Reader
shows a clean Article with the Publication name and a link to the Original.
Everything already fetched reads with no connection. There is no account, no
server of ours, and nothing leaves your device except the requests you asked
for. The interface is in English or Italian, independent of which Nations you
follow.

## User Stories

### Choosing what to read

1. As a reader, I want the app to guess my Nation and Language from my browser on first run, so that I see relevant Publications immediately.
2. As a reader, I want to browse the Catalog grouped by Nation and then Category, so that I can find a Publication without knowing its feed URL.
3. As a reader, I want to switch a Publication on or off with one tap, so that curating my newsstand is quick.
4. As a reader, I want to select more than one Nation, so that I can follow both Italian and British Publications.
5. As a reader, I want to add a Custom Publication by pasting a site URL, so that a Publication missing from the Catalog is still reachable.
6. As a reader, I want the app to discover the Feed from a site URL, so that I do not need to find the exact feed address myself.
7. As a reader, I want the app to accept RSS 2.0, Atom, RSS 1.0/RDF and JSON Feed, so that any real-world Publication works.
8. As a reader, I want a Feed with minor XML errors to still parse, so that one publisher's sloppiness does not break my newsstand.
9. As a contributor, I want a documented Catalog entry schema and a CI check that every Catalog Feed parses, so that I can add Publications by pull request with confidence.

### Reading

10. As a reader, I want Today to show one timeline of Items across all Enabled Publications, newest first and grouped by day, so that I can skim the day's news in one place.
11. As a reader, I want each Item card to show the Publication name, title, one-line Summary, relative time and a thumbnail when the Feed offers one, so that I can decide what to open.
12. As a reader, I want to filter Today to a single Publication with a chip, so that I can read one paper at a time.
13. As a reader, I want to see when content was last refreshed, so that I know how stale Today is.
14. As a reader, I want to pull to refresh on Today, so that I can Sync on demand.
15. As a reader, I want to open an Item and read the full Article with its images, so that I do not have to visit the publisher's site.
16. As a reader, I want the Reader to always show the Publication name and a link to the Original, so that I know where the Article came from and can visit it.
17. As a reader, I want a Summary-only Item to tell me plainly that the publisher does not send the full Article to non-subscribers, so that I understand why the text is short and can open the Original.
18. As a reader, I want opening a Summary-only Item while online to trigger Extraction immediately with a visible spinner, so that I get the Article when it is available.
19. As a reader, I want the Reader to reopen an Article at my Reading Position, so that a long piece resumes where I left it.
20. As a reader, I want an Item to be marked Read when I open it, not when I scroll past it, so that Unread means what I expect.
21. As a reader, I want per-Publication Unread indicators and a per-Publication "mark all read", so that I am not shown a guilt-inducing global count.
22. As a reader, I want to share an Item's Original link with the system share sheet, so that I can send an article to someone.
23. As a reader, I want a light and a dark theme following my system setting with a manual override, so that reading is comfortable.

### Offline

24. As a reader, I want the app to open and show Today with no connection, so that I can read on a plane.
25. As a reader, I want Articles and their images Pre-fetched during Sync, so that they are complete offline, not text with broken image placeholders.
26. As a reader, I want the app to request persistent storage, so that the browser does not evict my Articles under pressure.
27. As a reader, I want the app to mark an Item Saved so that it and its Article are never Evicted, so that I can keep something indefinitely.
28. As a reader, I want a Saved screen listing everything I have Saved, so that I can find it later.
29. As a reader, I want Sync to happen when I open the app if the last Sync is older than fifteen minutes, so that I do not have to remember to refresh.
30. As a reader, I want Sync to run without freezing the interface, so that I can start reading while it works.
31. As a reader on a supporting browser, I want the app to refresh opportunistically while closed, so that Today is fresher when I open it, without depending on it.

### Storage and settings

32. As a reader, I want to see how much storage the app uses and clear it, so that I stay in control of my device.
33. As a reader, I want to adjust Retention (days kept, total size cap, per-Article image cap, Items per Publication, Pre-fetch count), so that I can trade freshness against space.
34. As a reader, I want Eviction to run automatically within Retention, so that the app does not grow forever.
35. As a reader, I want to set my own Proxy URL and see the default one, so that my reading habits do not have to pass through a stranger's server.
36. As a reader, I want a documented one-click self-hosted Proxy, so that setting up my own is easy.
37. As a reader, I want to change the interface Language independently of my Nations, so that an Italian abroad can read British Publications in Italian UI.
38. As a reader, I want dates and numbers formatted for my Language, so that the app reads naturally.

### Updates and trust

39. As a reader, I want to be told when a new version is available and to apply it when I choose, so that the app does not change under me mid-article.
40. As a reader, I want a new version never to lose my Saved Articles or read state, so that updating is safe.
41. As a reader, I want assurance that no data leaves my device beyond the requests I asked for, so that my reading is private.
42. As a reader, I want the app to recover by itself if a stale cached Shell fails to start, so that I never have to clear caches by hand.

## Implementation Decisions

### Product shape

- A pre-seeded Catalog, not a subscription list (ADR-0005). Seed Nations are Italy and the United Kingdom, roughly 10 to 15 Publications each across Categories: national news, politics, technology, culture, sport. No OPML import or export.
- Catalog entries carry: name, feed URL, site URL, country code, language code, category, and a truncated flag. Only publicly advertised Feeds. A weekly CI job fetches and parses every Catalog Feed and opens an issue for failures.
- UI Language (en, it) is decoupled from Nation selection (ADR-0006). Both are inferred from browser locale on first run. All user-facing copy lives in per-locale dictionaries; dates and numbers use `Intl` with the UI Language.
- Five screens under hash routes: Today, Reader, Saved, Publications, Settings. Bottom tab bar with Today, Saved, Publications, Settings. The Reader is a full-screen push that hides the tab bar.
- Today groups Items by day with a sticky day header. No infinite scroll into the past; older Items are reachable from the Publication's own list.
- Read state is set on opening the Reader. Unread is shown per Publication. Saved exempts an Item from Eviction. Reading Position is stored per Article.

### Network

- No backend (ADR-0001). One fetcher handles all content requests: direct fetch first, then the configured Proxy. The default Proxy is a public one; Settings exposes it and lets the reader override it.
- Feed autodiscovery: given a site URL, fetch the page and read the alternate-link hints for RSS, Atom and JSON Feed; offer the candidates found.
- Sync: triggered on open when the last Sync is older than 15 minutes, and on pull to refresh. Runs on the page thread, yielding between Items so the UI stays responsive (workers lack `DOMParser`). Order is round-robin across Enabled Publications, newest Items first. Concurrency 4. One retry on failure, then the Item is marked Summary-only and Sync moves on.
- Pre-fetch caps, all adjustable in Settings: 10 Articles per Publication per Sync; 50 Items kept per Publication.
- Periodic Background Sync is registered where available and never relied upon (ADR-0007). The service worker does not intercept content requests.

### Content

- Feed parsing is hand-written over an injected DOM parser; supports RSS 2.0, Atom, RSS 1.0/RDF and JSON Feed, lenient on malformed XML. Output is a normalized Feed with Items: id, title, link, published date, Summary, optional thumbnail, optional inline content.
- Extraction (ADR-0004): fetch the Original through the fetcher, run Readability over an injected Document, sanitize with DOMPurify, collect image URLs, fetch each image through the fetcher and store it as a blob under a per-Article size cap (default 5 MB). Rewrite image references to stored blobs at render time. If the result is under roughly 200 words, the Item stays Summary-only.
- DOMPurify runs on every piece of third-party HTML before storage and before render, Summaries included.

### Storage

- IndexedDB via Dexie is the single content store (ADR-0003). Tables: publications (Catalog and Custom, with enabled flag), items (with read, saved, readingPosition), articles (sanitized HTML, word count, extractedAt), images (blob, byte size, keyed by URL hash, linked to an Article), settings, meta (schema and app version, last Sync time).
- Retention defaults: 30 days, 500 MB total, 5 MB images per Article, 50 Items per Publication. Eviction runs after each Sync and deletes Items outside Retention with their Articles and images, skipping Saved. Eviction planning is a pure function over item records and limits.
- Persistent storage is requested on first Sync.

### Shell and updates

- No build step, vanilla ES modules, lit-html and libraries pinned from esm.sh through one choke point each (ADR-0002). Service worker precaches the Shell and runtime-caches CDN modules cache-first; cache name content-hashed by the stamp tool (ADR-0007).
- Update prompt on a waiting service worker; on confirmation, skip waiting and reload all tabs. App version stamped in the database; a Shell older than the database forces a reload. Migrations additive only (ADR-0008).
- Boot watchdog as in SkyHue: if the app has not booted shortly after load, unregister the service worker, clear caches and reload once.
- No telemetry (ADR-0009).

### Copy and tone

- Summary-only fallback text says the publisher does not send the full Article to non-subscribers, and offers the Original. The app never claims to publish the content.

## Testing Decisions

A good test exercises external behaviour at a seam and would survive an internal rewrite: given this Feed document, these Items come out; given this Original, this Article comes out or the Item stays Summary-only; given these item records and these limits, these ids are evicted. Tests do not assert on internal structure, DOM class names, or call order.

Prior art: SkyHue's `node --test` suites over pure modules with fixtures, and its CDP screenshot recipe for screens.

### Proposed seams (to confirm)

1. **The Sync pipeline**, with `fetchText` and the DOM implementation injected. Tests hand it Enabled Publications and a fake fetcher that serves fixtures by URL, and assert the Items and Articles it would store and the order it fetched in. This is the highest seam and covers parsing, Extraction, round-robin, retry and Summary-only fallback together.
2. **Feed parsing and Extraction as pure functions** taking the document text and an injected DOM. Tested directly against the fixture corpus for format coverage and edge cases that would be tedious to reach through the pipeline.
3. **Pure planners**: Eviction (item records plus limits plus now, returns ids to delete) and Sync ordering (Enabled Publications plus caps, returns the fetch queue).
4. **The fetcher**: direct-then-Proxy behaviour with an injected `fetch`, asserting the fallback and the failure path.

Not unit-tested: Dexie access (thin), the service worker, and every screen. Screens are verified over CDP in both themes and both Languages.

The fixture corpus is the centrepiece: one real document per format and per failure mode, listed in `test/fixtures/README.md`. Every parser bug found later becomes a fixture before it is fixed.

## Out of Scope

- OPML import and export, and any subscription-sync account.
- Hide, mute, keyword filters, and any recommendation or ranking beyond date.
- Push notifications and any server-side component.
- Paywall circumvention of any kind, including user-agent or referrer spoofing and archive lookups.
- Wi-Fi-only image fetching via the Network Information API.
- Full-text search across stored Articles.
- Nations beyond Italy and the United Kingdom in the seed Catalog (adding one is a data change, not a v1 deliverable).
- List virtualization; Today is bounded by Retention and paginates by day.

## Further Notes

- Proposed delivery phases, each ending with the four CI gates green and a CDP screenshot of any new screen: (0) Shell installs and works offline; (1) Catalog, Publications screen, Nations, i18n; (2) Feed parsing with fixtures, fetcher, Today, schema v1; (3) Extraction, image blobs, Reader, fallback; (4) Read, Saved, Reading Position, Saved screen, Eviction; (5) update prompt, version guard, storage settings, persistent storage; (6) Catalog CI health check, contribution docs, README in both Languages.
- The name Edicola is Italian for newsstand. The wordmark and the manifest carry it in both Languages.
