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

- [ ] **Duplicate top-level CSS selectors** inherited across tickets: `.btn`,
      `.pub`, `.pubs__field`, `.switch`, `.tabbar`, `.settings__about`,
      `.settings__error`, `.settings__ok`. A second era of one selector silently
      shadows the first, and **no gate catches this** — the structure test
      checks nesting, not duplication.
- [ ] `settings.about.shell` is an unused i18n key, and
      `settings.storage.rows` is not pluralized.
- [ ] The Today filter chips each carry their own overflow button, so the chip
      row wraps awkwardly once two or three Publications are on. Cosmetic.
- [ ] A pre-existing dev database keeps a dead `selectedNations` row after
      ticket 14 renamed the key, and re-infers its Nations once. Harmless with
      no shipped installs; if a migration is ever wanted, the place is `read()`
      in `createSettingsStore`.
