// Today: placeholder screen. Ticket 09 replaces the body with the timeline.
import { html } from "../render.js";
import { t } from "../i18n.js";
import { hrefFor } from "../router.js";
import { emptyState, screenHeader } from "./layout.js";

/** @param {import('../state.js').State} state */
export function todayView(state) {
  return html`
    <section class="screen">
      ${screenHeader(state, t("today.title"))}
      <div class="screen__body">
        ${emptyState(
          t("today.placeholder"),
          html`<a class="btn btn--primary" href=${hrefFor("publications")}
            >${t("today.choosePublications")}</a
          >`,
        )}
      </div>
    </section>
  `;
}
