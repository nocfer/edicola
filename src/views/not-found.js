// Unknown hash: say so and offer the way home. The tab bar stays visible.
import { html } from "../render.js";
import { t } from "../i18n.js";
import { hrefFor } from "../router.js";
import { emptyState, screenHeader } from "./layout.js";

/** @param {import('../state.js').State} state */
export function notFoundView(state) {
  return html`
    <section class="screen">
      ${screenHeader(state, t("notFound.title"))}
      <div class="screen__body">
        ${emptyState(
          t("notFound.body"),
          html`<a class="btn btn--primary" href=${hrefFor("today")}
            >${t("notFound.home")}</a
          >`,
        )}
      </div>
    </section>
  `;
}
