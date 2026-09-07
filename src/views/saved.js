// Saved: placeholder screen. Ticket 11 replaces the body with the Saved list.
import { html } from "../render.js";
import { t } from "../i18n.js";
import { emptyState, screenHeader } from "./layout.js";

/** @param {import('../state.js').State} state */
export function savedView(state) {
  return html`
    <section class="screen">
      ${screenHeader(state, t("saved.title"))}
      <div class="screen__body">${emptyState(t("saved.placeholder"))}</div>
    </section>
  `;
}
