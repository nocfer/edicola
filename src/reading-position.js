// Reading Position: how far into an Article the reader had scrolled when they
// last left it (CONTEXT.md), as a fraction of the Article's own scroll travel.
//
// This module is the arithmetic and the thresholds, with no DOM and no
// database, so every rule in it is unit tested under Node. The browser half
// lives in `src/views/reader.js`, which is the only file that knows the window
// scrolls and that the Article sits in `READER_SCROLL_ID`; it hands the four
// measurements in and gets a fraction back, or hands a fraction in and gets a
// scroll offset back.
//
// A fraction rather than a pixel offset because pixels are a lie across
// devices: the same Article is 3000 px tall on a phone and 1400 px on a
// tablet, and a stored offset would land in the wrong paragraph. The fraction
// is measured against the Article container's *scrollable* travel — its height
// minus the viewport — so 1 means "the last line is on screen", not "scrolled
// by the container's full height".

/** Debounce on the Reading Position write while the reader scrolls. */
export const SAVE_DEBOUNCE_MS = 400;

/**
 * At or past this fraction the reader has reached the end, so the Reading
 * Position is cleared: reopening a finished Article at its last line would be
 * worse than opening it at the top.
 */
export const END_POSITION = 0.98;

/**
 * Below this fraction there is nothing worth restoring — the reader barely
 * moved, and a jump of a few pixels on open reads as a glitch.
 */
export const MIN_POSITION = 0.02;

/**
 * When to re-apply a restore, in ms after the two frames the Reader already
 * waits. The Article's images are `loading="lazy"`, so the container grows as
 * they lay out and the first target can fall short; re-applying is cheap and
 * stops as soon as the reader scrolls themselves.
 */
export const RESTORE_ATTEMPTS_MS = Object.freeze([0, 120, 400]);

/**
 * How far the reader may have scrolled away from the offset we applied before
 * a later restore attempt gives up and leaves them alone (CSS px).
 */
export const RESTORE_ABANDON_PX = 24;

/**
 * Grace period after the last restore attempt before the scroll listener is
 * allowed to record a position again, so the programmatic scrolls of the
 * restore itself are never mistaken for the reader's own.
 */
export const RESTORE_SETTLE_MS = 150;

/**
 * The four numbers a Reading Position is computed from. All CSS px.
 *
 * @typedef {object} ScrollMetrics
 * @property {number} scrollY Current window scroll offset.
 * @property {number} top The Article container's offset from the page top.
 * @property {number} height The Article container's own height.
 * @property {number} viewport The viewport height.
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Clamp a Reading Position into 0…1. A stored row that was hand-edited, or
 * written by an older version, can hold anything.
 *
 * @param {unknown} position
 * @returns {number}
 */
export function clampPosition(position) {
  const n = Number(position);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1 ? 1 : n;
}

/**
 * The Article's scrollable travel: how far the window can move while the
 * container is what fills the viewport. Zero when the Article is shorter than
 * the screen, which is why an Article that fits has no Reading Position.
 *
 * @param {ScrollMetrics} metrics
 * @returns {number}
 */
export function scrollTravel({ height, viewport }) {
  return Math.max(0, num(height) - num(viewport));
}

/**
 * The Reading Position for a scroll offset: 0 at the Article's first line, 1
 * with its last line on screen. An Article shorter than the viewport, or a
 * window still above the Article, is 0.
 *
 * @param {ScrollMetrics} metrics
 * @returns {number}
 */
export function readingPositionOf(metrics) {
  const travel = scrollTravel(metrics);
  if (travel <= 0) return 0;
  const travelled = num(metrics.scrollY) - num(metrics.top);
  if (travelled <= 0) return 0;
  return clampPosition(travelled / travel);
}

/**
 * The window offset that puts a Reading Position back on screen, rounded to
 * whole pixels because that is what `window.scrollTo` lands on anyway.
 *
 * @param {number} position
 * @param {ScrollMetrics} metrics
 * @returns {number}
 */
export function scrollTargetFor(position, metrics) {
  const travel = scrollTravel(metrics);
  return Math.round(num(metrics.top) + clampPosition(position) * travel);
}

/**
 * Whether the reader has reached the end of the Article, which is when the
 * Reading Position is cleared.
 *
 * @param {number} position
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function isAtEnd(position, threshold = END_POSITION) {
  return clampPosition(position) >= threshold;
}

/**
 * Whether a stored Reading Position is worth restoring: far enough in to be
 * deliberate, and not the end (which is cleared on the way out, but a row
 * written before the reader closed the tab mid-frame can still hold it).
 *
 * @param {unknown} position
 * @returns {boolean}
 */
export function isWorthRestoring(position) {
  const p = clampPosition(position);
  return p >= MIN_POSITION && p < END_POSITION;
}

/**
 * A trailing debounce. The timer functions are parameters so a test can drive
 * it without waiting, which is the only reason this is not three lines inside
 * the Reader.
 *
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} waitMs
 * @param {{ setTimer?: (fn: () => void, ms: number) => any,
 *           clearTimer?: (handle: any) => void }} [timers]
 * @returns {{ call: (...args: Parameters<F>) => void, flush: () => void }}
 */
export function debounce(fn, waitMs, timers = {}) {
  const setTimer = timers.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = timers.clearTimer ?? ((handle) => clearTimeout(handle));
  /** @type {any} */
  let handle = null;
  /** @type {any[] | null} */
  let queued = null;

  function fire() {
    handle = null;
    const args = queued;
    queued = null;
    if (args) fn(...args);
  }

  return {
    call(...args) {
      queued = args;
      if (handle !== null) clearTimer(handle);
      handle = setTimer(fire, waitMs);
    },
    flush() {
      if (handle === null) return;
      clearTimer(handle);
      fire();
    },
  };
}
