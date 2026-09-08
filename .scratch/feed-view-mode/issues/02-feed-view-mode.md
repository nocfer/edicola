# 02 — Feed View Mode: the toggle, the rings row, the post cards

**What to build:** Today's second presentation. A segmented control in the
header switches List ↔ Feed. In Feed mode the filter chip row becomes a row of
Publication rings, and the day-grouped list becomes one column of full-bleed
post cards with an action bar, ending in an "all caught up" card. Every empty,
offline and refreshing state the list already has must exist here too.

Rings are tappable but open nothing yet — ticket 03 builds the Story player.
Until then a tap falls through to the filter, which is what the no-reel state
does permanently, so this ticket ships coherent on its own.

**Blocked by:** 01.

**Status:** ready-for-agent

**Owns:** `src/views/today.js`, `src/today-model.js`,
`test/today-model.test.js`, strings under `today.*` in `src/i18n.js`, the
`/* Today */` block in `src/styles.css`, `SCREEN_ANCHORS` in
`test/styles-structure.test.js`. Amends `CONTEXT.md` and, if it repeats the
same claim, `CONTRIBUTING.md`.

- [ ] **The toggle.** A two-icon segmented control (list / feed) in Today's
      screen header beside the refresh control, using the existing `seg`
      primitive. `aria-pressed` on each, both labelled. Writes
      `update({ viewMode })`; `main.js` persists it (ticket 01).
- [ ] **Model, not view.** Extend `buildTodayModel` so Feed mode's shape is
      computed in `today-model.js` and unit tested: a flat newest-first card
      list with no day sections, each card carrying its cover kind, monogram,
      ramp index, relative-time key and Unread flag; plus the ring row with
      each Publication's ring state. The view renders; it decides nothing.
- [ ] **Three ring states**, distinguishable without relying on colour alone
      (board 09): **unseen** — has Unread Items, ring highlighted; **seen** —
      every Item in the reel is Seen, ring dimmed; **no reel** — nothing
      Unread, flattest, and a tap filters instead of opening a Story. Assert
      all three in the model test, including the transition an Item's `seen`
      flag causes.
- [ ] **The rings row replaces the chips**, in the same vertical space, one
      horizontal scroller. Long-press (`contextmenu`) and a small ⋯ open the
      menu Today already has — "show only this Publication" and "mark all
      read" — reusing `toggleMenu` / `markAllRead` rather than a second
      implementation.
- [ ] **Post cards.** Header row (32px monogram avatar, Publication name,
      relative time, Unread dot), then the image at 4:5, then the action bar,
      then headline and Summary clamped to three lines. Draw all three image
      variants from board 01: real photo, generated Cover with the headline set
      over it, and photo-with-Summary-only-badge.
- [ ] **The Cover variant puts the headline *on* the cover** and therefore
      omits it below (board 01's London Review card) — the headline appears
      once, not twice. The photo variant does the opposite. Get this right; it
      is the detail that makes the two variants read as one system.
- [ ] **Action bar: Save / Share / Original**, 44px targets, `--r-pill`, Save
      filled when Saved. Reuse the Reader's handlers (`src/views/reader.js`
      already has all three, including the Web Share call with its clipboard
      fallback) — do not write a second copy.
- [ ] **No likes, no comments, no counts.** Nothing on this screen may display
      an engagement number.
- [ ] **No sticky day headers in Feed mode.** Each card's relative time does
      that work. Keep them in List mode exactly as they are.
- [ ] **End card.** The Retention bound becomes a centred "you're all caught up
      · showing the last N days", `N` from `model.windowDays`, pluralised
      through `tCount`. It is the same honest statement the list's `today.bounded`
      line makes, so reuse that value rather than hardcoding 30.
- [ ] **Every state Feed mode can land in** (boards 02–05): offline with mostly
      Covers, no Enabled Publications, a filter with nothing behind it,
      never-Synced, and refreshing with the progress bar. `emptyBody` already
      enumerates these for the list — Feed mode must not quietly have fewer.
- [ ] **Pull-to-refresh and the scroll memory keep working.** Both are window
      listeners installed once in `today.js`; neither should care which View
      Mode is on. Check the scroll restore still lands after a trip to the
      Reader when Feed mode is active — the list's height differs, and the
      restore waits two frames for lit to fill.
- [ ] **Both dictionaries.** New keys under `today.*` in `en` **and** `it`.
      Board 13 exists because Italian runs 15–25% longer; if a label wraps or
      truncates, fix the layout, not the copy.
- [ ] **`SCREEN_ANCHORS`.** Add a representative selector for the new CSS block
      (`.feed__card` or whatever you name it) to `test/styles-structure.test.js`.
      CLAUDE.md gotcha 8 exists because a whole screen block once got spliced
      inside an at-rule and every gate passed while the screen rendered
      unstyled.
- [ ] **Variants live with their primitive.** If the ring needs a `.chip`
      variant or the card needs a `.card` variant, it goes in that primitive's
      existing block, not at the bottom next to the feed rules (gotcha 9).
- [ ] **Amend `CONTEXT.md`:** Today is no longer "a single timeline"; add
      **View Mode**, **Story**, **Frame**, **Seen** and **Cover**. Then grep
      `CONTRIBUTING.md` for the same claim and fix it in this commit — the two
      files move together, and review has already caught them drifting once.
- [ ] **CDP screenshots** of Feed mode in both themes and both Languages, with
      real Synced data, plus one with the network off so the Cover-dominant
      case is seen rather than assumed. Fixed viewport,
      `captureBeyondViewport:false`, throwaway profile after the stamp
      (gotchas 2, 5, 6).
- [ ] **Gates green**, stamp run if `SHELL` changed.

## Notes

- **Board 11 is not work.** It is List mode as it exists today, drawn for
  comparison, with the new toggle set to list. The only change List mode gets
  in this ticket is the toggle appearing in its header.
- **Boards 09 and 10 are component sheets, not screens.** Build the components;
  do not build the sheets. In particular do not reproduce board 10's 11px
  `--cover-n` caption — it is a token name printed for documentation, and it is
  the one thing in the design that fails contrast (spec.md).
- **Offline is the artboard that matters** (board 02). If a Cover-dominant feed
  reads as broken rather than deliberate, the fix is the Cover treatment, not
  more network fetching — the source order in ticket 01 is settled.
- The design's hardcoded hexes are the tokens from `styles.css` §1. Every one of
  them already exists; the ramp from ticket 01 is the only addition. If you
  find yourself typing a hex, you are doing it wrong.
