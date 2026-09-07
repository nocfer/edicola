# 06 — Catalog: seed Publications for Italy and the United Kingdom, validated and health-checked

**What to build:** The Catalog data file with roughly 10 to 15 real
Publications per Nation for Italy and the United Kingdom across Categories, a
documented entry schema and contribution rules, an offline schema validator
run in tests, and a weekly GitHub Actions job that fetches every Feed and opens
an issue when one fails. No UI.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Owns:** `data/catalog.json`, `docs/catalog.md`, `tools/check-catalog.mjs`,
`test/catalog.test.js`, `.github/workflows/catalog-health.yml`.

- [ ] Entry schema: `{ id (slug, unique), name, country (ISO 3166-1 alpha-2), language (ISO 639-1), category (one of: news, politics, business, technology, science, culture, sport, local), feedUrl (https), siteUrl (https), truncated (boolean), note (optional, English) }`. Top level: `{ version: 1, categories: [...], publications: [...] }`.
- [ ] Only publicly advertised Feeds (linked from the site or its help pages). No member-area feeds, no unofficial mirrors. Prefer the Publication's main national/front-page Feed. For each entry, `curl` the Feed once and set `truncated` by inspecting whether Items carry full content or a teaser; record what you saw in `note` where useful.
- [ ] Italy: cover national dailies and magazines across Categories (news, politics, business, technology, culture, sport, science). United Kingdom: same spread. 10 to 15 each. If a major Publication publishes no Feed, leave it out and say so in `docs/catalog.md`.
- [ ] `docs/catalog.md`: the schema, the rules above, how to propose a Publication by pull request, what the health check does, and the explicit statement that Edicola links to and extracts only what publishers serve publicly (ADR-0004).
- [ ] `tools/check-catalog.mjs`: offline mode validates schema, unique ids, valid codes, https URLs, categories from the list; exits 1 with a per-entry message on failure. `--fetch` mode additionally requests every `feedUrl` (concurrency 4, 15 s timeout) and checks the response is 200 and looks like a feed (root `rss`, `feed`, `rdf:RDF`, or JSON with `items`), printing a table and exiting 1 if any fail. Exports `validateCatalog(catalog)` for the test.
- [ ] `test/catalog.test.js` loads `data/catalog.json` and asserts `validateCatalog` returns no problems, and that both `IT` and `GB` have at least 10 entries.
- [ ] `.github/workflows/catalog-health.yml`: weekly cron plus manual dispatch, runs `node tools/check-catalog.mjs --fetch`, and on failure opens (or updates a single open) issue titled "Catalog health: N feeds failing" with the table, labelled `needs-triage`. Use `gh` with `GITHUB_TOKEN`.
- [ ] Gates green. Do not touch the main `ci.yml`.
