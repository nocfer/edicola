// Settings: Appearance, Language, Sync, Proxy, Retention, Storage and About.
//
// The controls only write to the store; main.js applies the theme attribute,
// persists the choice and re-translates static copy when it renders. The
// exceptions are the ones that do real work — Sync, saving the Proxy or
// Retention, measuring storage, and the two destructive actions — which run
// here and publish their result back through `update()`.
//
// Everything that touches the database goes through the typed layers
// (`src/settings.js`, `src/storage-usage.js`), never Dexie directly, so this
// file stays a view: reads state, renders, calls a named action.

import { html, nothing } from "../render.js";
import { APP_VERSION, getDatabase, META_KEYS, SCHEMA_VERSION } from "../db.js";
import { DEFAULT_PROXY_SERVICE, DEFAULT_PROXY_TEMPLATE } from "../fetcher.js";
import { formatRelative, LANGS, LOCALES, t, tCount } from "../i18n.js";
import { hrefFor } from "../router.js";
import { DEFAULT_RETENTION } from "../retention.js";
import {
  getSettingsStore,
  MIB,
  normalizeRetention,
  retentionEquals,
  RETENTION_BOUNDS,
  RETENTION_FIELDS,
  retentionShrank,
  testProxyTemplate,
  usesDefaultProxy,
  validateProxyTemplate,
} from "../settings.js";
import {
  clearContent,
  countEnabledPublications,
  formatBytes,
  readStorageUsage,
  resetApp,
  STORAGE_TABLES,
} from "../storage-usage.js";
import { showToast, state as appState, update } from "../state.js";
import { getSyncStore } from "../store.js";
import { syncNow } from "../sync-client.js";
import { screenHeader } from "./layout.js";

/** @typedef {import('../retention.js').RetentionLimits} RetentionLimits */

/** @type {import('../state.js').ThemePreference[]} */
const THEMES = ["system", "light", "dark"];

/** Where the reader learns to run their own relay (ticket 13 writes it). */
const SELF_HOST_URL = "./README.md#self-hosting-the-proxy";

/**
 * Ticket 11's Eviction module, named at runtime rather than imported
 * statically: it does not exist on this branch, and a static import would stop
 * the whole Shell from linking. Widened to `string` so `tsc` does not try to
 * resolve a file that is not there yet either.
 * @type {string}
 */
const EVICT_MODULE = "../evict.js";

/**
 * Merge a patch into `state.settings` and redraw. The one writer of that slice.
 * @param {Partial<import('../state.js').SettingsState>} next
 */
function patchSettings(next) {
  update({ settings: { ...appState.settings, ...next } });
}

// --- Actions ---------------------------------------------------------------

let loading = false;

/**
 * Read the `settings` table and count Enabled Publications, once per session.
 * Idempotent, so the render may call it: the screen paints with defaults and
 * fills in when the database answers.
 * @returns {void}
 */
export function loadSettings() {
  if (loading || appState.settings.loaded) return;
  loading = true;
  void (async () => {
    try {
      const store = await getSettingsStore();
      const settings = await store.read();
      const enabled = await countEnabledPublications(getDatabase());
      patchSettings({
        loaded: true,
        proxyTemplate: settings.proxyTemplate,
        proxyDraft: settings.proxyTemplate,
        retention: settings.retention,
        retentionDraft: settings.retention,
        enabledPublications: enabled,
      });
      measureStorage();
    } catch (error) {
      console.warn("Settings could not be read:", error);
      patchSettings({ loaded: true });
    } finally {
      loading = false;
    }
  })();
}

/**
 * Measure the browser's estimate and the per-table byte counts.
 * @returns {void}
 */
function measureStorage() {
  if (appState.settings.storageMeasuring) return;
  patchSettings({ storageMeasuring: true });
  void readStorageUsage({
    db: getDatabase(),
    getMeta: (key) => getSyncStore().getMeta(key),
    persistentStorageKey: META_KEYS.persistentStorage,
  })
    .then((storage) =>
      patchSettings({
        storage,
        storageMeasuring: false,
        enabledPublications: storage.enabledPublications,
      }),
    )
    .catch((error) => {
      console.warn("Storage could not be measured:", error);
      patchSettings({ storageMeasuring: false });
    });
}

/**
 * Store the Proxy template in the draft, so `Save` knows there is a change.
 * @param {string} value
 */
function editProxy(value) {
  patchSettings({ proxyDraft: value, proxyTest: null });
}

/**
 * Save the Proxy template the reader typed (empty = back to the default).
 * @returns {void}
 */
function saveProxy() {
  const draft = appState.settings.proxyDraft;
  if (!validateProxyTemplate(draft).valid) return;
  patchSettings({ busy: true });
  void (async () => {
    try {
      const store = await getSettingsStore();
      const saved = await store.setProxyTemplate(draft);
      patchSettings({ proxyTemplate: saved, proxyDraft: saved, busy: false });
      showToast(t("settings.proxy.saved"));
    } catch (error) {
      console.warn("Proxy could not be saved:", error);
      patchSettings({ busy: false });
      showToast(t("settings.error"));
    }
  })();
}

/**
 * Fetch a real Feed through the drafted template and report what came back.
 * @returns {void}
 */
function testProxy() {
  if (appState.settings.proxyTesting) return;
  patchSettings({ proxyTesting: true, proxyTest: null });
  void testProxyTemplate(appState.settings.proxyDraft, {
    onLine: () => navigator.onLine,
  })
    .then((proxyTest) => patchSettings({ proxyTest, proxyTesting: false }))
    .catch(() => patchSettings({ proxyTesting: false }));
}

/**
 * Change one Retention limit in the draft. Values are kept exactly as typed and
 * clamped on save (`normalizeRetention`), so typing "5" on the way to "50" is
 * not fought by the input.
 * @param {keyof RetentionLimits} field
 * @param {string} raw  the input's value, in the unit the screen shows
 */
function editRetention(field, raw) {
  const draft = appState.settings.retentionDraft;
  if (!draft) return;
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  const bound = RETENTION_BOUNDS[field];
  patchSettings({
    retentionDraft: {
      ...draft,
      [field]: bound.unit === "bytes" ? Math.round(n * MIB) : Math.round(n),
    },
  });
}

/**
 * Save the Retention limits and, when a limit that governs stored content
 * shrank, Evict what now falls outside them.
 * @returns {void}
 */
function saveRetention() {
  const draft = appState.settings.retentionDraft;
  const stored = appState.settings.retention;
  if (!draft || !stored) return;
  patchSettings({ busy: true });
  void (async () => {
    try {
      const store = await getSettingsStore();
      const saved = await store.setRetention(normalizeRetention(draft));
      patchSettings({ retention: saved, retentionDraft: saved, busy: false });
      if (!retentionShrank(stored, saved)) {
        showToast(t("settings.retention.saved"));
        return;
      }
      const evicted = await runEvictionIfAvailable(saved);
      showToast(
        evicted
          ? tCount("settings.retention.evicted", evicted.deleted.length)
          : t("settings.retention.evictionPending"),
      );
      measureStorage();
    } catch (error) {
      console.warn("Retention could not be saved:", error);
      patchSettings({ busy: false });
      showToast(t("settings.error"));
    }
  })();
}

/** Put the shipped defaults back in the draft (the reader still saves them). */
function resetRetentionDraft() {
  patchSettings({ retentionDraft: normalizeRetention(DEFAULT_RETENTION) });
}

/**
 * SEAM — Eviction lives in ticket 11's `src/evict.js`, which does not exist on
 * this branch. Shrinking a Retention limit must Evict what now falls outside
 * it, so this calls `runEviction({ store, limits, now })` when that module has
 * landed and resolves with null when it has not (the reader is then told the
 * new limits apply at the next Sync, which is true: `runSync` trims per
 * Publication). The dynamic import is what keeps this branch loadable without
 * the file; the integrator does not need to change anything for it to start
 * working — dropping `src/evict.js` in is enough.
 *
 * @param {RetentionLimits} limits
 * @returns {Promise<{ deleted: string[], bytesFreed: number } | null>}
 */
async function runEvictionIfAvailable(limits) {
  try {
    const module = await import(EVICT_MODULE);
    if (typeof module.runEviction !== "function") return null;
    return await module.runEviction({
      store: getSyncStore(),
      limits,
      now: Date.now(),
    });
  } catch {
    // Not merged yet, or it threw: never let Eviction fail a settings save.
    return null;
  }
}

/** Remove every Item, Article and image, behind a confirm. */
function clearAllContent() {
  if (!confirm(t("settings.storage.clear.confirm"))) return;
  patchSettings({ busy: true });
  void clearContent(getDatabase(), { lastSyncAtKey: META_KEYS.lastSyncAt })
    .then(() => {
      update({
        sync: { ...appState.sync, lastSyncAt: null, lastSummary: null },
      });
      patchSettings({ busy: false });
      showToast(t("settings.storage.clear.done"));
      measureStorage();
    })
    .catch((error) => {
      console.warn("Content could not be cleared:", error);
      patchSettings({ busy: false });
      showToast(t("settings.error"));
    });
}

/** Delete the database and every preference, then reload. Behind a confirm. */
function resetEverything() {
  if (!confirm(t("settings.storage.reset.confirm"))) return;
  patchSettings({ busy: true });
  void resetApp(getDatabase())
    .then(() => location.reload())
    .catch((error) => {
      console.warn("App could not be reset:", error);
      patchSettings({ busy: false });
      showToast(t("settings.error"));
    });
}

// --- Pieces ----------------------------------------------------------------

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
  return `${line} — ${tCount("sync.failed", summary.feedsFailed)}`;
}

/**
 * The Sync card. With no Enabled Publication a Sync has nothing to fetch, yet
 * it still stamps `meta.lastSyncAt`, so "Last synced: now" would be true and
 * useless. Say what is actually wrong instead and point at the Publications tab.
 * @param {import('../state.js').State} state
 */
function syncCard(state) {
  const { sync, settings } = state;
  const nothingEnabled = settings.loaded && settings.enabledPublications === 0;
  return html`
    <div class="card">
      <h2 class="card__title">${t("sync.title")}</h2>
      ${
        nothingEnabled
          ? html`
            <div class="row">
              <span class="row__label">${t("settings.sync.noPublications")}</span>
              <a class="btn" href=${hrefFor("publications")}>
                ${t("settings.sync.choose")}
              </a>
            </div>
          `
          : html`
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
          `
      }
    </div>
  `;
}

/**
 * The "Test" result, or the validation problem, as one line.
 * @param {import('../state.js').SettingsState} settings
 */
function proxyStatusLine(settings) {
  const check = validateProxyTemplate(settings.proxyDraft);
  if (!check.valid)
    return html`<p class="settings__error" role="alert">
      ${t(`settings.proxy.invalid.${check.problem}`)}
    </p>`;
  if (settings.proxyTesting)
    return html`<p class="settings__hint">${t("settings.proxy.testing")}</p>`;
  const result = settings.proxyTest;
  if (!result) return nothing;
  if (result.ok)
    return html`<p class="settings__ok" role="status">
      ${t("settings.proxy.testOk", {
        bytes: formatBytes(result.bytes, LOCALES[appState.lang]),
      })}
      ${result.kind === "direct" ? t("settings.proxy.testDirect") : ""}
    </p>`;
  return html`<p class="settings__error" role="status">
    ${t("settings.proxy.testFailed", { kind: result.kind ?? "blocked" })}
  </p>`;
}

/**
 * The Proxy card: what is in use, the default in full, the reader's own
 * template with validation and a real "Test", and the way out of the default.
 * ADR-0001 makes the override the mitigation for a fragile shared relay, so it
 * is a full-width field on this screen, not a hidden advanced option.
 * @param {import('../state.js').State} state
 */
function proxyCard(state) {
  const { settings } = state;
  const check = validateProxyTemplate(settings.proxyDraft);
  const dirty = settings.proxyDraft.trim() !== settings.proxyTemplate;
  return html`
    <div class="card">
      <h2 class="card__title">${t("settings.proxy")}</h2>
      <p class="settings__about">${t("settings.proxy.about")}</p>
      <div class="row">
        <span class="row__label">${t("settings.proxy.inUse")}</span>
        <span class="settings__value">
          ${
            usesDefaultProxy(settings.proxyTemplate)
              ? t("settings.proxy.usingDefault")
              : t("settings.proxy.usingCustom")
          }
        </span>
      </div>
      <div class="settings__field">
        <span class="settings__label">
          ${t("settings.proxy.default")} — ${DEFAULT_PROXY_SERVICE}
        </span>
        <code class="settings__code">${DEFAULT_PROXY_TEMPLATE}</code>
        <p class="settings__hint">${t("settings.proxy.defaultNote")}</p>
      </div>
      <div class="settings__field">
        <label class="settings__label" for="proxy-template">
          ${t("settings.proxy.custom")}
        </label>
        <input
          id="proxy-template"
          class="input settings__input"
          type="url"
          inputmode="url"
          spellcheck="false"
          autocomplete="off"
          placeholder=${DEFAULT_PROXY_TEMPLATE}
          aria-describedby="proxy-hint"
          aria-invalid=${!check.valid}
          .value=${settings.proxyDraft}
          @input=${(/** @type {Event} */ event) =>
            editProxy(/** @type {HTMLInputElement} */ (event.target).value)}
        />
        <p class="settings__hint" id="proxy-hint">
          ${t("settings.proxy.hint")}
        </p>
        ${proxyStatusLine(settings)}
        <div class="settings__actions">
          <button
            type="button"
            class="btn btn--primary"
            ?disabled=${!check.valid || !dirty || settings.busy}
            @click=${saveProxy}
          >
            ${t("settings.proxy.save")}
          </button>
          <button
            type="button"
            class="btn"
            ?disabled=${!check.valid || settings.proxyTesting}
            @click=${testProxy}
          >
            ${
              settings.proxyTesting
                ? t("settings.proxy.testing")
                : t("settings.proxy.test")
            }
          </button>
          <button
            type="button"
            class="btn"
            ?disabled=${settings.proxyDraft === "" || settings.busy}
            @click=${() => editProxy("")}
          >
            ${t("settings.proxy.useDefault")}
          </button>
        </div>
        <p class="settings__hint">
          <a href=${SELF_HOST_URL} target="_blank" rel="noopener">
            ${t("settings.proxy.selfHost")}
          </a>
        </p>
      </div>
    </div>
  `;
}

/**
 * One Retention limit as a number input, labelled with its default. Byte limits
 * are edited in MB; everything else in its own unit.
 * @param {keyof RetentionLimits} field
 * @param {RetentionLimits} draft
 * @param {boolean} disabled
 */
function retentionRow(field, draft, disabled) {
  const bound = RETENTION_BOUNDS[field];
  const scale = bound.unit === "bytes" ? MIB : 1;
  const shown = Math.round(draft[field] / scale);
  const fallback = Math.round(DEFAULT_RETENTION[field] / scale);
  const id = `retention-${field}`;
  return html`
    <div class="row settings__limit">
      <label class="row__label" for=${id}>
        ${t(`settings.retention.${field}`)}
        <span class="settings__default">
          ${t("settings.retention.default", { value: fallback })}
        </span>
      </label>
      <span class="settings__number">
        <input
          id=${id}
          class="input input--number"
          type="number"
          inputmode="numeric"
          min=${Math.round(bound.min / scale)}
          max=${Math.round(bound.max / scale)}
          step=${Math.max(1, Math.round(bound.step / scale))}
          ?disabled=${disabled}
          .value=${String(shown)}
          @input=${(/** @type {Event} */ event) =>
            editRetention(
              field,
              /** @type {HTMLInputElement} */ (event.target).value,
            )}
        />
        <span class="settings__unit">
          ${t(`settings.retention.unit.${bound.unit}`)}
        </span>
      </span>
    </div>
  `;
}

/**
 * The Retention card. Saving a smaller limit Evicts (see
 * `runEvictionIfAvailable`); saving a larger one only changes what the next
 * Sync keeps.
 * @param {import('../state.js').State} state
 */
function retentionCard(state) {
  const { settings } = state;
  const draft = settings.retentionDraft ?? normalizeRetention(null);
  const stored = settings.retention ?? normalizeRetention(null);
  const dirty = !retentionEquals(normalizeRetention(draft), stored);
  return html`
    <div class="card">
      <h2 class="card__title">${t("settings.retention")}</h2>
      <p class="settings__about">${t("settings.retention.about")}</p>
      ${RETENTION_FIELDS.map((field) =>
        retentionRow(field, draft, settings.busy),
      )}
      <div class="settings__actions">
        <button
          type="button"
          class="btn btn--primary"
          ?disabled=${!dirty || settings.busy}
          @click=${saveRetention}
        >
          ${t("settings.retention.save")}
        </button>
        <button
          type="button"
          class="btn"
          ?disabled=${settings.busy}
          @click=${resetRetentionDraft}
        >
          ${t("settings.retention.reset")}
        </button>
      </div>
    </div>
  `;
}

/**
 * Label for whatever `navigator.storage.persist()` answered, as recorded in
 * `meta` by the first Sync (ADR-0003).
 * @param {boolean | 'unsupported' | null} persistent
 * @returns {string}
 */
function persistentLabel(persistent) {
  if (persistent === true) return t("settings.storage.persistent.granted");
  if (persistent === false) return t("settings.storage.persistent.denied");
  if (persistent === "unsupported")
    return t("settings.storage.persistent.unsupported");
  return t("settings.storage.persistent.unknown");
}

/**
 * The Storage card: the browser's padded per-origin estimate, the per-table
 * breakdown measured from the rows, whether the database is persistent, and the
 * two destructive actions.
 * @param {import('../state.js').State} state
 */
function storageCard(state) {
  const { settings } = state;
  const usage = settings.storage;
  const locale = LOCALES[state.lang];
  /** @param {number | null | undefined} value */
  const showBytes = (value) =>
    typeof value === "number"
      ? formatBytes(value, locale)
      : t("settings.storage.unknown");
  return html`
    <div class="card">
      <h2 class="card__title">${t("settings.storage")}</h2>
      <p class="settings__about">${t("settings.storage.about")}</p>
      <div class="row">
        <span class="row__label">${t("settings.storage.used")}</span>
        <span class="settings__value">${showBytes(usage?.usage)}</span>
      </div>
      <div class="row">
        <span class="row__label">${t("settings.storage.quota")}</span>
        <span class="settings__value">${showBytes(usage?.quota)}</span>
      </div>
      <div class="row">
        <span class="row__label">${t("settings.storage.content")}</span>
        <span class="settings__value">${showBytes(usage?.tablesBytes)}</span>
      </div>
      <div class="row">
        <span class="row__label">${t("settings.storage.persistent")}</span>
        <span class="settings__value">
          ${persistentLabel(usage?.persistent ?? null)}
        </span>
      </div>
      <div class="row">
        <span class="row__label">${t("settings.storage.savedItems")}</span>
        <span class="settings__value">${usage?.savedItems ?? 0}</span>
      </div>
      <h3 class="settings__subtitle">${t("settings.storage.tables")}</h3>
      <ul class="settings__tables">
        ${(
          usage?.tables ??
            STORAGE_TABLES.map((table) => ({ table, rows: 0, bytes: 0 }))
        ).map(
          (entry) => html`
            <li class="settings__table">
              <span class="settings__table-name">
                ${t(`settings.storage.table.${entry.table}`)}
              </span>
              <span class="settings__table-rows">
                ${tCount("settings.storage.rows", entry.rows)}
              </span>
              <span class="settings__table-bytes">
                ${formatBytes(entry.bytes, locale)}
              </span>
            </li>
          `,
        )}
      </ul>
      <div class="settings__actions">
        <button
          type="button"
          class="btn"
          ?disabled=${settings.storageMeasuring}
          @click=${measureStorage}
        >
          ${
            settings.storageMeasuring
              ? t("settings.storage.measuring")
              : t("settings.storage.measure")
          }
        </button>
      </div>
      <div class="settings__danger">
        <p class="settings__hint">${t("settings.storage.clear.hint")}</p>
        <button
          type="button"
          class="btn btn--danger"
          ?disabled=${settings.busy}
          @click=${clearAllContent}
        >
          ${t("settings.storage.clear")}
        </button>
        <p class="settings__hint">${t("settings.storage.reset.hint")}</p>
        <button
          type="button"
          class="btn btn--danger"
          ?disabled=${settings.busy}
          @click=${resetEverything}
        >
          ${t("settings.storage.reset")}
        </button>
      </div>
    </div>
  `;
}

/** Version and schema, so a bug report can name what was running. */
function aboutCard() {
  return html`
    <div class="card">
      <h2 class="card__title">${t("settings.about")}</h2>
      <div class="row">
        <span class="row__label">${t("settings.about.version")}</span>
        <span class="settings__value settings__value--mono">
          ${APP_VERSION}
        </span>
      </div>
      <div class="row">
        <span class="row__label">${t("settings.about.schema")}</span>
        <span class="settings__value settings__value--mono">
          ${SCHEMA_VERSION}
        </span>
      </div>
    </div>
  `;
}

/** @param {import('../state.js').State} state */
export function settingsView(state) {
  loadSettings();
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
        ${syncCard(state)}
        ${proxyCard(state)}
        ${retentionCard(state)}
        ${storageCard(state)}
        ${aboutCard()}
      </div>
    </section>
  `;
}
