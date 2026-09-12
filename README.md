**English** · [Italiano](README.it.md)

# Edicola

Edicola is a newsstand you install in your browser. You choose the Nations you
care about, switch on Publications from a Catalog that ships with the app, and
whatever has already been fetched reads with no connection. *Edicola* is
Italian for newsstand.

There is no account, no server of ours and nothing to pay. The app is a folder
of static files. Your browser talks to publishers directly and keeps what it
fetches in its own database, on your device.

## What it does

Today is one timeline across every Publication you switched on, newest first
and grouped by day. Tapping an Item opens the Reader with the full Article, its
images, the Publication's name and a link to the publisher's own page. Opening
an Item is what marks it Read; scrolling past it does not. An Item you mark
Saved stays until you unsave it, whatever the storage limits say.

A Sync fetches each Enabled Publication's Feed, then the Articles behind the
ten newest Items of each, images included. It runs when you open the app if the
last one is more than fifteen minutes old, and when you pull Today down to
refresh. The Catalog ships with thirty Publications, fifteen Italian and
fifteen British, filed by Nation and then by Category. You can add one that is
missing by pasting its address in Publications: the app looks for the Feed
itself.

The interface is English or Italian, and which one you read has nothing to do
with which Nations you follow, so an Italian in London can keep Italian menus
and British newspapers.

Storage is bounded by Retention, which you can change in Settings. Out of the
box: thirty days, 500 MB in total, 5 MB of images per Article, fifty Items per
Publication. Eviction drops what falls outside those limits and skips anything
Saved.

## What it does not do

Edicola fetches the page a publisher serves an anonymous visitor and throws
away the navigation, the adverts and the overlays. That is all it does. It does
not get past a paywall, and it will not be taught to: no pretending to be a
different browser, no borrowed cookies, no archive or cache lookups
([ADR-0004](docs/adr/0004-extraction-is-reader-mode-only-no-paywall-circumvention.md)).
When a publisher sends non-subscribers three paragraphs, you get three
paragraphs, marked as a Summary with a link to the Original. This comes up
often: seventeen of the Catalog's thirty Feeds carry only Summaries, so the
Article has to be fetched from the publisher's page, and sometimes there is
nothing there to fetch.

Edicola also never presents itself as the publisher. The Reader always names
the Publication and links out to the Original.

Not built, and not planned: syncing between devices, OPML import or export,
search across stored Articles, push notifications, keyword filters, and any
ranking cleverer than "newest first".

## Installing it

The app runs at <https://nocfer.github.io/edicola/>, served by GitHub Pages
from `main` — the same folder of files that is in this repository, with no
build step in between.

Edicola is a static site with no build step, so any web server will serve it,
GitHub Pages included. Open it in a browser and use the browser's own install
command: "Install" in Chrome's address bar, "Add to Home Screen" in Safari's
share sheet. The app never nags you about this. It works either way, and the
service worker caches its own files on the first load regardless.

## Reading with no connection

The app's own files (the Shell) live in the Cache API, so Edicola opens with
the network down. Items, Articles, image blobs, read state, Reading Positions
and settings live in one IndexedDB database
([ADR-0003](docs/adr/0003-dexie-indexeddb-is-the-single-content-store.md)).
What was fetched before you lost the connection is there. What was not is not,
and the app says so instead of spinning.

Two limits worth knowing. The thumbnails on Today's cards are deliberately not
stored, so with a cold browser cache they hide themselves when you are offline;
the images inside an Article are stored as blobs and do appear. And a browser
may evict a database under storage pressure, so on the first Sync the app asks
for persistent storage. Browsers grant that as a site earns engagement, and a
refusal is not permanent, because Edicola asks again on the next Sync.

## Privacy

Nothing leaves your device except the requests you asked for: each Enabled
Publication's Feed, the page behind each Article, and the images in it
([ADR-0009](docs/adr/0009-no-data-leaves-the-device.md)). No analytics, no
crash reporting, no remote config, no account, no e-mail address. What you have
read, where you stopped reading and what you Saved are rows in your browser's
own database, and they are never sent anywhere. Clearing site data loses them,
and nothing can restore them, which is the price of having no server.

There is one caveat, and it is why the next section exists. Most publishers
send no CORS headers, so a browser is not allowed to read their Feed directly.
Those requests go through a relay instead, and the relay sees every URL you
fetch.

## Self-hosting the Proxy

The Proxy — Settings calls it a relay — is the one piece of infrastructure
Edicola cannot do without. A fresh install points at a small public Cloudflare
Worker so that it works before you have configured anything:

```
https://cors-get-proxy.sirjosh.workers.dev/?url={url}
```

That is somebody's free side project. It can rate-limit you, break for an
afternoon, or disappear, and on 2026-09-07 every alternative we tried was doing
one of those: corsproxy.io had started requiring an API key, allorigins and
codetabs were answering Cloudflare 522, and api.cors.lol rate-limited the
first request of the day. The default also rewrites every response's
`content-type` to `text/plain`; Edicola copes, because it sniffs the document's
root element rather than trusting the header.

Running your own removes the stranger from the middle and the rate limit with
it. It is one Cloudflare Worker on the free plan, and it should be locked to
your own copy of Edicola so that nobody else can use it as an open proxy.
[docs/self-hosted-proxy.md](docs/self-hosted-proxy.md) has the source, the
deploy steps and the exact string to paste into Settings → Proxy. Save it there
and the next Sync uses it; nothing else changes.

If you would rather not, the reader-facing consequence of using the default is
narrow but real: one third party learns which articles you open, and it can
stop working without warning.

## Running it locally

```
npm start          # a static server on http://localhost:8000
```

Then open <http://localhost:8000/>. ES modules do not load from `file://`, so
opening `index.html` from disk will not work.

The app has no dependencies to install and no bundler. Runtime libraries
(lit-html, Dexie, Readability, DOMPurify) load pinned from esm.sh on first use
and are then served from the cache
([ADR-0002](docs/adr/0002-no-build-vanilla-es-modules-with-cdn-lit-html.md)).

## Adding a Publication

For yourself, in the app: Publications → Add by URL. Paste a site address or a
Feed address; Edicola reads the page's Feed hints, shows what it found, and
switches on the one you pick.

For everyone, by pull request: add an entry to `data/catalog.json`. The rules,
the schema and the reasons some well-known papers are missing are in
[docs/catalog.md](docs/catalog.md). Only Feeds a publisher advertises publicly
are listed, one entry per Publication, and every entry is fetched and parsed by
CI before it merges. New Nations are welcome and need no code change.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the five gates, the fixture-first rule
for parser bugs, and the conventions worth reading before the first commit.
Architectural decisions are recorded in [docs/adr/](docs/adr/); the vocabulary
this app is written in is in [CONTEXT.md](CONTEXT.md).

## Licence

MIT.
