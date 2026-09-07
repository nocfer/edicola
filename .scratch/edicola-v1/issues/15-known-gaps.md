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
