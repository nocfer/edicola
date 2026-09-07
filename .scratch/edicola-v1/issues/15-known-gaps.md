# 15 — Known gaps carried forward

Not a ticket to implement on its own; a checklist the remaining tickets must
close. Each line names the ticket that owns it.

**Status:** ready-for-human

- [ ] **Ticket 13:** `README.md` needs a `## Self-hosting the Proxy` heading.
      Settings links to `./README.md#self-hosting-the-proxy` and the anchor has
      no target today. The default relay is a small community Cloudflare Worker
      that can vanish, so this section is load-bearing, not decorative.
- [ ] **Ticket 13:** document that proxied responses arrive with their
      `content-type` rewritten to `text/plain` by the default relay.
- [ ] **Ticket 11:** Eviction is not wired. `runSync` trims per Publication
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
