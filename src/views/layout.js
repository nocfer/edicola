// Shared pieces every screen composes: the header row and the empty state.
// Screens are plain functions `(state) => TemplateResult`; main.js picks one by
// route name and renders it into `<main id="screen">`.

import { html, nothing } from "../render.js";
import { t } from "../i18n.js";

/**
 * Screen header: an optional leading control (e.g. the Reader's back button),
 * the title, and an Offline chip while the network is down.
 * @param {import('../state.js').State} state
 * @param {string} title  already localized
 * @param {unknown} [leading]  a lit template, or nothing
 */
export function screenHeader(state, title, leading = nothing) {
  return html`
    <header class="screen__header">
      ${leading}
      <h1 class="screen__title">${title}</h1>
      ${
        state.online
          ? nothing
          : html`<span class="chip chip--muted">${t("app.offline")}</span>`
      }
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
