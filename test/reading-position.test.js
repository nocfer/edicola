// Reading Position arithmetic and the rules around it: a scroll offset in, a
// fraction out; a fraction in, a scroll offset out; and the two thresholds
// that decide when a position is cleared and when it is worth restoring.
//
// These are the rules the Reader's listeners lean on, so they are asserted
// here rather than in a browser: the same Article on a phone and on a tablet
// must resume at the same paragraph, which is exactly what a fraction of the
// container's own travel buys.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampPosition,
  debounce,
  END_POSITION,
  isAtEnd,
  isWorthRestoring,
  MIN_POSITION,
  readingPositionOf,
  RESTORE_ATTEMPTS_MS,
  scrollTargetFor,
  scrollTravel,
  readerTookOver,
} from "../src/reading-position.js";

/** A tall Article under a sticky header, on a phone-sized viewport. */
const TALL = { top: 120, height: 3000, viewport: 800 };

test("a position is a fraction of the Article's own scroll travel", () => {
  assert.equal(scrollTravel(TALL), 2200);
  assert.equal(readingPositionOf({ ...TALL, scrollY: 120 }), 0);
  assert.equal(readingPositionOf({ ...TALL, scrollY: 1220 }), 0.5);
  assert.equal(readingPositionOf({ ...TALL, scrollY: 2320 }), 1);
});

test("the window above the Article, or an Article that fits, is position 0", () => {
  assert.equal(readingPositionOf({ ...TALL, scrollY: 0 }), 0);
  assert.equal(readingPositionOf({ ...TALL, scrollY: 60 }), 0);
  const short = { top: 120, height: 500, viewport: 800, scrollY: 400 };
  assert.equal(scrollTravel(short), 0);
  assert.equal(readingPositionOf(short), 0);
});

test("a position past the end clamps to 1 rather than overshooting", () => {
  assert.equal(readingPositionOf({ ...TALL, scrollY: 9999 }), 1);
});

test("the same fraction lands at the same place in a differently sized window", () => {
  const phone = { top: 120, height: 3000, viewport: 800 };
  const tablet = { top: 96, height: 1600, viewport: 1000 };
  const position = readingPositionOf({ ...phone, scrollY: 1220 });
  assert.equal(position, 0.5);
  // Half the Article on either device, not "1100 px down" on both.
  assert.equal(scrollTargetFor(position, phone), 1220);
  assert.equal(scrollTargetFor(position, tablet), 396);
});

test("scrollTargetFor is the inverse of readingPositionOf", () => {
  for (const scrollY of [120, 500, 1220, 2000, 2320]) {
    const position = readingPositionOf({ ...TALL, scrollY });
    assert.equal(scrollTargetFor(position, TALL), scrollY);
  }
});

test("scrollTargetFor never lands above the Article", () => {
  assert.equal(scrollTargetFor(0, TALL), 120);
  assert.equal(scrollTargetFor(-5, TALL), 120);
});

test("a garbage stored position is clamped, never thrown on", () => {
  assert.equal(clampPosition(undefined), 0);
  assert.equal(clampPosition(null), 0);
  assert.equal(clampPosition("nonsense"), 0);
  assert.equal(clampPosition(Number.NaN), 0);
  assert.equal(clampPosition(-3), 0);
  assert.equal(clampPosition(42), 1);
  assert.equal(clampPosition(0.25), 0.25);
});

test("bad measurements degrade to 0 instead of NaN", () => {
  assert.equal(
    readingPositionOf({
      scrollY: Number.NaN,
      top: 0,
      height: 3000,
      viewport: 800,
    }),
    0,
  );
  assert.equal(
    readingPositionOf(
      /** @type {any} */ ({ scrollY: 500, top: undefined, height: "x" }),
    ),
    0,
  );
});

test("reaching the end is what clears the Reading Position", () => {
  assert.equal(isAtEnd(1), true);
  assert.equal(isAtEnd(END_POSITION), true);
  assert.equal(isAtEnd(END_POSITION - 0.01), false);
  assert.equal(isAtEnd(0), false);
});

test("only a deliberate position, short of the end, is restored", () => {
  assert.equal(isWorthRestoring(0), false);
  assert.equal(isWorthRestoring(MIN_POSITION / 2), false);
  assert.equal(isWorthRestoring(MIN_POSITION), true);
  assert.equal(isWorthRestoring(0.5), true);
  assert.equal(isWorthRestoring(END_POSITION), false);
  assert.equal(isWorthRestoring(1), false);
  assert.equal(isWorthRestoring(undefined), false);
});

test("the restore attempts start immediately and then grow", () => {
  assert.equal(RESTORE_ATTEMPTS_MS[0], 0);
  const sorted = [...RESTORE_ATTEMPTS_MS].sort((a, b) => a - b);
  assert.deepEqual([...RESTORE_ATTEMPTS_MS], sorted);
  assert.ok(Object.isFrozen(RESTORE_ATTEMPTS_MS));
});

/** A fake timer pair: `run()` fires whatever is pending. */
function fakeTimers() {
  /** @type {Map<number, () => void>} */
  const queue = new Map();
  let next = 1;
  return {
    timers: {
      setTimer: (/** @type {() => void} */ fn) => {
        const handle = next;
        next += 1;
        queue.set(handle, fn);
        return handle;
      },
      clearTimer: (/** @type {number} */ handle) => queue.delete(handle),
    },
    run() {
      const pending = [...queue.values()];
      queue.clear();
      for (const fn of pending) fn();
    },
    size: () => queue.size,
  };
}

test("the debounce writes once, with the last value", () => {
  const written = [];
  const { timers, run } = fakeTimers();
  const saver = debounce(
    (/** @type {number} */ p) => written.push(p),
    400,
    timers,
  );

  saver.call(0.1);
  saver.call(0.2);
  saver.call(0.3);
  assert.deepEqual(written, [], "nothing is written while the finger moves");
  run();
  assert.deepEqual(written, [0.3], "the trailing value is the one that lands");
});

test("flush writes a pending value now, and does nothing when there is none", () => {
  const written = [];
  const { timers } = fakeTimers();
  const saver = debounce(
    (/** @type {number} */ p) => written.push(p),
    400,
    timers,
  );

  saver.flush();
  assert.deepEqual(written, [], "a flush with nothing queued writes nothing");
  saver.call(0.6);
  saver.flush();
  assert.deepEqual(
    written,
    [0.6],
    "leaving the Reader lands the last position",
  );
  saver.flush();
  assert.deepEqual(written, [0.6], "and lands it exactly once");
});

test("a restore's own smooth scroll is not the reader taking over", () => {
  // The regression: the third restore attempt exists to re-aim after lazy
  // images have grown the container, and it fired ~520ms after a smooth scroll
  // towards 4303 began — with the window at 3610, still on its way. Measuring
  // that against the target alone abandoned the restore every time and left
  // the reader hundreds of pixels short of where they had been.
  assert.equal(
    readerTookOver({ scrollY: 3610, from: 0, to: 4303 }),
    false,
    "mid-flight towards the target is our own scroll",
  );
  assert.equal(
    readerTookOver({ scrollY: 0, from: 0, to: 4303 }),
    false,
    "not having moved yet is not the reader either",
  );
  assert.equal(
    readerTookOver({ scrollY: 4303, from: 0, to: 4303 }),
    false,
    "arriving is not the reader",
  );
  assert.equal(
    readerTookOver({ scrollY: 4600, from: 0, to: 4303 }),
    true,
    "past the target by more than the slack is the reader reading on",
  );
  assert.equal(
    readerTookOver({ scrollY: -60, from: 0, to: 4303 }),
    true,
    "back above the start is the reader going for the top",
  );
  assert.equal(
    readerTookOver({ scrollY: 4315, from: 0, to: 4303 }),
    false,
    "overshooting inside the slack is still ours",
  );
  // A later attempt re-aims from wherever the window now is, so the corridor
  // runs the other way when the container grew and the target moved down.
  assert.equal(
    readerTookOver({ scrollY: 4400, from: 3610, to: 4685 }),
    false,
    "the corridor is ordered by value, not by direction",
  );
});
