// The two parts of the motion module that are not animation. Everything else
// in `src/motion.js` reads the DOM or calls `el.animate()` and is verified in a
// browser, not here (ADR-0010, CLAUDE.md gotcha 3).
//
// `rubberBand` is arithmetic: it decides how far Today travels under a finger,
// and a flat multiplier there once made the surface feel like something being
// dragged rather than something being held.
//
// `sequencer` is the only state in the motion package, it never touches the
// DOM, and it is exactly the piece whose failures are invisible on a
// screenshot. What it guards, in the Story player: a tap that lands while a
// Frame is still leaving must commit the swap that Frame owes before starting
// its own, and the out-animation of a superseded step must not swap a Frame
// when it eventually resolves.

import assert from "node:assert/strict";
import test from "node:test";

import { rubberBand, sequencer } from "../src/motion.js";

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

test("a step commits once, when its own token is the current one", () => {
  const seen = [];
  const swaps = sequencer();
  const token = swaps.start(() => seen.push("a"));
  assert.equal(swaps.commit(token), true);
  assert.deepEqual(seen, ["a"]);
  // The animation's `finished` can only fire once, but a cancelled animation
  // that resolves late must not replay a swap that has already been applied.
  assert.equal(swaps.commit(token), false);
  assert.deepEqual(seen, ["a"]);
});

test("a second start commits the swap the first still owes", () => {
  const seen = [];
  const swaps = sequencer();
  swaps.start(() => seen.push("a"));
  swaps.start(() => seen.push("b"));
  // The reader tapped twice in 200ms: they must have landed on the second
  // Frame, not skipped from the first to the third.
  assert.deepEqual(seen, ["a"]);
});

test("a superseded step's late finish swaps nothing", () => {
  const seen = [];
  const swaps = sequencer();
  const first = swaps.start(() => seen.push("a"));
  const second = swaps.start(() => seen.push("b"));
  // `first`'s out-animation was cancelled by the second tap; if its handler
  // still ran, the reader would be thrown back to the Frame they just left.
  assert.equal(swaps.commit(first), false);
  assert.deepEqual(seen, ["a"]);
  assert.equal(swaps.commit(second), true);
  assert.deepEqual(seen, ["a", "b"]);
});

test("three taps in flight land on the third Frame, in order", () => {
  const seen = [];
  const swaps = sequencer();
  swaps.start(() => seen.push(1));
  swaps.start(() => seen.push(2));
  const third = swaps.start(() => seen.push(3));
  assert.deepEqual(seen, [1, 2]);
  swaps.commit(third);
  assert.deepEqual(seen, [1, 2, 3]);
});

test("settling on its own commits the pending swap and reports it", () => {
  const seen = [];
  const swaps = sequencer();
  // The Story player has to settle before it can read the position: the swap
  // still owed is what says which Frame the reader is actually on, and a step
  // computed from the stale index aims at the Frame the last tap already took.
  assert.equal(swaps.settle(), false);
  const token = swaps.start(() => seen.push("a"));
  assert.equal(swaps.settle(), true);
  assert.deepEqual(seen, ["a"]);
  // Nothing is owed any more, but the step is still the current one and its
  // out-animation still owns a Frame it has to bring back in, so `commit`
  // says true and applies nothing. Answering false here — because no swap was
  // left to run — is indistinguishable from "you were superseded", and
  // `advance` reads that as "touch nothing", which left the Frame pinned at
  // `opacity: 0` under its own filled out-animation.
  assert.equal(swaps.commit(token), true);
  assert.deepEqual(seen, ["a"]);
  // Still only committable once.
  assert.equal(swaps.commit(token), false);
  assert.deepEqual(seen, ["a"]);
});

test("two sequencers do not share a sequence", () => {
  const swaps = sequencer();
  const others = sequencer();
  const mine = swaps.start(() => {});
  others.start(() => {});
  others.start(() => {});
  // Tokens are per-sequencer, so a busy neighbour cannot invalidate this one.
  assert.equal(swaps.commit(mine), true);
});
