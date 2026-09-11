# 08 — List ↔ Feed cross-dissolve

**What to build:** Switching View Mode stops being a hard cut. The pill slides
under the icon you tapped while the two presentations cross-dissolve into each
other. Same Items, same order — so the crossfade is honest about it — and the
header never moves.

**Blocked by:** 04, 06.

**Status:** ready-for-agent

**Source of truth:** `docs/designs/motion/project/Feed View Mode - Motion.dc.html`
— D4, and primitive 03 in the section above the demos.

**Owns:** the `.today__modes` toggle in `src/views/today.js` and
`src/styles.css`, and the View Transition wrapper around the app's single render
subscriber.

## Two decisions to make first

**Where the wrapper goes.** The spec says `src/render.js`. That file is
deliberately nothing but pinned CDN re-exports, which is why it carries
`@ts-nocheck` honestly. The sole render subscriber is `renderApp` in
`src/main.js`. Recommendation: wrap it there and leave `render.js` a choke
point; if you put it in `render.js`, drop the `@ts-nocheck` and type it.

**Reduced motion.** A View Transition's default cross-fade is a UA animation,
not one of the transitions `styles.css` zeroes. Skip the transition entirely
under `prefersReducedMotion()` rather than trying to shorten it.

- [x] **The pill slides.** `.today__modes` already has the demo's geometry —
      2px padding, 44×38 segments, a pill radius and a hairline border. What is
      missing is the moving pill: today the fill is `chip--on` swapping between
      two segments. Add the pill, move it on `--dur` (300ms) on `--ease`, and
      keep the icon colours flipping with it.
- [x] **The two presentations cross-dissolve.** One
      `document.startViewTransition` wrapper; where the API is missing the
      render just happens, exactly as it does today. Do not ship a wrapper that
      breaks the render path on a browser without it.
- [x] **The header does not move.** Not the title, not the toggle, not the
      progress bar. Give the parts that must stay put their own
      `view-transition-name`s if the default snapshot moves them.
- [x] **It does not fight the arrival stagger** from ticket 06. A View
      Transition snapshots the old and new trees; a card mid-stagger must not be
      captured half-animated and stranded. Check the case where the mode is
      toggled while a Sync is landing.
- [x] **The wrapper is reusable.** It is named as the mechanism for Today →
      Reader too. Do not build that here — but do not build something that only
      knows about View Mode either.
- [x] **Reduced motion** cuts straight to the new mode; the pill still moves at
      the CSS transition duration, which the reduced-motion reset already zeroes.
- [x] **`test/styles-structure.test.js` still holds.** Add an anchor if the
      toggle gains a block of its own; `::view-transition` rules are top-level,
      so check the walker reads them as you expect rather than assuming.
- [x] **Verified visually,** mid-dissolve in both View Modes, both themes, both
      languages — the toggle is one of the few places IT copy changes the header
      width.
- [x] **All four CI gates pass.**

## Resolved: the pill moves at 200ms

The ticket quotes D4's label, "move it on `--dur` (300ms)". `--dur` is `0.2s`
and has been since before this spec; 300ms is the prototype's own number. Keep
the token: the pill and the cross-dissolve both run at 200ms. If 300ms is ever
wanted it is a new token in the Motion group in §1, not a literal at the call
site.
