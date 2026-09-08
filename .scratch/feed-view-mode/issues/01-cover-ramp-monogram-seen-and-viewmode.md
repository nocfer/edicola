# 01 — Cover ramp, monogram, Seen, and the View Mode preference

**What to build:** Everything Feed mode needs that has no visible surface of
its own: the `--cover-1…8` token ramp in both themes, the pure monogram and
ramp-index derivation, the cover image source resolution (stored blob →
publisher URL → generated Cover), the `seen` flag on Items, and the
`viewMode` field on the store with its `localStorage` persistence. Nothing on
screen changes. This ticket is proved by `node --test` alone.

**Blocked by:** nothing.

**Status:** ready-for-agent

**Owns:** new `src/cover.js` and `test/cover.test.js`; the `§1` token block in
`src/styles.css`; the `ItemRow` typedef and `seen` in `src/db.js`;
`markItemSeen` in `src/item-state.js`; `viewMode` in `src/state.js`; the
`VIEWMODE_KEY` read at boot in `src/main.js`; `SHELL` in `sw.js` plus a stamp.

- [ ] **Token ramp.** `--cover-1` … `--cover-8` in the bare `:root` block and
      again in `:root[data-theme='light']`, taking the values the design
      already settled. Dark: `#7a2f22 #6e4a12 #3f5220 #1c5147 #1b4a63 #34406f
      #563066 #6f2a4a`. Light: `#9c3b2a #8d5f18 #52692a #26695c #235f7e
      #43518c #6c3d84 #8b365d`. They go **in the token block**, not beside the
      feed rules that consume them — CLAUDE.md gotcha 9 is exactly about a
      primitive growing a second era next to the screen that needed it.
- [ ] **Scrim token.** `--scrim-ink` (or a name you prefer) defined **once** on
      bare `:root` as the dark `rgba(18,17,16,…)` the design uses, and
      deliberately **not** redefined in the light block, with a comment saying
      why: the Story player is dark in both themes, and a light scrim under
      `--accent-ink` text scores 1.6:1. See spec.md, "the finding that matters".
- [ ] **`src/cover.js`, pure and dependency-free.** `monogramFor(name)` returns
      one or two initials; `coverIndexFor(id)` returns 1–8 from a stable hash of
      the Publication id. No `document`, no `window`, importable under Node.
- [ ] **The monogram rule is stated verbatim on board 09** — implement it, do
      not invent one:

      > Initials of the first two significant words, uppercased. Articles and
      > particles are dropped (la, il, the, of, dello), digits are skipped, an
      > internal capital splits a compound. One significant word left gives its
      > first two letters.

      Particle matching is case-insensitive: `la Repubblica` and `La Stampa`
      both drop theirs. Decide and document what happens when the rule leaves
      nothing — a name that is only particles, or one letter long — rather than
      letting it throw on a Custom Publication someone named "The".
- [ ] **Test every monogram the design commits to.** Read off boards 09 and 10,
      not derived, so changing any of them changes the design:

      | name | expected | path through the rule |
      | --- | --- | --- |
      | `ANSA` | `AN` | one significant word, first two letters |
      | `la Repubblica` | `RE` | drop `la`, then first two letters |
      | `The Guardian` | `GU` | drop `the`, then first two letters |
      | `La Stampa` | `ST` | drop `La`, then first two letters |
      | `Focus` | `FO` | one word |
      | `Nature` | `NA` | one word |
      | `Il Sole 24 Ore` | `SO` | drop `Il`, skip `24`, take Sole + Ore |
      | `Corriere dello Sport` | `CS` | drop `dello` |
      | `BBC News` | `BN` | first letter of each word |
      | `BBC Sport` | `BS` | first letter of each word |
      | `London Review of Books` | `LR` | drop `of`, cap at two |
      | `Manchester Evening News` | `ME` | cap at two |
      | `Rivista Studio` | `RS` | first letters |
      | `TechRadar` | `TR` | an internal capital splits the compound |

      `openDemocracy` → `OD` follows from the compound clause and is worth a
      case; the design's own compound example is `TechRadar`.
- [ ] **Stable hash.** `coverIndexFor` must return the same index for the same
      id across reloads and across devices, so a Publication's colour does not
      change under the reader. Assert two known ids keep their index.
- [ ] **Cover source resolution.** A function in the same module, deps
      injected the way `src/article-render.js` does it (`db`, `imageKeyFor`),
      that answers "what fills this Item's image slot": the stored blob's
      object URL if `imageKeyFor(item.thumbnailUrl)` hits the `images` table,
      else `item.thumbnailUrl`, else a generated Cover. Return a discriminated
      shape (`{ kind: 'blob' | 'network' | 'cover', … }`) so the view has no
      decision left to make, and hand back any object URL created so the caller
      can revoke it — `article-render.js` is the precedent for both.
- [ ] **Test it against a fake `images` table**, as `test/article-render.test.js`
      already does. Cover all three branches plus the case where `bulkGet`
      throws (the feed must still render).
- [ ] **`seen` on Items.** A plain boolean on `ItemRow`, non-indexed — IndexedDB
      stores whole objects and only declared indexes need a version block, so
      this needs **no `db.version(n)` block and no migration**. Document that in
      the typedef next to the existing note about `saved` being `0 | 1` because
      it *is* indexed. `markItemSeen(db, itemId)` beside `markPublicationRead`
      in `src/item-state.js`, tolerant of a row that no longer exists.
- [ ] **`seen` is not `read`.** Add a test asserting `markItemSeen` leaves
      `read` untouched and that a Seen Item still counts as Unread. This is the
      guarantee the whole rings design rests on; CONTEXT.md says "opening marks
      it Read; scrolling past it does not", and a Frame is not an opening.
- [ ] **`viewMode` on the store.** `'list' | 'feed'` on `State`, defaulting to
      `'list'`, with a `ViewMode` typedef. Written through `update()` like
      everything else.
- [ ] **Persistence.** `VIEWMODE_KEY = "edicola.viewmode"`, read in `main.js`'s
      boot block beside `state.theme = readThemePreference()` and written in the
      render side effect, both wrapped in `try/catch` the way the theme is —
      storage can be unavailable and the choice then lasts one session.
      **No `index.html` change and no pre-paint script:** the boot block runs
      before `subscribe(renderApp)`, so nothing paints before `viewMode` is
      seeded and there is no flash to prevent.
- [ ] **`SHELL` and stamp.** `./src/cover.js` goes in the `SHELL` array in
      `sw.js`, then `npm run stamp`. Keep the comment apostrophe-free —
      `tools/stamp-sw.mjs` parses that array by quote characters (gotcha 7).
- [ ] **Gates green:** `node --test`, `npm run stamp:check`, Biome `ci`,
      `npm run typecheck`.

## Notes

- **Eight colours, thirty Publications.** Collisions are intended: the design's
  own note says "the colour is never the identity — the monogram is", and board
  01 deliberately places two Publications on the same fill next to each other.
  Do not add a collision-avoidance pass.
- **Nothing here is visible**, so there is no CDP screenshot criterion. That is
  the point of splitting it out: it merges on tests, and ticket 02 starts from
  a foundation that is already proved.
- The contrast numbers in spec.md were computed from these exact hexes. If you
  change a value, recompute rather than assuming the margin survives.
