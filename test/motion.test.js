// `src/motion.js` is mostly browser: `prefersReducedMotion` asks matchMedia,
// `motionToken` reads the computed style of `:root`, `growFrom` measures two
// boxes. `sequencer` is the exception — it is the only state in the motion
// package, it never touches the DOM, and it is exactly the piece whose failures
// are invisible on a screenshot. So it is the piece that gets a test.
//
// What it guards, in the Story player: a tap that lands while a Frame is still
// leaving must commit the swap that Frame owes before starting its own, and the
// out-animation of a superseded step must not swap a Frame when it eventually
// resolves.

import assert from "node:assert/strict";
import test from "node:test";

import { sequencer } from "../src/motion.js";

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
  // Nothing is owed any more, so that animation's own finish is a no-op rather
  // than a second application of the same swap.
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
