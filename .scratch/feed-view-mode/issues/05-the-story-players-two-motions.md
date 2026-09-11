# 05 — The Story player's two motions

**What to build:** Two things the player does today without any motion at all.

Tapping a ring grows the player out of that ring — the panel starts at the
ring's size and position, carrying the Publication's Cover colour the whole
way, and the Frame's content arrives just behind it. Closing reverses into the
same ring, so the reader never loses their place in the row.

Advancing a Frame moves the content out against the direction of travel and
brings the next one in with it, while the pip for the Frame you are arriving at
fills over the same span. A tap that lands mid-transition commits the one in
flight first, so a fast reader never fills a pip without advancing the Frame
under it.

**Blocked by:** 04.

**Status:** ready-for-agent

**Source of truth:** `docs/designs/motion/project/Feed View Mode - Motion.dc.html`
— D1 (Ring → Story) and D2 (Frame advance), and the `growFrom` sketch.

**Owns:** `src/views/story.js`, the `/* Story */` block in `src/styles.css`.

## The problem the demo does not have

In the demo the ring and the panel are on the same page, so `growFrom` can
measure the ring at any time. In the app the Story is a **route** — opening it
unmounts Today, so by the time the panel exists the ring is gone, and by the
time `close()` runs Today has not come back yet.

Recommended fix: capture the ring's `DOMRect` at tap time, before `navigate`,
and let `growFrom` accept a rect as well as an element — one line at the top of
the function. Reversing needs no measurement, so close falls out for free: play
the stashed animation backwards, then `goBack()` on `finished`. The alternative
is matching `view-transition-name`s on the ring and the panel, which is the
prettier answer and the more fragile one, since it needs Today to still be
rendering the ring. Pick one and record why in a comment.

- [x] **The player grows out of its ring.** 540ms on `--ease-spring`, from the
      ring disc's rect and `--r-pill` to the panel's full bleed and square
      corners. The panel carries that Publication's Cover colour from the first
      frame — it must not flash a neutral background first.
- [x] **The Frame's content arrives behind it.** Opacity and a 10px rise over
      280ms on `--ease`, delayed 140ms so it lands inside the growing panel
      rather than travelling with it.
- [x] **Close reverses the same animation.** Not a second animation with
      inverted keyframes — `.reverse()` on the handle, so an interrupted open
      closes from wherever it got to. The content cross-fades out over 120ms
      first, and the route change waits for `finished`.
- [x] **Frame advance moves against the direction of travel.** Out over 200ms on
      `cubic-bezier(.4, 0, 1, 1)` to `translateX(-18px * dir)`; in over 320ms on
      `--ease-spring` from `translateX(22px * dir)`. Both directions, chevrons
      and taps and arrow keys alike.
- [x] **The pip fills over the same 320ms** on `--ease`, forwards on advance and
      backwards on going back. Rewrite the comment above `pips()` — it currently
      records the decision that pips "never animate, because nothing in this
      player advances by itself", which is still the *reason* but no longer the
      *rule*. The pip animates in response to a tap and never ahead of one; say
      that instead of contradicting the old note silently.
- [x] **A tap mid-transition commits the pending swap first.** Keep a sequence
      guard so a stale `finished` handler cannot swap a Frame that has been
      superseded. This is the one piece of D2 with real state in it — it is worth
      a unit test over the sequencing logic if you can pull it out of the DOM.
- [x] **The swap goes through `update()`, not `textContent`.** The demo mutates
      the DOM directly because it has no store. Here the out-animation finishes,
      the state changes, `update()` redraws, and the in-animation runs on the
      newly rendered body. Confirm `repeat`'s keys do not throw the animation
      away mid-flight.
- [x] **Reduced motion takes the short branch.** The Story still opens, as a
      120ms cross-fade rather than growing out of the ring; Frame advance is a
      120ms fade out, swap, 120ms fade in. Nothing is merely skipped.
- [x] **Verified visually, both themes.** The player is dark in both themes by
      decision, so capture both anyway to prove that still holds mid-animation.
      `tools/screenshot.mjs --eval` can click and then freeze in one expression:
      pause every animation and set `currentTime` to the midpoint.
- [x] **All four CI gates pass.**
