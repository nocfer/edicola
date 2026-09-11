# 07 — Pull to refresh, properly attached

**What to build:** Pulling Today down feels like moving the surface rather than
opening a gap above it. The pull tracks the finger 1:1 for the first 64px and at
a third of that beyond, so it resists without stopping; a spinner appears and
turns as it goes. On release the surface settles back on the spring while the
progress bar takes over and the status line switches to the Sync in progress.
The Refresh button in the header does the same thing without the gesture.

**Blocked by:** 04.

**Status:** ready-for-agent

**Source of truth:** `docs/designs/motion/project/Feed View Mode - Motion.dc.html`
— D6.

**Owns:** the pull gesture and the refresh path in `src/views/today.js`, the
`.today__pull` rules in `src/styles.css`.

## What is already there, and what changes

The gesture exists: `touchstart`/`touchmove`/`touchend` on `window`, a
`screen.pull` distance, a flat `PULL_RESISTANCE`, and a `.today__pull` **row
whose height is the pull distance**. Two things change.

The resistance becomes two-phase — 1:1 to 64px, then a third. And the row that
grows becomes a surface that moves: the spec's "the surface feels attached"
means the screen translates under the finger, not that a spacer opens above it.
That is a change to the Today template, not just to the numbers. If you find a
reason to keep the growing row, say so in the ticket comments rather than
quietly shipping the smaller change.

- [x] **Two-phase resistance.** 1:1 to 64px, `travel / 3` beyond, still capped
      by `PULL_MAX_PX`. The existing arm threshold and the existing "release to
      refresh" behaviour are unchanged.
- [x] **The surface moves.** Pull translates Today, not a spacer above it.
- [x] **The spinner exists and turns.** Fading and scaling up as the pull grows,
      rotating with it, gone once the bar takes over. It is new — there is no
      spinner in Today today.
- [x] **Release settles on the spring.** 540ms on `--ease-spring`, and the
      progress bar picks up from there.
- [x] **The header Refresh button plays the same settle** without the gesture,
      so the visible twin of the gesture is a visible twin of the motion too.
- [x] **Reduced motion.** No translate; the spinner appears and the refresh runs.
- [x] **Verified visually,** mid-pull and mid-settle, both themes. The pull is a
      touch gesture — drive it through `Input.dispatchTouchEvent` over CDP or
      call the handlers directly; do not verify only the button path.
- [x] **All four CI gates pass.**

## Notes from the implementation

The surface moves. `.today__pull` is no longer a row: the `<section class="screen">`
gained `today__surface`, the view puts `transform: translateY(<pull>px)` on it
inline, and the affordance is a strip absolutely positioned at `bottom: 100%` of
that section — just above its own top edge, so it travels with the surface and
arrives exactly as the pull reveals it. No spacer, no reflow, one composited
property.

The two-phase curve came out of the view entirely: `rubberBand(travel, grip, max)`
in `src/motion.js` is pure arithmetic and `test/motion.test.js` covers both
phases, the join between them, the cap and an upward finger. It is the one export
added to `motion.js`, and only because a function inside `today.js` cannot be
imported by a Node test — that file pulls lit-html from esm.sh.

Three things worth knowing:

- **The strip carries the opacity, the ring carries the turn.** Putting the
  scale and the rotation on the strip took the word beside the spinner around
  with it, 220° of it. Verified by looking at the screenshot, which is the only
  gate that catches this.
- **The Refresh button plays the whole gesture, not just the settle** — out to
  the arm threshold on `--dur-pop`, back on `--dur-slow` and `--ease-spring`, as
  one animation whose middle keyframe is where the finger would have been (D6's
  code chains two; one keyframe list needs no `fill` and leaves nothing to clean
  up). While it plays, the word still reads "Pull to refresh": the text is bound
  to `screen.pull`, which no finger is holding, and "Release to refresh" would
  be a lie.
- **Reduced motion puts the strip back in flow** (`position: static` in the
  reduced-motion block, beside the strip's own rules) and the view renders
  nothing at all until a finger moves. The first shape tried — the surface still
  and the strip translating in — dropped an opaque band straight onto the
  "Today" title, which the screenshot showed immediately. A row appearing
  instantly, taking its own space, is what "instant instead of animated" means.

Verified over CDP with synthetic `TouchEvent`s dispatched on `window`, on
throwaway profiles, both themes: mid-pull at the arm point (surface at 72px, ring
at scale 1 and 220°, "Release to refresh"), mid-settle frozen at 70ms and 150ms
(surface at 53px then 26px on the spring, strip fading, ring holding), the button
path frozen at 380ms of its 960ms (surface at 71.9px, progress bar already
present), and reduced motion under a real `--force-prefers-reduced-motion`
Chrome (no transform on the surface, `position: static`, no ring transform, zero
animations). A 40px pull does not Sync; a 72px one does.
