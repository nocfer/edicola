# 04 — Motion foundation, and the Save pop

**What to build:** Tapping Save anywhere in the app — the Reader's header or a
Feed card's action bar — makes the bookmark pop: it dips and springs back past
its own size before settling. Tap it repeatedly and it re-pops each time
instead of queueing. The Save is written to IndexedDB while the spring runs,
and if the write fails the icon returns on the same curve, so the animation is
never a promise the store has not kept. Under reduced motion the state still
flips, without the pop.

That pop is the tracer bullet for everything the rest of the motion package
stands on: the four new tokens, the `src/motion.js` module, and the recorded
decision not to take a motion library.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Source of truth:** `docs/designs/motion/project/Feed View Mode - Motion.dc.html`
— read it in full. D3 is the Save demo; the token block and the `src/motion.js`
sketch are in the sections above it.

**Owns:** the four tokens in the Motion group of §1 in `src/styles.css`, the new
`src/motion.js`, its entry in `SHELL` in `sw.js`, `docs/adr/0011-*`, the pop in
`src/item-actions.js`, and the motion convention in **both** `CLAUDE.md` and
`CONTRIBUTING.md`.

- [ ] **Four tokens, with their primitive.** `--dur-slow: 0.54s`,
      `--dur-pop: 0.42s`, `--ease-spring` and `--ease-pop` as the solved
      `linear()` ramps the spec writes out verbatim. They go in the Motion group
      in §1 beside `--ease`, in the bare `:root` — **not** theme-scoped, motion
      does not change between dark and light — and **not** at the bottom beside
      the Feed-mode rules that needed them (CLAUDE.md gotcha 9). The springs are
      solved once and written out, so there is no solver at runtime.
- [ ] **`src/motion.js` exists, with named exports only,** so
      `tools/check-imports.mjs` stays sound: `prefersReducedMotion()` reading the
      media query **at call time** (a reader can change it while the app is
      open), `motionToken(name)` reading a duration off `:root` so JS and CSS
      never disagree, and `growFrom(origin, panel, { duration, easing })`
      returning the `Animation` so a caller can reverse it. No other exports.
- [ ] **It is a Shell file.** Added to `SHELL` in `sw.js`, then `npm run stamp`.
      Verify on a **throwaway** Chrome profile — a re-stamped Shell now waits
      (gotcha 6), so reloading a primed profile proves nothing.
- [ ] **The Save pop.** 420ms on `--ease-pop`, scale `.86` → `1`. Read the
      duration through `motionToken`, do not hardcode `420`.
- [ ] **Repeated taps re-pop.** They must not queue and must not wait for the
      running animation. Note that the demo's prose claims each tap starts "from
      the current scale rather than snapping back to 1" while its code cancels
      and replays `.86` → `1`; decide which you are shipping and say so in a
      comment. `composite: 'replace'` is what the demo passes.
- [ ] **The pop is optimistic, and honest.** `toggleItemSaved` currently awaits
      the write before it changes anything. Flip the icon and start the spring
      first, then write; on failure return the icon on the same curve and keep
      the existing failure toast. This function is shared by the Reader header
      and Feed cards — check both.
- [ ] **Reduced motion takes a branch, not a shrug.** `styles.css` zeroes every
      `transition-duration` under `prefers-reduced-motion`, and a WAAPI animation
      ignores that rule entirely. The pop must be skipped in JS. Verify by
      forcing the query on, not by trusting the CSS reset.
- [ ] **ADR-0011 records the decision not to take a motion library.** Three
      platform primitives cover the whole spec: CSS transitions on the existing
      tokens, WAAPI with `linear()` springs, and View Transitions. Record why
      each candidate is out — Motion One (~4 kB, a thin wrapper over the same
      WAAPI calls, and the named fallback if hand-written keyframes ever outgrow
      themselves), GSAP (~70 kB, built for timelines; the brief forbids anything
      that advances by itself), anime.js (~17 kB, drives its own rAF loop and so
      competes with Sync for the page thread on exactly the frames that matter),
      Auto-Animate (~2 kB, cannot know that a ring becomes a Story). The point of
      the ADR is that the next person proposing a motion library finds the
      reasoning instead of repeating it.
- [ ] **The convention lands in both files.** "Durations and easings are tokens;
      JS reads them through `src/motion.js`, never as literals; every WAAPI
      animation takes an explicit reduced-motion branch" goes into `CLAUDE.md`
      **and** `CONTRIBUTING.md` in the same commit. Grep each for what you wrote
      in the other.
- [ ] **All four CI gates pass**, in CI order, including a fresh `stamp:check`.
