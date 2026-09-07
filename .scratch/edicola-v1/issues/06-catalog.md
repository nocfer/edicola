# 06 — Catalog: seed Publications for Italy and the United Kingdom, validated and health-checked

**What to build:** The Catalog data file with roughly 10 to 15 real
Publications per Nation for Italy and the United Kingdom across Categories, a
documented entry schema and contribution rules, an offline schema validator
run in tests, and a weekly GitHub Actions job that fetches every Feed and opens
an issue when one fails. No UI.

**Blocked by:** None — can start immediately.

**Status:** done

**Owns:** `data/catalog.json`, `docs/catalog.md`, `tools/check-catalog.mjs`,
`test/catalog.test.js`, `.github/workflows/catalog-health.yml`.

- [x] Entry schema: `{ id (slug, unique), name, country (ISO 3166-1 alpha-2), language (ISO 639-1), category (one of: news, politics, business, technology, science, culture, sport, local), feedUrl (https), siteUrl (https), truncated (boolean), note (optional, English) }`. Top level: `{ version: 1, categories: [...], publications: [...] }`.
- [x] Only publicly advertised Feeds (linked from the site or its help pages). No member-area feeds, no unofficial mirrors. Prefer the Publication's main national/front-page Feed. For each entry, `curl` the Feed once and set `truncated` by inspecting whether Items carry full content or a teaser; record what you saw in `note` where useful.
- [x] Italy: cover national dailies and magazines across Categories (news, politics, business, technology, culture, sport, science). United Kingdom: same spread. 10 to 15 each. If a major Publication publishes no Feed, leave it out and say so in `docs/catalog.md`.
- [x] `docs/catalog.md`: the schema, the rules above, how to propose a Publication by pull request, what the health check does, and the explicit statement that Edicola links to and extracts only what publishers serve publicly (ADR-0004).
- [x] `tools/check-catalog.mjs`: offline mode validates schema, unique ids, valid codes, https URLs, categories from the list; exits 1 with a per-entry message on failure. `--fetch` mode additionally requests every `feedUrl` (concurrency 4, 15 s timeout) and checks the response is 200 and looks like a feed (root `rss`, `feed`, `rdf:RDF`, or JSON with `items`), printing a table and exiting 1 if any fail. Exports `validateCatalog(catalog)` for the test.
- [x] `test/catalog.test.js` loads `data/catalog.json` and asserts `validateCatalog` returns no problems, and that both `IT` and `GB` have at least 10 entries.
- [x] `.github/workflows/catalog-health.yml`: weekly cron plus manual dispatch, runs `node tools/check-catalog.mjs --fetch`, and on failure opens (or updates a single open) issue titled "Catalog health: N feeds failing" with the table, labelled `needs-triage`. Use `gh` with `GITHUB_TOKEN`.
- [x] Gates green. Do not touch the main `ci.yml`. (`npm test`, Biome `ci`, `check-imports` green; `npm run typecheck` fails on this branch for a pre-existing reason, see Notes.)

## Notes

### Schema (`data/catalog.json`)

```
{ version: 1,
  categories: ["news","politics","business","technology","science","culture","sport","local"],
  publications: [{ id, name, country, language, category, feedUrl, siteUrl, truncated, note? }] }
```

- `id` slug `^[a-z0-9]+(-[a-z0-9]+)*$`, unique. `feedUrl` unique as well.
- `country` ISO 3166-1 alpha-2 upper case, `language` ISO 639-1 lower case,
  both checked offline with `Intl.DisplayNames` (fallback `none`), minus the
  two-letter codes ICU names that ISO does not assign (`ZZ`, `UK`, `EU`, `UN`,
  user-assigned ranges).
- `feedUrl` and `siteUrl` must parse as URLs with the `https:` scheme.
- `category` must appear in the file's own `categories`, which must itself be
  a duplicate-free subset of the eight known Categories.
- No unknown keys, at the top level or in an entry.

### Exported interfaces (`tools/check-catalog.mjs`, named exports only)

- `validateCatalog(catalog) -> Problem[]` where `Problem = { where, message }`
  and `where` is the entry `id` (or `publications[i]` / `catalog`).
- `CATEGORIES` — the eight Category strings.
- `feedKind(body) -> "rss" | "atom" | "rdf" | "json" | null` — root sniffing
  used by `--fetch`; reusable by anyone who needs a cheap "is this a Feed" test.
- `fetchCatalog(catalog, fetchImpl?) -> Promise<FetchResult[]>` and
  `renderTable(results) -> string` (Markdown, failures first).

### Entry counts

Thirty Publications, all thirty Feeds fetched with `curl` and read on
2026-09-07, and all thirty pass `--fetch` (0 failing).

| Category   | IT | GB |
| ---------- | -- | -- |
| news       | 5  | 4  |
| politics   | 2  | 2  |
| business   | 1  | 1  |
| technology | 2  | 2  |
| science    | 2  | 2  |
| culture    | 1  | 2  |
| sport      | 1  | 1  |
| local      | 1  | 1  |
| **total**  | 15 | 15 |

Truncated: IT 8 of 15, GB 9 of 15. Nature is the one RDF (RSS 1.0) Feed; all
others are RSS 2.0.

### Omissions (full table with reasons in `docs/catalog.md`)

- IT: Corriere della Sera (front-page Feed not advertised; advertised
  `ultimora.xml` is an empty file), Il Post and Fanpage (403 to every
  non-browser client), Rai News (listing page is client-rendered), La Gazzetta
  dello Sport (only section Feeds advertised), Il Giornale, Le Scienze,
  Avvenire, Milano Finanza, Tuttosport (no Feed found), Il Messaggero,
  Il Manifesto, Sky Sport (Feed works but is not linked), Internazionale
  (front-page Feed carries three Items).
- GB: The Times (no Feed), The Telegraph, Financial Times, The Economist (Feed
  works, but the sites answer 402/403 so the advertisement cannot be shown),
  New Statesman and TLS (403), The Spectator, Prospect, PoliticsHome (no Feed
  found), New Scientist (406 for `Mozilla/5.0` agents and for its help pages),
  The Register and Sky Sports (Feed works, no link found), Wired UK (now the US
  Feed), ITV News (connection refused).

### Decisions the spec left open

- Health-check user agent is `Edicola catalog health check
  (+https://github.com/nocfer/edicola)`, deliberately not a browser string:
  New Scientist answers 406 to `Mozilla/5.0` non-browsers. The app's own
  fetcher (ticket 04) is unaffected; this is only the CI check.
- Il Sole 24 Ore uses its `economia.xml` section Feed because the site
  publishes no front-page Feed; the `note` says so.
- Il Foglio's Feed is served from `naxos.ilfoglio.it`, the publisher's own API
  host, linked from `ilfoglio.it/rss`. It carries full text in `description`.
- The workflow also closes the open `Catalog health:` issue when a later run
  passes; the ticket only asked for open-or-update. It creates the
  `needs-triage` label with `--force` first so a fresh repository works.
- The Markdown table printed by `--fetch` ends with the line
  `N feeds failing out of M.`; the workflow greps that line for the title.

### Gates on this branch

- `npm test` 0, Biome `ci` 0 (two infos about migrating `biome.json`, not
  mine), `node tools/check-imports.mjs` 0.
- `npm run typecheck` exits 1 with TS18003 "No inputs were found": `jsconfig`
  includes only `src/**`, which does not exist until ticket 01 merges. Not
  caused by and not fixable from this ticket. `tools/check-catalog.mjs` and
  `test/catalog.test.js` type-check clean when passed to `tsc --checkJs`
  directly with the same options.
- `check-imports` likewise throws ENOENT on a bare checkout of this branch
  because it `readdirSync`s `src/`; with an empty `src/` present it passes and
  resolves `test/catalog.test.js`'s import of `../tools/check-catalog.mjs`.

### For the integrator

- Nothing to add to `SHELL` in `sw.js`: `data/catalog.json` is data the
  Publications screen (ticket 02 or later) will fetch; whoever wires it decides
  whether to precache it.
- `test/catalog.test.js` reads `data/catalog.json` with `readFileSync`, no
  import attributes, so it works on Node 20 and 22.
