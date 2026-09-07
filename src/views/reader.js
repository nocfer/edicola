// Reader: placeholder for `#/item/:id`. A full-screen push: main.js hides the
// tab bar on this route; the header carries the back control. Ticket 10
// replaces the body with the Article.
import { html } from "../render.js";
import { t } from "../i18n.js";
import { goBack } from "../router.js";
import { screenHeader } from "./layout.js";

const backIcon = html`<svg
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
  <path d="m12 19-7-7 7-7" />
  <path d="M19 12H5" />
</svg>`;

/** @param {import('../state.js').State} state */
export function readerView(state) {
  const back = html`
    <button
      type="button"
      class="btn btn--icon"
      aria-label=${t("reader.back")}
      title=${t("reader.back")}
      @click=${goBack}
    >
      ${backIcon}
    </button>
  `;
  return html`
    <section class="screen screen--reader">
      ${screenHeader(state, t("reader.title"), back)}
      <div class="screen__body">
        <article class="card" id="article">
          <p>${t("reader.placeholder", { id: state.route.params.id })}</p>
        </article>
      </div>
    </section>
  `;
}
