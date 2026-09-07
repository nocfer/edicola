# The Catalog

`data/catalog.json` is the list of Publications that ships with Edicola,
grouped in the app by Nation and then Category (ADR-0005). It is a plain JSON
file maintained by pull request. This page is the contract for that file: the
entry schema, the rules an entry must meet, how to propose one, what the weekly
health check does, and which well-known Publications are missing and why.

## What Edicola does with a Feed

Edicola links to and extracts only what publishers serve publicly. A Catalog
entry points at a Feed the publisher advertises, and Extraction fetches the
Original exactly as an anonymous browser would (ADR-0004). No user-agent
spoofing, no cookies, no archive or cache lookups. When a publisher sends
non-subscribers only a Summary, the Item stays Summary-only and the Reader says
so, with a link to the Original. Edicola never presents itself as the publisher
of the content, and the Reader always shows the Publication name and a link to
the Original.

## Schema

Top level:

```json
{
  "version": 1,
  "categories": ["news", "politics", "business", "technology", "science", "culture", "sport", "local"],
  "publications": [ ... ]
}
```

Each entry in `publications`:

| Field       | Type    | Rule                                                                                                  |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `id`        | string  | Slug: lower-case `a-z`, `0-9`, single hyphens. Unique across the file.                                |
| `name`      | string  | The Publication's own name, as it writes it (`la Repubblica`, `City A.M.`).                          |
| `country`   | string  | ISO 3166-1 alpha-2, upper case (`IT`, `GB`). This is the Nation.                                      |
| `language`  | string  | ISO 639-1, lower case (`it`, `en`). The language of the content, not of the app.                      |
| `category`  | string  | One of the top-level `categories`.                                                                    |
| `feedUrl`   | string  | `https` URL of the Feed. Unique across the file.                                                      |
| `siteUrl`   | string  | `https` URL of the Publication's front page.                                                          |
| `truncated` | boolean | `true` when Items carry only a Summary and the Article must be fetched from the Original.             |
| `note`      | string  | Optional. English. What you saw when you checked the Feed: content shape, paywall, where it is listed. |

No other keys are allowed. `tools/check-catalog.mjs` enforces all of this
offline and `test/catalog.test.js` runs it on every `npm test`.

Categories are the editorial section a Publication is filed under, not a tag
cloud: a Publication appears once, under the Category that describes most of
what it publishes. `local` is for city or regional titles.

## Rules for an entry

1. **Only publicly advertised Feeds.** The Feed must be linked from the
   Publication's site: a `<link rel="alternate">` in the page head, an RSS page,
   a footer link, or a help article. No member-area Feeds, no unofficial
   mirrors, no Feeds rebuilt by third parties from the site's HTML. If you
   cannot point at where the publisher lists the Feed, it does not go in.
2. **Prefer the main national or front-page Feed.** A section Feed is
   acceptable only when the Publication publishes no front-page Feed (Il Sole 24
   Ore, for instance, lists section Feeds only), and the `note` must say so.
3. **One entry per Publication.** Section Feeds of a Publication already listed
   are not separate entries.
4. **Check the Feed yourself before opening the pull request.** Run
   `curl -sL <feedUrl> | head -c 3000` and confirm the root element is `rss`,
   `feed` or `rdf:RDF` (or JSON with an `items` array). Then look at a few
   Items: if `content:encoded` (RSS) or `content` (Atom) carries the whole
   Article, set `truncated: false`; if there is only `description` or
   `summary`, or the content ends with a "continue reading" link, set
   `truncated: true`. Write what you saw in `note`.
5. **English only** in `note`, as everywhere else in the repository.
6. **Nations are Nations.** Adding a Publication from a Nation not yet in the
   Catalog is welcome and needs no code change, but say in the pull request
   that a new Nation is being introduced so the Publications screen can be
   checked with it.

## Proposing a Publication

1. Fork, branch, add the entry to `data/catalog.json` in the block for its
   Nation, keeping entries grouped by Nation and roughly by Category.
2. Run `node tools/check-catalog.mjs` (schema) and
   `node tools/check-catalog.mjs --fetch` (schema plus a live fetch of every
   Feed). Both must exit 0.
3. Run `npm test` and `npm run format`.
4. Open a pull request with: the Publication name, where the publisher
   advertises the Feed (a URL), and a sentence on what the Items carry. The
   maintainer re-runs the fetch and reads the Feed before merging.

Removing a Publication follows the same path. If it is removed because the
publisher no longer offers a Feed, add it to the omissions list below.

## The health check

`.github/workflows/catalog-health.yml` runs every Monday at 06:17 UTC and on
manual dispatch. It runs `node tools/check-catalog.mjs --fetch`, which:

- validates the schema exactly as the test does;
- requests every `feedUrl` with concurrency 4 and a 15 second timeout, using
  the user agent `Edicola catalog health check (+https://github.com/nocfer/edicola)`;
- passes an entry when the response is HTTP 200 and the body looks like a Feed
  (root `rss`, `feed` or `rdf:RDF`, or JSON with `items`);
- prints a Markdown table, failures first, and exits 1 if any entry fails.

On failure the workflow opens an issue titled `Catalog health: N feeds failing`
with the table, labelled `needs-triage`. If such an issue is already open it
updates that issue's title and body instead and leaves a comment, so there is
never more than one. When a later run passes, the workflow closes the issue.
The workflow uses `gh` with the run's `GITHUB_TOKEN` and needs only
`issues: write`. It does not touch `ci.yml`, which stays offline.

The user agent is deliberately not a browser string: at least one publisher
returns 406 to anything that starts with `Mozilla/5.0` and is not a browser,
while accepting a plain descriptive agent.

## Seed Catalog

Thirty Publications, fifteen per Nation, each Feed fetched with `curl` and read
on 2026-09-07. Verified means: the Feed returned a real RSS, Atom or RDF
document, and the publisher links to it from its site or RSS page.

### Italy (`IT`, `it`)

| Category   | Publication          | Feed                                                  | Truncated |
| ---------- | -------------------- | ----------------------------------------------------- | --------- |
| news       | ANSA                 | `https://www.ansa.it/sito/ansait_rss.xml`             | yes       |
| news       | la Repubblica        | `https://www.repubblica.it/rss/homepage/rss2.0.xml`   | yes       |
| news       | Open                 | `https://www.open.online/feed/`                       | no        |
| news       | La Stampa            | `https://www.lastampa.it/rss/copertina.xml`           | yes       |
| news       | Il Fatto Quotidiano  | `https://www.ilfattoquotidiano.it/feed/`              | no        |
| politics   | Il Foglio            | `https://naxos.ilfoglio.it/api/v5/rss/stories/latest` | no        |
| politics   | Linkiesta            | `https://www.linkiesta.it/feed/`                      | no        |
| business   | Il Sole 24 Ore       | `https://www.ilsole24ore.com/rss/economia.xml`        | yes       |
| technology | Wired Italia         | `https://www.wired.it/feed/rss`                       | yes       |
| technology | HDblog               | `https://www.hdblog.it/feed/`                         | yes       |
| science    | Focus                | `https://www.focus.it/rss`                            | no        |
| science    | Galileo              | `https://www.galileonet.it/feed/`                     | no        |
| culture    | Rivista Studio       | `https://www.rivistastudio.com/feed/`                 | no        |
| sport      | Corriere dello Sport | `https://www.corrieredellosport.it/rss/`              | yes       |
| local      | Il Giorno            | `https://www.ilgiorno.it/rss`                         | no        |

### United Kingdom (`GB`, `en`)

| Category   | Publication             | Feed                                                                  | Truncated |
| ---------- | ----------------------- | --------------------------------------------------------------------- | --------- |
| news       | BBC News                | `https://feeds.bbci.co.uk/news/rss.xml`                               | yes       |
| news       | The Guardian            | `https://www.theguardian.com/uk/rss`                                  | yes       |
| news       | The Independent         | `https://www.independent.co.uk/rss`                                   | yes       |
| news       | Sky News                | `https://feeds.skynews.com/feeds/rss/home.xml`                        | yes       |
| politics   | Politics.co.uk          | `https://www.politics.co.uk/feed/`                                    | no        |
| politics   | openDemocracy           | `https://www.opendemocracy.net/rss/`                                  | no        |
| business   | City A.M.               | `https://www.cityam.com/feed/`                                        | no        |
| technology | TechRadar               | `https://www.techradar.com/feeds.xml`                                 | no        |
| technology | Computer Weekly         | `https://www.computerweekly.com/rss/All-Computer-Weekly-content.xml` | yes       |
| science    | Nature                  | `https://www.nature.com/nature.rss`                                   | yes       |
| science    | Physics World           | `https://physicsworld.com/feed/`                                      | no        |
| culture    | London Review of Books  | `https://www.lrb.co.uk/feeds/rss`                                     | yes       |
| culture    | NME                     | `https://www.nme.com/feed`                                            | no        |
| sport      | BBC Sport               | `https://feeds.bbci.co.uk/sport/rss.xml`                              | yes       |
| local      | Manchester Evening News | `https://www.manchestereveningnews.co.uk/rss.xml`                     | yes       |

## Omissions

Publications a reader would expect that are not in the seed, and why. Each was
checked on 2026-09-07; a pull request that shows the situation has changed is
welcome.

### Italy

| Publication          | Reason                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corriere della Sera  | The front-page Feed is not advertised. `corriere.it/rss/` lists only section and local-edition Feeds, and the advertised breaking-news Feed `ultimora.xml` is an empty file. |
| Il Post              | `ilpost.it/feed/` answers 403 to every non-browser client, so the Feed cannot be verified or health-checked.                                                    |
| Fanpage              | Same as Il Post: 403 to every non-browser client.                                                                                                              |
| Rai News             | `rainews.it/rss/tutti` works, but the listing page at `rainews.it/rss` is rendered client-side, so the link cannot be verified without a browser.               |
| La Gazzetta dello Sport | `gazzetta.it/rss/` advertises only section Feeds (Calcio, Basket, ...) and a video Feed; the front-page `rss/home.xml` works but is not linked.                |
| Il Giornale          | No Feed found at any usual path; the site advertises none.                                                                                                     |
| Le Scienze           | `lescienze.it/rss` is a page of article links, not a Feed; no Feed found at any usual path.                                                                    |
| Avvenire             | The site links no Feed and every usual path times out.                                                                                                         |
| Il Messaggero        | `ilmessaggero.it/rss/home.xml` works but the site's RSS page returns 404, so the link cannot be verified.                                                       |
| Il Manifesto         | `ilmanifesto.it/feed` works but is not linked from the site.                                                                                                   |
| Internazionale       | Advertised and working, but the front-page Feed carries only the last three Items; the fuller Feeds are section Feeds.                                         |
| Milano Finanza, Tuttosport | No Feed found; the sites advertise none.                                                                                                                 |
| Sky Sport            | `sport.sky.it/rss/sport.xml` works but is not linked from the site.                                                                                            |

Verified and eligible, left out only to keep the seed at fifteen: Domani,
Il Tascabile, Artribune, Doppiozero (full text in `description`), Media INAF,
Formiche, Valigia Blu, DDay.it, Punto Informatico, RomaToday, MilanoToday.

### United Kingdom

| Publication         | Reason                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Times           | Publishes no Feed.                                                                                                                                 |
| The Telegraph       | `telegraph.co.uk/rss.xml` works, but every page of the site answers 402 to non-browser clients, so where it is advertised cannot be verified.       |
| Financial Times     | `ft.com/rss/home` works, but the site answers 403 and the help pages that used to list Feeds return 404.                                           |
| The Economist       | `economist.com/latest/rss.xml` works, but `economist.com/rss` and the site answer 403 to non-browser clients.                                        |
| New Statesman       | 403 to every non-browser client.                                                                                                                    |
| The Times Literary Supplement | 403 to every non-browser client.                                                                                                          |
| The Spectator, Prospect, PoliticsHome | No Feed found at any usual path; the sites advertise none.                                                                        |
| New Scientist       | `newscientist.com/feed/home/` works for plain user agents but answers 406 to anything starting with `Mozilla/5.0`, and its help pages answer 406 too, so the link cannot be verified. |
| The Register        | `theregister.com/headlines.atom` works but no link to it was found on the site; the old RSS page returns 404.                                       |
| Sky Sports          | `skysports.com/rss/12040` works but is not linked from the site; `skysports.com/rss` returns 404.                                                   |
| Wired UK            | The site's advertised Feed is now the US `wired.com` Feed.                                                                                         |
| ITV News            | The site refuses the connection over HTTP/2 and HTTP/1.1 alike.                                                                                    |

Verified and eligible, left out only to keep the seed at fifteen: Channel 4
News, Metro, Daily Mirror, Evening Standard, The i Paper, Daily Mail, The Week
UK, Big Issue, The Quietus, Aeon, The Conversation UK, Belfast Telegraph, The
Herald, WalesOnline, Liverpool Echo.
