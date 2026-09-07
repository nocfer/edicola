# Edicola

An offline-first news reader with no backend. Pick Publications from a Catalog
grouped by Nation, and the app fetches their full Articles so you can read them
with no connection. Nothing to sign up for, nothing to host. Interface in
English or Italian. *Edicola* is Italian for newsstand.

Plain HTML, CSS and ES modules; no build step. Libraries load pinned from
esm.sh and the service worker keeps the app working offline after the first
load. See `CLAUDE.md`, `CONTEXT.md` and `docs/adr/` for the conventions and
decisions.

## Run

```
npm start          # static server on http://localhost:8000
```

Open <http://localhost:8000/>. ES modules do not load from `file://`.

## Develop

```
npm test                          # node --test (installs jsdom etc. on demand)
npm run format && npm run lint    # Biome
npm run typecheck                 # checkJs
node tools/check-imports.mjs      # every relative import resolves
npm run stamp                     # after any Shell change: re-hash sw.js CACHE
```

Screens are checked visually over the Chrome DevTools Protocol:

```
node tools/screenshot.mjs http://localhost:8000/#/settings out.png --theme dark --lang it
```
