# 13 — Docs and release: README in both Languages, contribution guide, self-hosted Proxy, health check on the real parser

**What to build:** A reader-facing README in English and Italian, a
contributor guide, a one-click self-hosted Proxy recipe (Cloudflare Worker)
linked from Settings, and the Catalog health check upgraded to use the real
`parseFeed` so it catches what the app would fail on.

**Blocked by:** 12 (and everything before it).

**Status:** ready-for-agent

**Owns:** `README.md`, `README.it.md`, `CONTRIBUTING.md`,
`docs/self-hosted-proxy.md`, `tools/check-catalog.mjs` (upgrade only),
`.github/workflows/catalog-health.yml` (if the upgrade needs it).

- [ ] `README.md` and `README.it.md` (linked to each other at the top as in SkyHue): what Edicola is, what it is not (ADR-0004 in plain words), how to install it as a PWA, how it works offline, privacy (ADR-0009), how to run locally, how to add a Publication, licence.
- [ ] `CONTRIBUTING.md`: the four gates, the fixture-first rule, the glossary and ADR discipline, the Catalog rules, how tickets work in `.scratch/`.
- [ ] `docs/self-hosted-proxy.md`: a minimal Cloudflare Worker (or equivalent free tier) that forwards GET requests with CORS headers, restricted to the reader's own origin, with deploy steps and the exact template string to paste into Settings. Settings' link anchor from ticket 12 resolves.
- [ ] `tools/check-catalog.mjs --fetch` parses each Feed with `parseFeed` from `src/feed.js` (using the Node DOM helper) and reports Item counts, so a Feed that returns 200 but no Items is flagged.
- [ ] Gates green.
