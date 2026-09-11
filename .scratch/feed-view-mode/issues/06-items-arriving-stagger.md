# 06 — Items arriving stagger

**What to build:** When a Sync answers, the Items that arrive rise and fade into
Today rather than appearing all at once. Sync answers one Publication at a time,
so cards land in bursts, and the stagger makes that legible instead of jarring.
It caps at the fourth card: past that a reader reads the delay as lag, and an
offline Sync can land thirty at once.

**Blocked by:** 04.

**Status:** ready-for-agent

**Source of truth:** `docs/designs/motion/project/Feed View Mode - Motion.dc.html`
— D5.

**Owns:** the card-arrival animation in `src/views/today.js`.

- [x] **New cards rise in.** 280ms on `--ease`, from `translateY(14px)
      scale(.99)` and transparent, 40ms apart, `Math.min(index, 4)` so the
      stagger stops at the fourth.
- [x] **Only cards that are actually new.** This is the whole difficulty:
      `update()` redraws Today for every state change — a filter chip, a scroll
      write, a Sync progress tick — and the stagger must not replay on any of
      them. Animate on the transition from absent to present, not on render.
- [x] **It works in both View Modes.** List rows and Feed post cards both.
- [x] **Reduced motion fades without moving.** 120ms opacity, same delays.
- [x] **Verified visually.** Capture mid-stagger with the animations frozen, so
      the four different offsets are all visible in one frame, both themes.
- [x] **All four CI gates pass.**
