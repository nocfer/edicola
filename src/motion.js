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

/** How long a reduced-motion cross-fade lasts, in ms: `--dur-fast`. */
const REDUCED_MS = 120;

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
 * Grow `panel` out of `origin`: the panel starts scaled and translated onto
 * the small thing that opened it, and settles into its own box. Used for the
 * Story player growing out of the ring that was tapped.
 *
 * Returns the `Animation` so the caller can `reverse()` it to close, which is
 * what makes the reader land back on the same ring rather than on a guess.
 *
 * Under reduced motion this is a cross-fade of the same length as
 * `--dur-fast`: the panel still opens, it just does not travel.
 *
 * @param {Element} origin The element the panel grows out of.
 * @param {HTMLElement} panel The panel, already laid out at its final size.
 * @param {{ duration: number, easing: string }} options Milliseconds and a CSS
 *   easing, both read from the token layer through `motionToken`.
 * @returns {Animation}
 */
export function growFrom(origin, panel, { duration, easing }) {
  if (prefersReducedMotion()) {
    return panel.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: REDUCED_MS,
      fill: "both",
    });
  }
  const a = origin.getBoundingClientRect();
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
