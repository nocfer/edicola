// Motion, in the three platform primitives Edicola already has: CSS
// transitions on the token layer, the Web Animations API with the solved
// `linear()` springs, and View Transitions. No motion library (ADR-0012).
//
// This module is deliberately small. It owns the two things every animation in
// the app has to get right and would otherwise get wrong once per screen:
//
//   1. Durations and easings are tokens. `styles.css` §1 is the only place the
//      numbers are written, and JS reads them from there, so a duration cannot
//      drift between a CSS transition and a WAAPI animation of the same thing.
//   2. Reduced motion is a branch, not a switch. `styles.css` zeroes every
//      `transition-duration` under `prefers-reduced-motion`, which covers CSS
//      transitions and nothing else — a WAAPI animation ignores that rule
//      entirely. Every caller of `el.animate()` has to ask.
//
// `sequencer()` joined them for ticket 05 rather than becoming a file of its
// own: a state change that waits on an animation needs a guard, the guard is
// pure, and a new module here would be a fourth Shell file for twenty lines.
//
// Both of those apply to the third primitive as well, so `withViewTransition`
// lives here too: it wraps a redraw in a View Transition where the browser has
// one, and where it does not — or where the reader asked for less motion — the
// redraw simply happens. It knows nothing about which screen called it.

/**
 * How long a reduced-motion cross-fade lasts, in ms. Read from `--dur-fast`
 * rather than written here, for the same reason every other duration is: this
 * module is what the "durations are tokens, never literals" rule points at, so
 * it is the last place that may hold a copy of one. Falls back to 120 only if
 * the token is missing, which is a stylesheet that has not loaded rather than
 * a value worth tuning.
 *
 * @returns {number}
 */
function reducedMs() {
  return Number.parseFloat(motionToken("--dur-fast")) * 1000 || 120;
}

/**
 * Whether the reader asked for reduced motion, read at call time rather than
 * cached: the preference can change while the app is open, and a value read
 * once at boot would keep animating for a reader who has just turned it off.
 *
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Read a motion token off `:root`, so JS and CSS never disagree about a
 * duration or a curve. Returns the CSS value as written: `"0.42s"` for a
 * duration, the whole `linear(…)` ramp for an easing. WAAPI takes the easing
 * string as-is; a duration needs `Number.parseFloat(…) * 1000` at the call
 * site, because `el.animate()` counts in milliseconds and CSS does not.
 *
 * @param {string} name The custom property, including the leading `--`.
 * @returns {string} The trimmed value, or `""` if no such token exists.
 */
export function motionToken(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * Run a redraw inside a View Transition, so the old and the new render
 * cross-fade instead of cutting (ADR-0012, primitive 3). Where
 * `document.startViewTransition` is missing the redraw just happens, exactly
 * as it does today — a caller never has to check, and the render path never
 * depends on the API being there.
 *
 * `mutate` has to change the DOM synchronously, which in this app it always
 * does: `update()` in state.js notifies its listeners inline and lit's
 * `render` commits inline, so `withViewTransition(() => update({ … }))` wraps
 * a whole redraw without either module knowing about it.
 *
 * Reduced motion **skips** the transition rather than shortening it. The
 * cross-fade is a UA animation on the `::view-transition` pseudo tree, so the
 * `transition-duration: 0s` reset in styles.css does not reach it and there is
 * nothing to shorten — cutting straight to the new render is the honest
 * answer.
 *
 * @param {() => void} mutate The DOM change to transition between.
 * @returns {void}
 */
export function withViewTransition(mutate) {
  if (prefersReducedMotion() || !document.startViewTransition) {
    mutate();
    return;
  }
  // A UA that refuses to start the transition — a hidden or not-yet-rendering
  // document, which is most of a headless screenshot run — rejects `ready`
  // with an InvalidStateError while still calling `mutate`. The redraw is
  // correct, so that rejection is noise; left unhandled it surfaces as an
  // uncaught exception and fails qa-scenarios at random. `updateCallbackDone`
  // is deliberately NOT caught: a throw inside the redraw is a real bug.
  document.startViewTransition(mutate).ready.catch(() => {});
}

/**
 * Grow `panel` out of `origin`: the panel starts scaled and translated onto
 * the small thing that opened it, and settles into its own box. Used for the
 * Story player growing out of the ring that was tapped.
 *
 * Returns the `Animation` so the caller can `cancel()` it if a close
 * interrupts the open.
 *
 * Under reduced motion this is a cross-fade of the same length as
 * `--dur-fast`: the panel still opens, it just does not travel.
 *
 * @param {Element | DOMRect | null} origin The element the panel grows out of,
 *   or a rect measured earlier. A rect is what the Story player passes: it is a
 *   route, so the ring that opened it is unmounted before the panel exists and
 *   only the measurement survives the navigation. `null` means there is nothing
 *   to grow out of — a reader who typed the URL — and takes the cross-fade.
 * @param {HTMLElement} panel The panel, already laid out at its final size.
 * @param {{ duration: number, easing: string }} options Milliseconds and a CSS
 *   easing, both read from the token layer through `motionToken`.
 * @returns {Animation}
 */
export function growFrom(origin, panel, { duration, easing }) {
  if (!origin || prefersReducedMotion()) {
    return panel.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: reducedMs(),
      fill: "both",
    });
  }
  const a = origin instanceof Element ? origin.getBoundingClientRect() : origin;
  const b = panel.getBoundingClientRect();
  const dx = a.left + a.width / 2 - b.left - b.width / 2;
  const dy = a.top + a.height / 2 - b.top - b.height / 2;
  const from = `translate(${dx}px, ${dy}px) scale(${a.width / b.width}, ${a.height / b.height})`;
  // The radius is read rather than written as `var(--r-pill)`: WAAPI does not
  // resolve custom properties inside keyframe values, so a `var()` here is
  // dropped silently and the panel grows out of a square.
  return panel.animate(
    [
      { transform: from, borderRadius: motionToken("--r-pill"), opacity: 0 },
      { transform: "none", borderRadius: "0px", opacity: 1 },
    ],
    { duration, easing, fill: "both" },
  );
}

/**
 * The rubber band a pull gesture rides: the surface follows the finger 1:1 for
 * the first `grip` pixels and at a third of its travel beyond that, clamped at
 * `max`. Pure arithmetic, so it is unit tested rather than eyeballed.
 *
 * Two phases rather than one flat fraction because a surface that moves at half
 * speed from the very first pixel never feels attached to the finger — it feels
 * like something being dragged through treacle. Tracking 1:1 while the gesture
 * is still ambiguous, then resisting, is what makes the screen read as a sheet
 * held down by its own weight.
 *
 * @param {number} travel How far the finger has moved down, in CSS px.
 * @param {number} grip The travel followed 1:1.
 * @param {number} max The furthest the surface will ever go.
 * @returns {number} The distance the surface should move, never negative.
 */
export function rubberBand(travel, grip, max) {
  if (travel <= 0) return 0;
  const eased = travel <= grip ? travel : grip + (travel - grip) / 3;
  return Math.min(max, eased);
}

/**
 * The guard every swap that waits on an animation needs: a step is opened when
 * the out-animation starts and committed when it finishes, and a second tap
 * arriving in between commits the step still owed before opening its own.
 *
 * Two failures come out of the same missing state, and the Story player's Frame
 * advance has both. A stale `finished` handler swapping a Frame that has since
 * been superseded shows the reader a Frame they already left; a tap that starts
 * a second transition without settling the first fills a pip whose Frame never
 * arrived. `start` returns a token, `commit` refuses one that is no longer
 * current, and `settle` is for the caller that has to read the state a pending
 * swap is about to write before it can decide what its own step even is. None
 * of the three touches the DOM, which is what makes this the piece of the
 * sequencing a unit test can reach.
 *
 * @returns {{ start: (swap: () => void) => number, commit: (token: number) => boolean, settle: () => boolean }}
 */
export function sequencer() {
  let seq = 0;
  /** The highest sequence number whose step has already been committed. */
  let committed = 0;
  /** @type {(() => void) | null} */
  let owed = null;
  /** Run whatever swap is still owed, exactly once. */
  const settle = () => {
    const swap = owed;
    owed = null;
    if (!swap) return false;
    swap();
    return true;
  };
  return {
    start(swap) {
      settle();
      owed = swap;
      return ++seq;
    },
    commit(token) {
      // Current *and* not already committed. Two different things return
      // false here and the caller has to tell them apart: a superseded step,
      // whose animation must not touch the DOM at all, and a step whose swap
      // someone else already drained through `settle()` — that one is still
      // the current step, and its animation still owns the frame it has to
      // bring back in. Returning false for the second left a Frame pinned
      // under a filled out-animation for ever.
      if (token !== seq || committed === seq) return false;
      committed = seq;
      settle();
      return true;
    },
    settle,
  };
}
