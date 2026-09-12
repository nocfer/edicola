// Shared pieces every screen composes: the header row and the empty state.
// Screens are plain functions `(state) => TemplateResult`; main.js picks one by
// route name and renders it into `<main id="screen">`.

import { html, nothing } from "../render.js";
import { t } from "../i18n.js";

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
