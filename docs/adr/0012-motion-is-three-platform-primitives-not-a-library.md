---
status: accepted
---
# Motion is three platform primitives, not a library

The Feed View Mode motion spec asks for six transitions: the Story player
growing out of the ring that opened it, a Frame advancing, the Save pop, the
List ↔ Feed cross-dissolve, Items arriving in a stagger, and a pull to refresh
that tracks the finger. All six are built on three things the platform already
provides, and no dependency is added for any of them.

**1. CSS transitions on the token layer.** Every state change lit-html already
re-renders — chips, buttons, the Sync progress bar. `--dur-fast`, `--dur` and
`--ease` shipped long before this spec and a dozen rules in `styles.css`
already use them.

**2. The Web Animations API with solved `linear()` springs.** Anything that
starts from where the finger landed: the Story opening out of its ring, the
Save pop. `el.animate()` returns an `Animation` that can be reversed or
replaced mid-flight, which is the whole of what a spring library sells.
`--ease-spring` and `--ease-pop` are the two springs solved once, at authoring
time, and written out as `linear()` ramps — so the runtime has no solver in it.

**3. View Transitions, progressively.** List ↔ Feed, and Today → Reader. One
`document.startViewTransition` wrapper in `src/render.js`; where the API is
missing the render simply happens, as it does today.

## Why not a library

A motion library would be the fourth runtime dependency after lit-html, Dexie
and Readability/DOMPurify — pinned from esm.sh, cached by the service worker,
fetched on every cold start (ADR-0002, ADR-0007) — to do what the platform now
does natively. Four candidates were weighed:

- **Motion One (~4 kB)** is the closest fit and the named fallback if this spec
  ever outgrows hand-written keyframes. It is a thin wrapper over the same WAAPI
  calls, so today it would buy syntax, not capability.
- **GSAP (~70 kB)** is built for timelines and scrubbing. Feed mode has no
  timeline: the brief forbids anything that advances by itself.
- **anime.js (~17 kB)** drives its own `requestAnimationFrame` loop rather than
  the compositor, so it would compete with Sync for the page thread on exactly
  the frames that matter — Sync runs chunked on that same thread because
  `DOMParser` and DOMPurify are unavailable in workers.
- **Auto-Animate (~2 kB)** animates list diffs generically. It cannot know that
  a ring becomes a Story, which is the one transition worth writing by hand.

## What this obliges us to write instead

`src/motion.js`, a Shell file with three named exports, holds the two things
every animation has to get right and would otherwise get wrong once per screen.

`motionToken(name)` reads a duration or an easing off `:root`, so a WAAPI
animation and the CSS transition of the same thing cannot drift apart; the
numbers live in `styles.css` §1 and nowhere else. `prefersReducedMotion()`
reads the media query **at call time**, because a reader can change the
preference while the app is open.

That second one is the trap this ADR exists to name. `styles.css` zeroes every
`transition-duration` under `prefers-reduced-motion`, and that reset covers
primitive 1 and nothing else — **a WAAPI animation ignores it entirely**. So
reduced motion is a branch each script takes, not a switch someone flips: the
Story still opens, it just cross-fades instead of growing; the Save still
flips, it just does not pop. A `prefers-reduced-motion` rule in the stylesheet
is not evidence that an animation respects it, and verification means forcing
the query on rather than trusting the reset.
