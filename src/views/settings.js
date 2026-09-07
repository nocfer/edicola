// Settings: theme (system/light/dark) and Language (en/it). Ticket 12 adds
// Proxy, Retention, storage and updates below these two cards.
//
// The controls only write to the store; main.js applies the theme attribute,
// persists the choice and re-translates static copy when it renders.
import { html } from "../render.js";
import { LANGS, t } from "../i18n.js";
import { update } from "../state.js";
import { screenHeader } from "./layout.js";

/** @type {import('../state.js').ThemePreference[]} */
const THEMES = ["system", "light", "dark"];

/**
 * A row of `.chip` buttons where exactly one is pressed.
 * @template {string} T
 * @param {string} label
 * @param {readonly T[]} options
 * @param {T} current
 * @param {(value: T) => string} labelFor
 * @param {(value: T) => void} onPick
 */
function segmented(label, options, current, labelFor, onPick) {
  return html`
    <div class="seg" role="group" aria-label=${label}>
      ${options.map(
        (value) => html`
          <button
            type="button"
            class="chip ${value === current ? "chip--on" : ""}"
            aria-pressed=${value === current}
            @click=${() => onPick(value)}
          >
            ${labelFor(value)}
          </button>
        `,
      )}
    </div>
  `;
}

/** @param {import('../state.js').State} state */
export function settingsView(state) {
  return html`
    <section class="screen">
      ${screenHeader(state, t("settings.title"))}
      <div class="screen__body">
        <div class="card">
          <h2 class="card__title">${t("settings.appearance")}</h2>
          <div class="row">
            <span class="row__label">${t("settings.theme")}</span>
            ${segmented(
              t("settings.theme"),
              THEMES,
              state.theme,
              (v) => t(`settings.theme.${v}`),
              (theme) => update({ theme }),
            )}
          </div>
        </div>
        <div class="card">
          <h2 class="card__title">${t("settings.language")}</h2>
          <div class="row">
            <span class="row__label">${t("settings.language")}</span>
            ${segmented(
              t("settings.language"),
              LANGS,
              state.lang,
              (v) => t(`settings.language.${v}`),
              (lang) => update({ lang }),
            )}
          </div>
        </div>
      </div>
    </section>
  `;
}
