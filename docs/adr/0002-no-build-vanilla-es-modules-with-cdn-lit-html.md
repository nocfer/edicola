---
status: accepted
---
# No build step: vanilla ES modules, lit-html and libraries pinned from a CDN

The app is plain HTML, CSS and ES-module JavaScript served statically. There is
no bundler, no framework, and no committed `node_modules`. Runtime libraries
(lit-html, Dexie, Readability, DOMPurify) load lazily from pinned esm.sh URLs
through one import choke point per library, and the service worker caches that
origin so they work offline after first load. Dev tooling (Biome, TypeScript
`checkJs`) runs via `npx` on demand. This is inherited deliberately from SkyHue,
where it has proven itself: a contributor can clone and open `index.html`, and
"what is deployed" is exactly "what is committed."

## Considered options

- Vite plus React or Svelte and `vite-plugin-pwa`: better DX for large apps and
  Workbox for free, at the cost of a build, a lockfile, and a bundle to debug.

## Consequences

- Static import resolution is checked by `tools/check-imports.mjs` because no
  bundler will catch a bad named import before deploy.
- Only named imports and named exports are used, which is what keeps that check
  sound.
- A library that cannot be loaded as an ES module from esm.sh is not an option.
