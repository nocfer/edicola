// The one part of the motion module that is arithmetic rather than an
// animation: the rubber band a pull rides. `rubberBand` decides how far Today
// travels under a finger, and a flat multiplier there once made the surface
// feel like something being dragged rather than something being held.
//
// Everything else in `src/motion.js` reads the DOM or calls `el.animate()` and
// is verified in a browser, not here (ADR-0010, CLAUDE.md gotcha 3).

import { test } from "node:test";
import assert from "node:assert/strict";

import { rubberBand } from "../src/motion.js";

const GRIP = 64;
const MAX = 112;

test("the first phase tracks the finger exactly", () => {
  for (const travel of [1, 20, 63, GRIP]) {
    assert.equal(rubberBand(travel, GRIP, MAX), travel);
  }
});

test("beyond the grip the surface follows a third of the travel", () => {
  assert.equal(rubberBand(GRIP + 3, GRIP, MAX), GRIP + 1);
  assert.equal(rubberBand(GRIP + 24, GRIP, MAX), GRIP + 8);
  // 72px is the arm threshold, and this is the travel that reaches it.
  assert.equal(rubberBand(GRIP + 24, GRIP, MAX), 72);
});

test("the two phases meet without a step", () => {
  const before = rubberBand(GRIP - 0.001, GRIP, MAX);
  const after = rubberBand(GRIP + 0.001, GRIP, MAX);
  assert.ok(after - before < 0.01, `${before} jumps to ${after} at the grip`);
});

test("the surface never passes the cap, however far the finger goes", () => {
  assert.equal(rubberBand(1000, GRIP, MAX), MAX);
  assert.equal(rubberBand(Number.MAX_SAFE_INTEGER, GRIP, MAX), MAX);
});

test("an upward or motionless finger moves nothing", () => {
  assert.equal(rubberBand(0, GRIP, MAX), 0);
  assert.equal(rubberBand(-40, GRIP, MAX), 0);
});
