// Publications: placeholder screen. Ticket 08 replaces the body with the
// Catalog grouped by Nation and Category.
import { html } from "../render.js";
import { t } from "../i18n.js";
import { emptyState, screenHeader } from "./layout.js";

/** @param {import('../state.js').State} state */
export function publicationsView(state) {
  return html`
    <section class="screen">
      ${screenHeader(state, t("pubs.title"))}
      <div class="screen__body">${emptyState(t("pubs.placeholder"))}</div>
    </section>
  `;
}
