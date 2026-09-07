# 15 — Known gaps carried forward

Not a ticket to implement on its own; a checklist the remaining tickets must
close. Each line names the ticket that owns it.

**Status:** ready-for-human

- [x] **Ticket 13:** `README.md` needs a `## Self-hosting the Proxy` heading.
      Settings links to `./README.md#self-hosting-the-proxy` and the anchor has
      no target today. The default relay is a small community Cloudflare Worker
      that can vanish, so this section is load-bearing, not decorative.
- [x] **Ticket 13:** document that proxied responses arrive with their
      `content-type` rewritten to `text/plain` by the default relay.
- [x] **Ticket 11:** Eviction is not wired. `runSync` trims per Publication
      only. Ticket 12 left a named seam that Settings calls when Retention
      limits shrink; connect it.
- [ ] **Ticket 12's leftovers:** `settings.about.shell` is an unused key (the
      Shell `CACHE` is not readable from the page) and
      `settings.storage.rows` is not pluralized.
- [ ] **Unverified in headless Chrome, needs a real device:** the install
      prompt, `env(safe-area-inset-*)` on a notched phone,
      `navigator.storage.persist()` returning true, and "all tabs reload
      together" on update.
- [ ] **Pre-existing duplicate top-level CSS selectors** inherited across
      tickets: `.btn`, `.pub`, `.pubs__field`, `.switch`, `.tabbar`,
      `.settings__about`, `.settings__error`, `.settings__ok`. CLAUDE.md warns
      that a second era of one selector silently shadows the first. Worth a
      pass once the screens are done. The merge-introduced `.input` duplicate
      is already collapsed.

## Offline verification done at the integration level (2026-09-07)

Neither the Shell ticket nor any screen ticket owns proving the product's
central claim across screens, so the integrator ran it after merging ticket 14.

Method: one Chrome profile, primed online against two real Catalog Publications
(84 Items, 17 Articles, 39 images stored; 47 entries in the Shell cache), then
the static server was killed and the same profile reloaded twice.

Confirmed with the origin unreachable:

- The app boots, the service worker is in control, and the Shell is served from
  the Cache API.
- Today renders 82 cards with day sections, filter chips and Unread counts,
  read from IndexedDB.
- Publications renders 15 rows from the cached `data/catalog.json`.

Two caveats, stated precisely so nobody over-reads the result:

- **`navigator.onLine` was still `true`.** Only the origin was unreachable, not
  the network interface, so this exercises Shell caching and stored content but
  **not** the offline-specific UI (the Offline chip and the offline empty
  state). Those were verified separately by ticket 09 with emulated conditions.
- **Feed thumbnails appeared, but that is not evidence they work offline.**
  Thumbnails are deliberately not stored (ticket 09); these were served from
  Chrome's own HTTP cache because the profile was reused from the online run. On
  a cold cache they hide themselves, which is the intended behaviour. Article
  images are a different matter: those are stored as blobs, and ticket 10 is
  proving them with the server down.


## Closed and still open, after every ticket merged (2026-09-07)

Closed since this list was written: the README anchor and the relay caveat
(ticket 13), Eviction (ticket 11), the two settings layers (ticket 14), and the
`.input` duplicate plus the media-query nesting damage (integrator, now guarded
by `test/styles-structure.test.js`).

Found late and worth knowing:

- **The Retention card governed nothing until ticket 11 fixed it.**
  `syncNow` never passed the stored limits into `runSync`, so every Sync used
  the defaults. `prefetchPerPublication` and `maxImageBytesPerArticle` are
  therefore **newly live** and have had far less real-world exercise than the
  rest of the pipeline.
- **`maxTotalBytes` has never fired against real data.** It is unit tested four
  ways, but the test corpus never approached 50 MB, let alone the 500 MB
  default. The first reader to fill their quota is the first real test.

Still open, and each needs a real device rather than headless Chrome:

- [ ] The install prompt, and `env(safe-area-inset-*)` on a notched phone.
- [ ] `navigator.storage.persist()` returning true. Headless Chrome always
      refuses, so only the "not granted" path has ever rendered. Without a grant
      the browser may evict the database, which is the one failure that breaks
      the offline promise silently.
- [ ] A successful `navigator.share` and clipboard copy. Only the failure path
      has been observed, because headless Chrome refuses both without a user
      gesture.
- [ ] Pull-to-refresh with real fingers. Proven only with synthetic touch
      events.
- [ ] "All tabs reload together" on update. Reasoned from `clients.claim()`,
      but the harness drives one tab.
- [ ] An Article whose image blob is missing, falling back to the network.
      Unit tested only; every sampled Article had all its images stored.

Still open, and doable at a desk:

- [x] **Duplicate top-level CSS selectors** inherited across tickets. Gated and
      collapsed — see "The desk-doable items, closed" below.
- [x] `settings.about.shell` is an unused i18n key, and
      `settings.storage.rows` is not pluralized.
- [x] The Today filter chips each carry their own overflow button, so the chip
      row wraps awkwardly once two or three Publications are on. Cosmetic.
- [ ] A pre-existing dev database keeps a dead `selectedNations` row after
      ticket 14 renamed the key, and re-infers its Nations once. **Deliberately
      left.** ADR-0008 makes migrations additive only, so a migration for a key
      that never shipped would be permanent code paying off nothing: there are
      no installs holding the row except developer profiles, and the re-infer
      costs one pass. If a shipped install ever needs it, the place is still
      `read()` in `createSettingsStore`.

## The desk-doable items, closed (2026-09-07)

**CSS duplication is now gated.** `test/styles-structure.test.js` grew a test:
for every selector declared by more than one top-level rule, no property may be
declared twice unless the two rules are adjacent. Adjacency is the line between
the deliberate shape (`h1…h6`, then `h3…h6` smaller — both on screen at once)
and a second era hundreds of lines away that a reader of the first block never
sees. At-rules are skipped, since a token block redefining the same custom
properties under `[data-theme]` is the point of an at-rule.

**Be precise about what that does not cover.** The gate keys on the literal
selector string, so it catches only the *same* selector declared twice. A more
specific selector shadowing a general one is invisible to it — and this very
change adds one: `.today__chipwrap .chip { background: transparent }` beats
`.chip--on { background: var(--chip-on-bg) }` from 400 lines away, which is
exactly why the pressed state is also set on the wrap. That shape is normal,
intentional CSS and gating it would flag every scoped override, so it stays a
reading job. CLAUDE.md gotcha 9 and CONTRIBUTING.md's merge checklist were both
corrected to say so rather than to advertise coverage that does not exist.

What the gate found, and what the named list was worth:

- **`.pubs__field .input` was the only real one, and it was worse than a
  duplicate.** Two rules 28 lines apart both set `flex`, so the first never
  applied. Its own comment said it was for "the Publications add-by-URL row" —
  but that row is `.pubs__addrow`, not `.pubs__field`, so the rule had been
  aimed at the wrong element from the start. Retargeted to
  `.pubs__addrow .input`, which is a **visible change**: the URL input now grows
  to fill its row next to "Find Feeds" instead of sitting at its intrinsic
  width.
- **`.pub`, `.switch` and `.tabbar` were not duplicated at all** — the list was
  stale, collapsed by an earlier ticket without the line being struck.
- **`.settings__about`, `.settings__error`, `.settings__ok` are the legitimate
  shape**: a shared rule immediately followed by the per-selector difference,
  no property declared twice. Left as they are; the gate agrees.
- **`.btn` was a genuine second era** but not a property clash: the base block
  sat near the top and `--danger`, `:disabled`, `:disabled:active` arrived 500
  lines later with the Settings screen. Moved up with the rest of the button
  block, and the `.input` variants (`[aria-invalid]`, `--number`, `:disabled`)
  likewise. Relative order was preserved, so the cascade is unchanged.

**Plurals.** `i18n.js` had no plural mechanism, and `settings.storage.rows` was
one of many counted keys reading "1 rows". Added `tCount(key, count, params)`,
which picks `<key>.one` / `<key>.other` via `Intl.PluralRules` for the current
Language and interpolates `{count}`. Ten keys converted in both dictionaries:

- `settings.storage.rows`, `pubs.add.items`, `sync.failed`, `reader.words`,
  `saved.count`, `pubs.groupAria`, `settings.retention.evicted`.
- `pubs.enabledCount` — Italian "{count} di {total} attive" inflects on the
  enabled count, so "1 di 1" read "attive" where it wants "attiva". English
  ("of {total} on") does not inflect, so both forms are identical there, as
  they are for `saved.count`.
- `today.emptyFilter` and `today.bounded` — `maxAgeDays` has `min: 1`
  (`RETENTION_BOUNDS`), so a reader who sets Days kept to 1 saw "the last 1
  days" / "negli ultimi 1 giorni". Their singular forms drop the number
  entirely ("the last day", "nell'ultimo giorno"), which is the only way
  Italian reads correctly and is better English too.

`test/i18n.test.js` now fails a lone form, or a dead stem left beside the forms.

Two counted keys deliberately keep a single entry:

- `today.unreadCount` — "1 unread" and "1 da leggere" are both correct, so forms
  would be two identical entries per Language. Converting it later means moving
  its two callers (`views/today.js`, `views/publications.js`) to `tCount` in the
  same commit: they use plain `t()`, and once the dictionary holds only forms,
  `t()` would render the literal string `today.unreadCount`. The sibling test
  forbids keeping a bare stem as a safety net, deliberately — a stem beside the
  forms is dead weight that hides exactly this.
- `sync.summary` carries three counts in one string ("{items} Items,
  {articles} Articles, {images} images"). One category per call cannot express
  it; splitting the string is a copy decision, not a mechanical one.
- `sync.feeds` and `sync.articles` ("Feeds {done} of {total}") are progress
  labels, where the noun counts the whole set and does not follow `{done}`.

**`settings.about.shell` removed** rather than wired. It was copy for a third
About row showing the Shell stamp, which the page cannot read from `sw.js`. It
*is* reachable — `caches.keys()` returns `edicola-<hash>` — but adding a row is
a feature this checklist did not ask for, so the dead copy went and the intent
is recorded here instead.

**The Today chip row is one pill per Publication.** `.today__chipwrap` now
carries the border and fill and the two buttons inside are segments divided by a
hairline, with `--on` set on the wrap as well as the chip so the pressed pill
fills end to end. The divider needs `border-radius: 0 var(--r-pill)
var(--r-pill) 0`: a border follows the radius, and the pill radius inherited
from `.chip` bent it into a visible arc.

Verified in headless Chrome against a seeded database (3 Publications, 15
Items) on a throwaway profile, in both themes and both Languages: the chip row
pressed and unpressed, the overflow menu open, Settings' moved `.input` and
`.btn` variants, the Storage table's row counts, and `tCount` returning Italian
singulars in the live page. Still subject to gotcha 3 — none of this is covered
by a test.
