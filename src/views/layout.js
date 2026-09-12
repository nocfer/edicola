// Shared pieces every screen composes: the header row and the empty state.
// Screens are plain functions `(state) => TemplateResult`; main.js picks one by
// route name and renders it into `<main id="screen">`.

import { html, nothing } from "../render.js";
import { t } from "../i18n.js";
import { update } from "../state.js";

/**
 * Wrap a screen's first-render loader so it only ever runs once, no matter how
 * many times the screen re-renders.
 * @param {() => void} fn
 * @returns {() => void}
 */
export function once(fn) {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    fn();
  };
}

/**
 * The `@error` handler for a thumbnail: a picture that will not load leaves no
 * gap and no broken-image glyph. The element is hidden imperatively so the
 * current DOM is right immediately (no `?hidden` binding to undo), and the URL
 * is remembered in `brokenThumbs` so no later render offers it again.
 *
 * `redraw` is Feed mode's requirement, not a preference: a failed photo there
 * has to be replaced by the generated Cover, and a 4:5 hole is exactly the
 * "looks broken" the Cover treatment exists to avoid. The Saved list and List
 * mode reach the right answer with no redraw at all, so they do not ask for
 * one.
 *
 * @param {Set<string>} brokenThumbs The screen's own set, captured once — it is
 *   never replaced, only added to.
 * @param {{ redraw?: boolean }} [options]
 * @returns {(event: Event) => void}
 */
export function thumbErrorHandler(brokenThumbs, { redraw = false } = {}) {
  return (event) => {
    const img = /** @type {HTMLImageElement} */ (event.currentTarget);
    const url = img.getAttribute("src");
    if (url) brokenThumbs.add(url);
    img.hidden = true;
    if (url && redraw) update();
  };
}

/**
 * How wide a logo has to arrive to be worth showing. The tiles are 32px and the
 * ring is 56px, and the ramp behind them is not a blank: a 16px favicon
 * stretched over it is mush where the monogram is sharp, so below this the
 * candidate is struck off like one that failed to load. 32 rather than the
 * ring's own 56 because it is the size most `/favicon.ico` files actually are,
 * and one of those upscaled still reads as the publisher's mark.
 */
const MIN_LOGO_PX = 32;

/**
 * A Publication's identity tile: the publisher's logo, or the monogram over its
 * `--cover-n` fill. Shared by the Feed ring, the Feed card header and the Story
 * player's header rather than written three times, because three tiles of the
 * same Publication disagreeing about which of the two they show is the way this
 * gets broken.
 *
 * `identity.logoUrls` is `logoCandidates` from `cover.js`, best first. This
 * renders the first one not yet struck off, and `logos` strikes off the rest:
 * one that 404s or will not decode through `onError`, one that arrives smaller
 * than `MIN_LOGO_PX` through `onLoad`. Either way the redraw lands here again
 * with a shorter list, so a Publication walks its candidates one render at a
 * time and stops at the monogram — which is why the tracker must redraw, and
 * why the monogram is not a hole but the last rung of the same ladder.
 *
 * @param {string} className The screen's own tile class (`feed__avatar`, …),
 *   which owns the size and the shape; this adds only what fills it.
 * @param {{ monogram: string, logoUrls: string[], coverIndex: number }} identity
 * @param {LogoTracker} logos The screen's own, from `logoTracker`.
 */
export function publicationTile(className, identity, logos) {
  const logo = (identity.logoUrls ?? []).find((url) => !logos.broken.has(url));
  if (!logo) {
    return html`<span class="${className} ramp ramp--${identity.coverIndex}"
      >${identity.monogram}</span
    >`;
  }
  return html`<span class=${className}
    ><img
      class="logo"
      src=${logo}
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error=${logos.onError}
      @load=${logos.onLoad}
  /></span>`;
}

/**
 * What `publicationTile` needs to walk a Publication's logo candidates.
 * @typedef {object} LogoTracker
 * @property {Set<string>} broken URLs already struck off.
 * @property {(event: Event) => void} onError
 * @property {(event: Event) => void} onLoad
 */

/**
 * One screen's logo tracker, built once at module scope and reused by every
 * tile it draws — a new one per render would re-bind every listener on every
 * redraw.
 *
 * It owns its set rather than borrowing the screen's broken-thumbnail one,
 * which is not tidiness: the Story player replaces `brokenPhotos` whenever the
 * reel changes, and a tracker holding the old set would both lose what it knew
 * and answer from a set nothing else reads. A logo that 404s stays 404 for the
 * session, which is exactly the lifetime of this set.
 *
 * @returns {LogoTracker}
 */
export function logoTracker() {
  /** @type {Set<string>} */
  const brokenLogos = new Set();
  return {
    broken: brokenLogos,
    onError: thumbErrorHandler(brokenLogos, { redraw: true }),
    onLoad: (event) => {
      const img = /** @type {HTMLImageElement} */ (event.currentTarget);
      // An SVG with no intrinsic size reports 0 and scales to whatever the tile
      // is, so it is the one thing this must not throw away.
      if (img.naturalWidth === 0 || img.naturalWidth >= MIN_LOGO_PX) return;
      const url = img.getAttribute("src");
      if (!url) return;
      brokenLogos.add(url);
      img.hidden = true;
      update();
    },
  };
}

/**
 * Screen header: an optional leading control (e.g. the Reader's back button),
 * the title, an Offline chip while the network is down, and optional trailing
 * controls (Today's View Mode toggle and its refresh button).
 * @param {import('../state.js').State} state
 * @param {string} title  already localized
 * @param {unknown} [leading]  a lit template, or nothing
 * @param {unknown} [trailing]  a lit template, or nothing
 */
export function screenHeader(
  state,
  title,
  leading = nothing,
  trailing = nothing,
) {
  return html`
    <header class="screen__header">
      ${leading}
      <h1 class="screen__title">${title}</h1>
      ${
        state.online
          ? nothing
          : html`<span class="chip chip--muted">${t("app.offline")}</span>`
      }
      ${trailing}
    </header>
  `;
}

/**
 * A quiet card explaining why a list is empty, with an optional action.
 * @param {string} text  already localized
 * @param {unknown} [action]  a lit template (usually a `.btn`), or nothing
 */
export function emptyState(text, action = nothing) {
  return html`
    <div class="card empty">
      <p class="empty__text">${text}</p>
      ${action}
    </div>
  `;
}

// --- Icons shared by more than one screen ----------------------------------
//
// Inline SVG, no icon font (the design brief is explicit). These live here
// rather than in one screen's module because the Reader's header and Feed
// mode's action bar offer the same three actions, and a second hand-copied path
// is a second thing to keep in step.

/**
 * Save. Filled when the Item is Saved — the one state the design shows in
 * accent rather than in `--text`.
 * @param {boolean} filled
 */
export function bookmarkIcon(filled) {
  return html`<svg
    class="ico"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill=${filled ? "currentColor" : "none"}
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
  </svg>`;
}

/** Share. */
export const shareIcon = html`<svg
  class="ico"
  viewBox="0 0 24 24"
  width="20"
  height="20"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M12 16V3" />
  <path d="m7 8 5-5 5 5" />
  <path d="M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
</svg>`;

/** Open the Original: an outbound link. */
export const externalIcon = html`<svg
  class="ico"
  viewBox="0 0 24 24"
  width="20"
  height="20"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M15 3h6v6" />
  <path d="M10 14 21 3" />
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
</svg>`;

/** List View Mode: compact rows with a thumbnail. */
export const listIcon = html`<svg
  class="ico"
  viewBox="0 0 24 24"
  width="20"
  height="20"
  fill="none"
  stroke="currentColor"
  stroke-width="1.9"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M3 6h.01" />
  <path d="M3 12h.01" />
  <path d="M3 18h.01" />
  <path d="M8 6h13" />
  <path d="M8 12h13" />
  <path d="M8 18h13" />
</svg>`;

/** Feed View Mode: full-bleed cards. */
export const feedIcon = html`<svg
  class="ico"
  viewBox="0 0 24 24"
  width="20"
  height="20"
  fill="none"
  stroke="currentColor"
  stroke-width="1.9"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <rect x="3" y="3" width="18" height="8" rx="2" />
  <rect x="3" y="13" width="18" height="8" rx="2" />
</svg>`;
