# 13 — Docs and release: README in both Languages, contribution guide, self-hosted Proxy, health check on the real parser

**What to build:** A reader-facing README in English and Italian, a
contributor guide, a one-click self-hosted Proxy recipe (Cloudflare Worker)
linked from Settings, and the Catalog health check upgraded to use the real
`parseFeed` so it catches what the app would fail on.

**Blocked by:** 12 — merged. Ticket 11 (Saved, Reading Position, Eviction) is
running **in parallel**; you share no files with it. Describe Saved and
Eviction from `CONTEXT.md`, the ADRs and the spec, and say in your final message
anything you could not verify against running code.

**Status:** ready-for-agent

**Owns:** `README.md`, `README.it.md`, `CONTRIBUTING.md`,
`docs/self-hosted-proxy.md`, `tools/check-catalog.mjs` (upgrade only),
`.github/workflows/catalog-health.yml` (if the upgrade needs it).

- [ ] `README.md` and `README.it.md` (linked to each other at the top as in SkyHue): what Edicola is, what it is not (ADR-0004 in plain words), how to install it as a PWA, how it works offline, privacy (ADR-0009), how to run locally, how to add a Publication, licence.
- [ ] `CONTRIBUTING.md`: the four gates, the fixture-first rule, the glossary and ADR discipline, the Catalog rules, how tickets work in `.scratch/`.
- [ ] `docs/self-hosted-proxy.md`: a minimal Cloudflare Worker (or equivalent free tier) that forwards GET requests with CORS headers, restricted to the reader's own origin, with deploy steps and the exact template string to paste into Settings. Settings' link anchor from ticket 12 resolves.
- [ ] `tools/check-catalog.mjs --fetch` parses each Feed with `parseFeed` from `src/feed.js` (using the Node DOM helper) and reports Item counts, so a Feed that returns 200 but no Items is flagged.
- [ ] Gates green.

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
