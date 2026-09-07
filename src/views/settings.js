// Settings: theme (system/light/dark), Language (en/it) and Sync. Ticket 12
// adds Proxy, Retention, storage and updates below these cards.
//
// The controls only write to the store; main.js applies the theme attribute,
// persists the choice and re-translates static copy when it renders. The one
// exception is Sync: "Sync now" starts real work, and `initSyncClient()` brings
// `state.sync.lastSyncAt` in step with the database the first time this screen
// renders (main.js cannot do it yet — ticket 09 owns the boot Sync).
import { html } from "../render.js";
import { formatRelative, LANGS, t } from "../i18n.js";
import { showToast, update } from "../state.js";
import { initSyncClient, syncNow } from "../sync-client.js";
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

/**
 * One line under the "Sync now" button: what the Sync is doing while it runs,
 * what the last one did once it has finished, and nothing before the first one.
 * @param {import('../state.js').SyncState} sync
 * @returns {string}
 */
function syncStatusLine(sync) {
  if (sync.running) {
    const key = sync.phase === "articles" ? "sync.articles" : "sync.feeds";
    return t(key, { done: sync.done, total: sync.total });
  }
  const summary = sync.lastSummary;
  if (!summary) return "";
  const line = t("sync.summary", {
    items: summary.itemsStored,
    articles: summary.articlesOk,
    images: summary.imagesStored,
  });
  if (summary.feedsFailed === 0) return line;
  return `${line} — ${t("sync.failed", { count: summary.feedsFailed })}`;
}

/** @param {import('../state.js').State} state */
export function settingsView(state) {
  initSyncClient();
  const sync = state.sync;
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
        <div class="card">
          <h2 class="card__title">${t("sync.title")}</h2>
          <div class="row">
            <span class="row__label">${t("sync.lastSynced")}</span>
            <span class="sync__when">
              ${
                sync.lastSyncAt
                  ? formatRelative(sync.lastSyncAt)
                  : t("sync.never")
              }
            </span>
          </div>
          <div class="row sync__actions">
            <button
              type="button"
              class="btn btn--primary"
              ?disabled=${sync.running}
              @click=${() => {
                syncNow().catch(() => showToast(t("sync.error")));
              }}
            >
              ${sync.running ? t("sync.running") : t("sync.now")}
            </button>
            <span class="sync__progress" role="status" aria-live="polite">
              ${syncStatusLine(sync)}
            </span>
          </div>
        </div>
      </div>
    </section>
  `;
}
