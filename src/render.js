// @ts-nocheck — this file re-exports from a CDN URL that tsc/checkJs cannot
// resolve without a build; the file itself is only re-export lines, so there is
// nothing here worth type-checking. Consumers see the re-exports as `any`.
//
// lit-html choke point — the single place the CDN URL and version are pinned
// (ADR-0002). Every screen imports { html, render, nothing, unsafeHTML, repeat }
// from here, never the raw CDN URL, so bumping the version or swapping the CDN
// is a one-line change and `npm run typecheck` can see every consumer.
//
// Why esm.sh: jsdelivr's `+esm` inlines a private copy of the lit-html core
// into each directive bundle, so `unsafeHTML` would carry a different core
// instance than `render` and the directive would be silently ignored ("multiple
// versions of lit-html loaded"). esm.sh serves every subpath against one shared
// core module (`/lit-html@3.2.1/es2022/lit-html.mjs`), so directives and render
// agree.
//
// The service worker runtime-caches the esm.sh origin cache-first (see sw.js),
// and index.html asks it to warm that cache right after the first load, so
// these modules and their transitive deps work offline from the second open.
export { html, render, nothing } from "https://esm.sh/lit-html@3.2.1";
export { unsafeHTML } from "https://esm.sh/lit-html@3.2.1/directives/unsafe-html.js";
export { repeat } from "https://esm.sh/lit-html@3.2.1/directives/repeat.js";
