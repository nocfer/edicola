# 03 — The Story player

**What to build:** Tapping a Publication's ring in Feed mode opens its Story: a
full-screen, tab-bar-less player showing one Frame per Unread Item, newest
first. Position pips across the top, the Publication's identity and a close ×,
the cover or photo behind a scrim, the headline and Summary over it, and a
visible Read button into the Reader. Advance is manual, always. Showing a Frame
marks the Item **Seen** — never Read.

**Blocked by:** 01, 02.

**Status:** ready-for-agent

**Owns:** the Story player template and its screen state (a new
`src/views/story.js`, or a section of `src/views/today.js` — your call, but a
new module if it passes ~150 lines), the reel selection in
`src/today-model.js`, strings under `story.*` in `src/i18n.js`, the
`/* Story */` block in `src/styles.css`, `SCREEN_ANCHORS`.

- [ ] **The reel is pure.** Reel selection goes in `today-model.js` and is unit
      tested: one Publication's **Unread** Items inside Today's Retention
      window, newest first. A Publication with nothing Unread has no reel and
      its ring is the no-reel state (ticket 02 already renders that).
- [ ] **Manual advance only.** Tap the right third to advance, the left third
      to go back, plus the visible chevron buttons the design puts at the
      vertical centre (board 07). Arrow keys and Escape for parity. **No
      timer, no auto-advance, nothing that moves on its own.**
- [ ] **Pips are a position indicator.** One segment per Frame, filled up to
      the current one, and never animated as a countdown. Pair them with the
      "Frame 3 of 6" text the design already includes (board 07) — a pip row is
      not readable on its own at six segments.
- [ ] **Frame body.** Cover or photo full-bleed behind the scrim gradient, the
      `.14`-opacity monogram watermark, the headline at `--fs-title` in
      `--font-display`, the Summary at `--fs-body`, both in `--accent-ink`.
      Image source comes from ticket 01's resolver — the player must not decide
      where a picture comes from.
- [ ] **The scrim is dark in both themes**, using ticket 01's scrim token, and
      the light theme does not redefine it. This is deliberate: `--accent-ink`
      text over a light scrim scores 1.6:1, against 14.6–15.6 over the dark one.
      Put the reason in a comment where the rule lives, so nobody later
      "completes" the light theme and breaks it. See spec.md.
- [ ] **Read button, visible.** The design's label is a full-width primary
      button, with the swipe-up chevron above it as a hint (board 07). Both
      lead to the Reader for that Item. The gesture is never the only way in —
      a hidden affordance is the opposite of approachable.
- [ ] **A Frame marks Seen, on display, once.** Call ticket 01's
      `markItemSeen`. Assert in a test that a full pass through a reel leaves
      every Item Seen and every Item still **Unread**, and that the ring
      therefore dims while the chip's Unread count does not move. This is the
      guarantee the design rests on.
- [ ] **Only the Reader marks Read.** Nothing in this ticket writes `read`.
- [ ] **Summary-only Frames are first-class**, not degraded: the badge over the
      cover, and the Read button's label says what it will actually do (board
      07 phrases it "Read the Summary and open the Original"). Sixteen of the
      thirty Catalog Publications are truncated, so this is the common case,
      not the edge.
- [ ] **The last Frame** tells the reader the reel is finished and returns them
      to the feed (board 08). It does not silently close, and it does not loop
      into another Publication's reel.
- [ ] **Exit.** Swipe down, the ×, Escape, and the browser back gesture all
      close it and land back at the same scroll position in the feed. Decide
      whether the player is a route (`#/story/:publicationId`) or an overlay on
      Today, and say which in the module header with the reason — back-button
      behaviour is the deciding factor, and the Reader is the precedent for a
      full-screen push that hides the tab bar (`hidesTabBar` in `router.js`).
- [ ] **The tab bar is hidden** while the player is open, the way the Reader
      does it.
- [ ] **Both dictionaries**, `story.*` in `en` and `it`.
- [ ] **`SCREEN_ANCHORS`** gains the player's representative selector.
- [ ] **`SHELL` and stamp** if a new module is added; apostrophe-free comments
      in that array (gotcha 7).
- [ ] **CDP screenshots**: first Frame, Cover Frame, last Frame, in both
      Languages. One theme is enough here and only here, because the player is
      dark in both — note that in the ticket's comments so the next reviewer
      does not read it as a missed criterion.
- [ ] **Gates green**, stamp run.

## Notes

- **This is the riskiest ticket** and the only one that writes `seen`, which is
  why it is last and alone. If it slips, tickets 01 and 02 have already shipped
  a working Feed mode whose rings filter — the no-reel behaviour — and nothing
  is half-built on `main`.
- **The design has no light-theme player artboard.** That is not an omission to
  fill in: the answer is that the player is dark in both themes, recorded in
  spec.md with the contrast numbers behind it.
- **Nothing timed.** If a criterion here ever seems to want a countdown, re-read
  it: the pips are position, the advance is a tap, and that was decided against
  the Instagram original on purpose.
