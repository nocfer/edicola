# 13 — Docs and release: README in both Languages, contribution guide, self-hosted Proxy, health check on the real parser

**What to build:** A reader-facing README in English and Italian, a
contributor guide, a one-click self-hosted Proxy recipe (Cloudflare Worker)
linked from Settings, and the Catalog health check upgraded to use the real
`parseFeed` so it catches what the app would fail on.

**Blocked by:** 12 — merged. Ticket 11 (Saved, Reading Position, Eviction) is
running **in parallel**; you share no files with it. Describe Saved and
Eviction from `CONTEXT.md`, the ADRs and the spec, and say in your final message
anything you could not verify against running code.

**Status:** done

**Owns:** `README.md`, `README.it.md`, `CONTRIBUTING.md`,
`docs/self-hosted-proxy.md`, `tools/check-catalog.mjs` (upgrade only),
`.github/workflows/catalog-health.yml` (if the upgrade needs it).

- [x] `README.md` and `README.it.md` (linked to each other at the top as in SkyHue): what Edicola is, what it is not (ADR-0004 in plain words), how to install it as a PWA, how it works offline, privacy (ADR-0009), how to run locally, how to add a Publication, licence.
- [x] `CONTRIBUTING.md`: the four gates, the fixture-first rule, the glossary and ADR discipline, the Catalog rules, how tickets work in `.scratch/`.
- [x] `docs/self-hosted-proxy.md`: a minimal Cloudflare Worker (or equivalent free tier) that forwards GET requests with CORS headers, restricted to the reader's own origin, with deploy steps and the exact template string to paste into Settings. Settings' link anchor from ticket 12 resolves.
- [x] `tools/check-catalog.mjs --fetch` parses each Feed with `parseFeed` from `src/feed.js` (using the Node DOM helper) and reports Item counts, so a Feed that returns 200 but no Items is flagged.
- [x] Gates green.

## Integrator notes (read before starting)

- **`README.md` must contain a `## Self-hosting the Proxy` heading.** The
  Settings screen already links to `./README.md#self-hosting-the-proxy` and that
  anchor has no target today. This is the single most load-bearing thing in the
  ticket, because of the next point.
- **The default relay is fragile, and the README is the mitigation.** Checked on
  2026-09-07: `corsproxy.io` now requires an API key, `api.allorigins.win` and
  `api.codetabs.com` answered Cloudflare 522 for twenty minutes, and
  `api.cors.lol` rate-limited every request including the first. The default is
  a small community Cloudflare Worker exported as `DEFAULT_PROXY_TEMPLATE` /
  `DEFAULT_PROXY_SERVICE` in `src/fetcher.js`, and it can disappear without
  notice. Write the self-hosting section as the path a reader should actually
  take, not as an appendix. Also document that the default relay rewrites
  `content-type` to `text/plain`.
- **Be accurate about what Edicola does not do** (ADR-0004), in plain language a
  reader understands: it fetches what the publisher serves an anonymous visitor
  and strips the clutter, it does not get past a paywall, and it never claims to
  publish the content. Do not oversell offline either: read
  `.scratch/edicola-v1/issues/15-known-gaps.md`, which records exactly what was
  and was not verified.
- **The privacy claim is precise** (ADR-0009): nothing leaves the device except
  the Feed and Original requests the reader asked for, plus the Proxy fallback
  those requests go through. There is no analytics and no error reporting. Say
  that the default relay does see the URLs being fetched, which is the honest
  reason to self-host.
- `CONTRIBUTING.md` should carry the five gates, the fixture-first rule, the
  glossary and ADR discipline, the Catalog rules from `docs/catalog.md`, and how
  tickets work under `.scratch/`. The hard-won rules in
  `.scratch/edicola-v1/AGENT-RULES.md` are worth folding in for humans too.
- For the `--fetch` upgrade: `src/feed.js` exports `parseFeed(text, { url,
  DOMParser })` and the Node DOM helper is `tools/testing/dom.js`. That helper
  needs the on-demand install, so guard the import and print a clear message if
  the dependency is missing rather than crashing the workflow.
- The five gates now include `test/styles-structure.test.js`; do not remove it.

## Notes

### Files

- New: `README.it.md`, `CONTRIBUTING.md`, `docs/self-hosted-proxy.md`.
- Rewritten: `README.md` (was the four-section developer stub).
- Upgraded: `tools/check-catalog.mjs`.
- One line of scope beyond the ownership list: `.github/workflows/catalog-health.yml`
  gained a `node tools/ensure-test-deps.mjs` step (the ticket allowed this
  "if the upgrade needs it" — it does, or CI would silently run the sniff-only
  fallback), and its header comment now says the check parses.
- Nothing to add to `SHELL` in `sw.js`; no `src/` file was touched.
  `stamp:check` is green as inherited (`edicola-ddec8b6f`).

### `README.md#self-hosting-the-proxy` resolves

The heading is `## Self-hosting the Proxy`, exactly the anchor
`src/views/settings.js` links to (`SELF_HOST_URL`). The section is written as
the path a reader should take, not an appendix: it names the default relay in
full, says it is somebody's free side project that can rate-limit or vanish,
records what every alternative was doing on 2026-09-07, documents that the
default rewrites `content-type` to `text/plain` (and that Edicola copes by
sniffing the root element), then sends the reader to
`docs/self-hosted-proxy.md`. The last paragraph states the cost of keeping the
default in one sentence: one third party learns which articles you open.

### `tools/check-catalog.mjs`

- New exports: `loadDomParser()` (returns the jsdom `DOMParser` or `null`).
  `fetchCatalog(catalog, fetchImpl?, DomParser?)` gained a third parameter.
  `FetchResult` gained `items: number|null`.
- `renderTable` has a sixth column, `Items`, placed **after** `Detail` so
  ticket 06's `renderTable` assertions in `test/catalog.test.js` still match
  (they are prefix regexes over the first four cells). `— ` is printed when no
  count exists. The trailing `N feeds failing out of M.` line the workflow
  greps is unchanged.
- Three new failure modes, each verified with a scripted fake fetch:
  a 200 that parses to zero Items (`rss with no Items`, `Items 0`), a 200 that
  `parseFeed` rejects (`does not parse: malformed-xml`), and the pre-existing
  `not a feed` sniff failure. Verified with jsdom hidden that `loadDomParser()`
  returns `null` and the run degrades to sniffing with a printed warning
  instead of throwing.
- The import of `parseFeed` is static (`src/feed.js` is a pure module with no
  imports of its own); only the DOM helper is dynamic, because it needs the
  on-demand install. `tools/check-imports.mjs` does not scan `.mjs`, so this
  crossing of the `tools/` → `src/` line is unchecked by that gate; it is
  covered by the tool running in `npm test` via `test/catalog.test.js`.

### The Worker in `docs/self-hosted-proxy.md`

Complete module-syntax Worker: `Origin` allowlist, `OPTIONS` handled, GET only,
`http`/`https` targets only, upstream `content-type` preserved, body streamed
through. Deliberately no timeout (the app's fetcher aborts at 15 s), no cache,
no size cap (the fetcher caps image bytes itself). Deploy steps use the
dashboard so nothing must be installed; `wrangler` is mentioned without pinning
a scaffolding command, because those change between major versions. The page
says plainly that an `Origin` check is not authentication and that an origin
covers a whole host, so `*.github.io` in the allowlist covers every project on
that subdomain.

### Written from documents, not from running code

Ticket 11 was running in parallel, so **Saved, Reading Position and Eviction
are described from `CONTEXT.md`, the spec and ticket 12's Eviction seam**, not
observed. Both READMEs claim only what those documents guarantee: a Saved Item
and its Article are never Evicted, and Retention limits are what bound storage.
Neither README mentions the Saved screen's behaviour or a Reading-Position
restore in any detail.

Softened or left out on purpose, per ticket 15:

- **Install prompt.** Both READMEs say to use the browser's own install command
  and that the app never prompts. There is no in-app install UI in the code
  (`beforeinstallprompt` appears nowhere), and the prompt has not been verified
  on a real device.
- **Offline.** The claim is "what was fetched is there, what was not is not",
  plus the two caveats from ticket 15: Feed thumbnails are not stored and hide
  themselves on a cold cache, and Article images are stored as blobs and do
  appear. No claim is made about `navigator.storage.persist()` returning true;
  the text says browsers grant persistence as a site earns engagement and that
  Edicola asks again after a refusal, which is what `sync-client.js` does.
- **Retention numbers** are `DEFAULT_RETENTION` as frozen in `src/retention.js`
  (30 days, 500 MB, 5 MB images per Article, 50 Items per Publication) and the
  Pre-fetch count is the same file's `prefetchPerPublication: 10`.
- **"Seventeen of thirty Feeds are Truncated"** comes from ticket 06's counts
  (IT 8, GB 9) and is the one arithmetic claim in the README.
- No hosted URL is named anywhere: this repository has no CNAME and no Pages
  URL, so both READMEs say "any static host, GitHub Pages included" instead of
  inventing an address.
- `CONTRIBUTING.md` originally described `test/styles-structure.test.js` as
  flagging duplicate top-level selectors. It does not — it asserts a top-level
  rule per screen anchor, brace balance, and the reduced-motion reset — so the
  text was corrected, and the duplicate-selector rule now says plainly that no
  gate catches them.
- `docs/catalog.md` (ticket 06's file) still describes `--fetch` as sniffing
  only. It was left untouched to avoid an edit outside this ticket's ownership;
  `CONTRIBUTING.md` documents the current behaviour. **Two bullets in
  `docs/catalog.md`'s "The health check" section are now understated** and are
  worth one integrator edit.

### Gates and checks (all from this worktree)

```
npm test                              0   (249 tests, 0 fail)
biome format --write . && biome ci .  0   (2 infos: migrate biome.json, pre-existing)
npm run typecheck                     0
node tools/check-imports.mjs          0
npm run stamp:check                   0   (edicola-ddec8b6f)
node tools/check-catalog.mjs          0   (30 Publications, schema clean)
node tools/check-catalog.mjs --fetch  0   (0 feeds failing out of 30)
```

No Catalog Feed has died since ticket 06 added it. All thirty answer 200, sniff
as a Feed and parse to a non-empty Item list: the smallest is Sky News, Galileo
and NME at 10 Items, the largest Physics World at 160. `data/catalog.json` was
not edited.
