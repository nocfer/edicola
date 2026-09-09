// Publications: the Catalog by Nation and then Category, a switch per
// Publication, and "add by URL" for anything the Catalog is missing (ADR-0005).
//
// The data model is `src/catalog.js`: the shipped `data/catalog.json` merged
// with the reader's `publications` table. This file is the browser half — the
// database handle, the fetcher, the DOM — and holds the screen's own transient
// state (which groups are collapsed, what the add-by-URL form is doing) in one
// module-level object. That state is not app state: nothing outside this screen
// reads it and it does not survive a reload, so it stays out of `state.js`.
// Every mutation still ends in a bare `update()`, so the single subscriber in
// main.js is what redraws (CLAUDE.md).
//
// The Nation selection *is* a reader preference, so it goes through the one
// settings layer (`src/settings.js`: `getNations` / `setNations`) and is handed
// to `loadPublications` as data. This screen is that row's only writer. The
// Language it may seed on first run belongs to `localStorage['edicola.lang']`
// (`src/i18n.js`), which is the app's single copy of it.

import {
  addCustomPublication,
  CUSTOM_GROUP,
  findFeeds,
  groupByNation,
  guessOrigin,
  loadPublications,
  removeCustomPublication,
  setPublicationEnabled,
} from "../catalog.js";
import { getDatabase } from "../db.js";
import { LANG_KEY, LOCALES, t, tCount } from "../i18n.js";
import {
  countUnreadByPublication,
  markPublicationRead,
} from "../item-state.js";
import { html, nothing, repeat } from "../render.js";
import { parseRoute } from "../router.js";
import { getSettingsStore, pageFetcher } from "../settings.js";
import { showToast, state, update } from "../state.js";
import { syncNow } from "../sync-client.js";
import { emptyState, screenHeader } from "./layout.js";

/** @typedef {import('../catalog.js').CatalogEntry} CatalogEntry */
/** @typedef {import('../catalog.js').FeedFinding} FeedFinding */

/**
 * Honest copy for the failure kinds the fetcher and the Feed lookup report
 * (`FetchFailureKind` plus `invalid-url` and `no-feed`). A kind with no entry
 * here — a Feed parser reason such as `malformed-xml` — has no honest short
 * sentence, so the screen says the generic one for the form and stays silent on
 * a Publication row.
 */
const ERROR_KEYS = Object.freeze({
  "invalid-url": "pubs.error.invalidUrl",
  "no-feed": "pubs.error.noFeed",
  offline: "pubs.error.offline",
  blocked: "pubs.error.blocked",
  "not-found": "pubs.error.notFound",
  timeout: "pubs.error.timeout",
  "too-large": "pubs.error.tooLarge",
  "proxy-unconfigured": "pubs.error.proxy",
});

/**
 * The add-by-URL form.
 * @typedef {object} AddState
 * @property {string} url What the reader typed.
 * @property {'idle'|'looking'|'found'|'error'} status
 * @property {FeedFinding[]} findings
 * @property {string|null} errorKind
 * @property {null | { feedUrl: string, name: string, country: string, language: string, siteUrl: string|null, truncated: boolean }} draft
 * @property {boolean} saving
 */

/**
 * This screen's transient state.
 * @typedef {object} ScreenState
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {CatalogEntry[]} entries
 * @property {string[]} nations
 * @property {string[]} selectedNations
 * @property {string[]} categories
 * @property {import('../catalog.js').Catalog|null} catalog
 * @property {Set<string>} collapsed Keys are `country/category`.
 * @property {Set<string>} busy Publication ids with a write in flight.
 * @property {Map<string, number>} unread Unread Items per Publication id.
 * @property {AddState} add
 */

/** @type {ScreenState} */
const screen = {
  status: "idle",
  entries: [],
  nations: [],
  selectedNations: [],
  categories: [],
  catalog: null,
  collapsed: new Set(),
  busy: new Set(),
  unread: new Map(),
  add: {
    url: "",
    status: "idle",
    findings: [],
    errorKind: null,
    draft: null,
    saving: false,
  },
};

/** @param {unknown} error */
function errorKindOf(error) {
  const kind = /** @type {{ kind?: unknown }} */ (error)?.kind;
  return typeof kind === "string" ? kind : "unknown";
}

/** @param {string|null} kind */
function errorKeyFor(kind) {
  return ERROR_KEYS[kind ?? ""] || "pubs.error.unknown";
}

/** The Nation's name in the current Language, or its code if Intl cannot. */
const nationNames = new Map();
/** @param {string} country */
function nationName(country) {
  const locale = LOCALES[state.lang] || "en";
  const key = `${locale}:${country}`;
  if (!nationNames.has(key)) {
    let label = country;
    try {
      label =
        new Intl.DisplayNames([locale], { type: "region" }).of(country) ||
        country;
    } catch {
      label = country;
    }
    nationNames.set(key, label);
  }
  return nationNames.get(key);
}

/** @param {string} url */
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Put a Nation list back into the Catalog's own order. */
function inCatalogOrder(nations) {
  return screen.nations.filter((country) => nations.includes(country));
}

// --- The Nation selection (the one setting this screen owns) ---------------

/**
 * The stored Nation selection; `[]` when the reader has never chosen, which is
 * the first-run signal `loadPublications` seeds from.
 * @returns {Promise<string[]>}
 */
async function readNations() {
  return await (await getSettingsStore()).getNations();
}

/**
 * Persist the Nation selection. The store refuses an empty list, so every
 * caller has already checked that at least one Nation stays selected.
 * @param {readonly string[]} nations
 * @returns {Promise<void>}
 */
async function saveNations(nations) {
  await (await getSettingsStore()).setNations(nations);
}

// --- Loading ---------------------------------------------------------------

/**
 * Load (or reload) the Catalog and the reader's rows. `seed` runs the first-run
 * inference and applies the Language it suggests; a refresh after a write skips
 * both.
 * @param {{ seed?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function load({ seed = false } = {}) {
  try {
    const db = getDatabase();
    const data = await loadPublications(db, {
      languages: navigator.languages ? [...navigator.languages] : [],
      catalog: screen.catalog ?? undefined,
      selectedNations: await readNations(),
    });
    screen.catalog = data.catalog;
    screen.categories = data.catalog.categories || [];
    screen.entries = data.entries;
    screen.nations = data.nations;
    screen.selectedNations = data.selectedNations;
    screen.status = "ready";
    await loadUnread();
    if (seed) applyInferredLang(data.inferredLang);
    if (data.inferredNations) await saveNations(data.inferredNations);
  } catch (error) {
    console.warn("Catalog could not be loaded:", error);
    if (screen.status !== "ready") screen.status = "error";
  }
  update();
}

/**
 * Unread counts per Publication, by indexed query (`item-state.js`): one range
 * on the `publicationId` index per Enabled Publication, counted while
 * streaming. Only Enabled Publications are counted — a Publication that is off
 * takes no part in a Sync and shows no badge.
 * @returns {Promise<void>}
 */
async function loadUnread() {
  try {
    const ids = screen.entries.filter((e) => e.enabled).map((e) => e.id);
    screen.unread = await countUnreadByPublication(getDatabase(), ids);
  } catch (error) {
    console.warn("Unread counts could not be read:", error);
  }
}

let started = false;

/** Load once, the first time the screen renders. */
function ensureLoaded() {
  if (started) return;
  started = true;
  screen.status = "loading";
  installListeners();
  void load({ seed: true });
}

let installed = false;
/** Whether the last hash change took us off Publications. */
let leftPublications = false;

/**
 * Re-count Unread when the reader comes back, because opening an Item in the
 * Reader is what makes a count stale (spec story 21). Hangs off `hashchange`
 * for the reason ticket 09 documented: while another screen is open this one
 * is not rendered, so a view-side route check never sees the route leave.
 */
function installListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("hashchange", () => {
    const onPublications = parseRoute(location.hash).name === "publications";
    if (!onPublications) {
      leftPublications = true;
      return;
    }
    if (!leftPublications) return;
    leftPublications = false;
    void loadUnread().then(() => update());
  });
}

/**
 * Mark every Item of one Publication Read, from its row. The count drops
 * immediately; `item-state.js` writes the Publication's whole index range, not
 * just what a screen happens to be showing.
 * @param {CatalogEntry} entry
 * @returns {Promise<void>}
 */
async function markAllRead(entry) {
  try {
    await markPublicationRead(getDatabase(), entry.id);
    screen.unread.set(entry.id, 0);
    showToast(t("today.markedAllRead", { name: entry.name }));
  } catch (error) {
    console.warn("Items could not be marked read:", error);
    showToast(t("pubs.error.unknown"));
  }
  update();
}

/**
 * Apply the Language the browser locale suggests (ADR-0006), but only on first
 * run and only while the reader has not chosen one. `edicola.lang` in
 * localStorage is the app's single copy of the Language and is written the
 * moment they pick one in Settings, so its absence is exactly "not chosen yet";
 * `update({ lang })` then flows through main.js's `applyLang`, which calls
 * `setLang` and so writes that key. Nothing is stored in the database.
 * @param {import('../state.js').Lang|null} inferred
 */
function applyInferredLang(inferred) {
  if (!inferred || inferred === state.lang) return;
  let saved = null;
  try {
    saved = localStorage.getItem(LANG_KEY);
  } catch {
    saved = null;
  }
  if (!saved) update({ lang: inferred });
}

// --- Writes ----------------------------------------------------------------

/**
 * Runs queued one after another: `syncNow` joins a run already in flight
 * instead of starting a second one, so switching three Publications on in a row
 * would otherwise Sync only the first. Each waits for the previous to finish,
 * when `sync-client.js` is free again.
 * @type {Promise<unknown>}
 */
let syncQueue = Promise.resolve();

/**
 * Start a Sync for one Publication and refresh the rows when it finishes, so
 * the row shows what happened.
 * @param {{ id: string, name: string }} publication
 */
function startSync(publication) {
  showToast(t("pubs.syncStarted", { name: publication.name }));
  syncQueue = syncQueue
    .catch(() => {})
    .then(() => syncNow({ publicationIds: [publication.id] }))
    .then(() => load())
    .catch((error) => {
      console.warn("Sync failed:", error);
      showToast(t("sync.error"));
    });
}

/**
 * Switch a Publication on or off. The write lands immediately; switching one on
 * while online Syncs that Publication alone.
 * @param {CatalogEntry} entry
 */
async function toggle(entry) {
  if (screen.busy.has(entry.id)) return;
  const enabled = !entry.enabled;
  screen.busy.add(entry.id);
  update();
  try {
    await setPublicationEnabled(getDatabase(), entry, enabled);
    entry.enabled = enabled;
  } catch (error) {
    console.warn("Publication could not be switched:", error);
    showToast(t("pubs.error.unknown"));
  } finally {
    screen.busy.delete(entry.id);
    update();
  }
  if (entry.enabled && state.online) startSync(entry);
}

/**
 * Show or hide a Nation. At least one has to stay selected.
 * @param {string} country
 */
async function toggleNation(country) {
  const next = screen.selectedNations.includes(country)
    ? screen.selectedNations.filter((c) => c !== country)
    : [...screen.selectedNations, country];
  if (next.length === 0) {
    showToast(t("pubs.needNation"));
    return;
  }
  screen.selectedNations = inCatalogOrder(next);
  update();
  try {
    await saveNations(screen.selectedNations);
  } catch (error) {
    console.warn("Nation selection could not be saved:", error);
  }
}

/**
 * Make sure a Nation is visible, used after adding a Custom Publication from a
 * Nation the reader had switched off.
 * @param {string} country
 */
async function ensureNationSelected(country) {
  if (!country || screen.selectedNations.includes(country)) return;
  screen.selectedNations = inCatalogOrder([...screen.selectedNations, country]);
  try {
    await saveNations(screen.selectedNations);
  } catch (error) {
    console.warn("Nation selection could not be saved:", error);
  }
}

/** @param {CatalogEntry} entry */
async function removeCustom(entry) {
  try {
    await removeCustomPublication(getDatabase(), entry.id);
    showToast(t("pubs.removedToast", { name: entry.name }));
    await load();
  } catch (error) {
    console.warn("Custom Publication could not be removed:", error);
    showToast(t("pubs.error.unknown"));
  }
}

// --- Add by URL ------------------------------------------------------------

/** Run the Feed lookup for whatever is in the input. */
async function lookUp() {
  const add = screen.add;
  if (add.status === "looking" || !add.url.trim()) return;
  add.status = "looking";
  add.errorKind = null;
  add.findings = [];
  add.draft = null;
  update();
  try {
    const findings = await findFeeds(add.url, {
      fetcher: await pageFetcher(),
      DOMParser,
    });
    add.status = "found";
    add.findings = findings;
    if (findings.length === 1) add.draft = draftFor(findings[0]);
  } catch (error) {
    add.status = "error";
    add.errorKind = errorKindOf(error);
  }
  update();
}

/**
 * The editable form for one found Feed, filled in from the Feed's own declared
 * language (ADR-0006 keeps Nation and Language separate, so both are guessed
 * and both can be corrected).
 * @param {FeedFinding} finding
 */
function draftFor(finding) {
  const origin = guessOrigin(finding.language, {
    country: screen.selectedNations[0],
    language: state.lang,
  });
  return {
    feedUrl: finding.feedUrl,
    name: finding.title,
    country: origin.country,
    language: origin.language,
    siteUrl: finding.siteUrl,
    truncated: finding.truncated,
  };
}

/** @param {FeedFinding} finding */
function pick(finding) {
  screen.add.draft = draftFor(finding);
  update();
}

function cancelAdd() {
  screen.add.status = "idle";
  screen.add.findings = [];
  screen.add.errorKind = null;
  screen.add.draft = null;
  update();
}

/** Create the Custom Publication the draft describes and Sync it. */
async function confirmAdd() {
  const add = screen.add;
  const draft = add.draft;
  if (!draft || add.saving) return;
  add.saving = true;
  update();
  // Run the edited Nation and Language back through the same guess, so a typo
  // ("i", "") normalizes instead of storing nonsense.
  const origin = guessOrigin(`${draft.language}-${draft.country}`, {
    country: screen.selectedNations[0],
    language: state.lang,
  });
  try {
    const row = await addCustomPublication(getDatabase(), {
      feedUrl: draft.feedUrl,
      name: draft.name,
      country: origin.country,
      language: origin.language,
      siteUrl: draft.siteUrl ?? undefined,
      truncated: draft.truncated,
      enabled: true,
    });
    add.url = "";
    add.status = "idle";
    add.findings = [];
    add.draft = null;
    showToast(t("pubs.add.added", { name: row.name }));
    await load();
    await ensureNationSelected(row.country);
    if (state.online) startSync(row);
  } catch (error) {
    console.warn("Custom Publication could not be added:", error);
    add.status = "error";
    add.errorKind = errorKindOf(error);
  } finally {
    add.saving = false;
    update();
  }
}

// --- Templates -------------------------------------------------------------

/**
 * One Publication row: name, the Unread count, the site domain, the honest
 * hints, "mark all read" while there is anything to mark, and the switch.
 * @param {CatalogEntry} entry
 */
function publicationRow(entry) {
  const hints = [domainOf(entry.siteUrl || entry.feedUrl)];
  if (entry.truncated) hints.push(t("pubs.truncated"));
  if (!entry.inCatalog && !entry.custom) hints.push(t("pubs.notInCatalog"));
  const errorKey = entry.lastError ? ERROR_KEYS[entry.lastError] : null;
  const busy = screen.busy.has(entry.id);
  const unread = entry.enabled ? (screen.unread.get(entry.id) ?? 0) : 0;
  return html`
    <div class="pub">
      <div class="pub__main">
        <span class="pub__name">
          ${entry.name}
          ${
            unread > 0
              ? html`<span
                  class="unread__count"
                  title=${t("today.unreadCount", { count: unread })}
                  >${unread}</span
                >`
              : nothing
          }
        </span>
        <span class="pub__meta">${hints.join(" · ")}</span>
        ${errorKey ? html`<span class="pub__warn">${t(errorKey)}</span>` : nothing}
        ${
          unread > 0
            ? html`<button
                type="button"
                class="btn unread__markread"
                aria-label=${`${t("today.markAllRead")} · ${entry.name}`}
                @click=${() => markAllRead(entry)}
              >
                ${t("today.markAllRead")}
              </button>`
            : nothing
        }
      </div>
      ${
        entry.custom
          ? html`<button
              type="button"
              class="btn pub__remove"
              @click=${() => removeCustom(entry)}
            >
              ${t("pubs.remove")}
            </button>`
          : nothing
      }
      <button
        type="button"
        role="switch"
        class="switch ${entry.enabled ? "switch--on" : ""}"
        aria-checked=${entry.enabled ? "true" : "false"}
        aria-label=${t("pubs.toggleAria", { name: entry.name })}
        ?disabled=${busy}
        @click=${() => toggle(entry)}
      >
        <span class="switch__knob"></span>
      </button>
    </div>
  `;
}

/**
 * One Category group inside a Nation: a header that collapses it, and its rows.
 * @param {string} country
 * @param {import('../catalog.js').CategoryGroup} group
 */
function categoryGroup(country, group) {
  const key = `${country}/${group.category}`;
  const open = !screen.collapsed.has(key);
  const label =
    group.category === CUSTOM_GROUP
      ? t("pubs.category.custom")
      : t(`pubs.category.${group.category}`);
  const enabled = group.publications.filter((p) => p.enabled).length;
  return html`
    <section class="card pubs__group">
      <button
        type="button"
        class="pubs__grouphead"
        aria-expanded=${open ? "true" : "false"}
        aria-label=${tCount("pubs.groupAria", group.publications.length, {
          category: label,
        })}
        @click=${() => {
          if (open) screen.collapsed.add(key);
          else screen.collapsed.delete(key);
          update();
        }}
      >
        <span class="pubs__grouptitle">${label}</span>
        <span class="pubs__groupcount">
          ${tCount("pubs.enabledCount", enabled, {
            total: group.publications.length,
          })}
        </span>
        <span class="pubs__chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
      </button>
      ${
        open
          ? html`<div class="pubs__rows">
              ${repeat(group.publications, (p) => p.id, publicationRow)}
            </div>`
          : nothing
      }
    </section>
  `;
}

/** The Nation chips: multi-select, at least one always on. */
function nationChips() {
  return html`
    <div class="card">
      <h2 class="card__title">${t("pubs.nations")}</h2>
      <div class="seg" role="group" aria-label=${t("pubs.nations")}>
        ${screen.nations.map((country) => {
          const on = screen.selectedNations.includes(country);
          return html`<button
            type="button"
            class="chip ${on ? "chip--on" : ""}"
            aria-pressed=${on ? "true" : "false"}
            @click=${() => toggleNation(country)}
          >
            ${nationName(country)}
          </button>`;
        })}
      </div>
    </div>
  `;
}

/** The Catalog itself: the intro line, the Nation chips and the groups. */
function catalogSection() {
  if (screen.entries.length === 0) {
    return emptyState(t("pubs.placeholder"));
  }
  const visible = screen.entries.filter((entry) =>
    screen.selectedNations.includes(entry.country),
  );
  const enabled = screen.entries.filter((entry) => entry.enabled).length;
  return html`
    <p class="pubs__intro">
      ${t("pubs.intro")}
      <span class="pubs__count">
        ${tCount("pubs.enabledCount", enabled, {
          total: screen.entries.length,
        })}
      </span>
    </p>
    ${nationChips()}
    ${groupByNation(visible, screen.categories).map(
      (nation) => html`
        <section class="pubs__nation">
          <h2 class="pubs__nationtitle">${nationName(nation.country)}</h2>
          ${nation.groups.map((group) => categoryGroup(nation.country, group))}
        </section>
      `,
    )}
  `;
}

/** The list of Feeds the lookup found, each offering to fill the form. */
function findingsList() {
  return html`
    <h3 class="pubs__subtitle">${t("pubs.add.found")}</h3>
    <div class="pubs__rows">
      ${screen.add.findings.map(
        (finding) => html`
          <div class="pub">
            <div class="pub__main">
              <span class="pub__name">${finding.title}</span>
              <span class="pub__meta">
                ${[
                  domainOf(finding.feedUrl),
                  tCount("pubs.add.items", finding.itemCount),
                  finding.truncated ? t("pubs.truncated") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <button type="button" class="btn" @click=${() => pick(finding)}>
              ${t("pubs.add.use")}
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

/**
 * One editable field of the draft form.
 * @param {string} label
 * @param {string} value
 * @param {(next: string) => void} onInput
 * @param {{ maxlength?: number, short?: boolean }} [options]
 */
function draftField(label, value, onInput, options = {}) {
  return html`
    <label class="pubs__field ${options.short ? "pubs__field--short" : ""}">
      <span class="pubs__fieldlabel">${label}</span>
      <input
        class="input"
        type="text"
        autocomplete="off"
        spellcheck="false"
        maxlength=${options.maxlength ?? 120}
        .value=${value}
        @input=${(event) => {
          onInput(event.currentTarget.value);
          update();
        }}
      />
    </label>
  `;
}

/** The form that creates the Custom Publication, pre-filled from the Feed. */
function draftForm() {
  const draft = screen.add.draft;
  if (!draft) return nothing;
  return html`
    <div class="pubs__draft">
      ${draftField(t("pubs.add.name"), draft.name, (next) => {
        draft.name = next;
      })}
      ${draftField(
        t("pubs.add.nation"),
        draft.country,
        (next) => {
          draft.country = next.toUpperCase();
        },
        { maxlength: 2, short: true },
      )}
      ${draftField(
        t("pubs.add.language"),
        draft.language,
        (next) => {
          draft.language = next.toLowerCase();
        },
        { maxlength: 3, short: true },
      )}
      <div class="pubs__actions">
        <button type="button" class="btn" @click=${cancelAdd}>
          ${t("pubs.add.cancel")}
        </button>
        <button
          type="button"
          class="btn btn--primary"
          ?disabled=${screen.add.saving}
          @click=${confirmAdd}
        >
          ${t("pubs.add.confirm")}
        </button>
      </div>
    </div>
  `;
}

/** The add-by-URL card: input, lookup button, findings, draft, errors. */
function addCard() {
  const add = screen.add;
  return html`
    <section class="card pubs__add">
      <h2 class="card__title">${t("pubs.add.title")}</h2>
      <p class="pubs__hint">${t("pubs.add.hint")}</p>
      <div class="pubs__addrow">
        <input
          class="input"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          aria-label=${t("pubs.add.title")}
          placeholder=${t("pubs.add.placeholder")}
          .value=${add.url}
          @input=${(event) => {
            add.url = event.currentTarget.value;
            update();
          }}
          @keydown=${(event) => {
            if (event.key === "Enter") void lookUp();
          }}
        />
        <button
          type="button"
          class="btn btn--primary"
          ?disabled=${add.status === "looking" || add.url.trim().length === 0}
          @click=${lookUp}
        >
          ${add.status === "looking" ? t("pubs.add.looking") : t("pubs.add.find")}
        </button>
      </div>
      ${
        add.status === "error"
          ? html`<p class="pubs__error" role="status">
              ${t(errorKeyFor(add.errorKind))}
            </p>`
          : nothing
      }
      ${add.findings.length > 0 ? findingsList() : nothing}
      ${draftForm()}
    </section>
  `;
}

/** @param {import('../state.js').State} appState */
export function publicationsView(appState) {
  ensureLoaded();
  return html`
    <section class="screen">
      ${screenHeader(appState, t("pubs.title"))}
      <div class="screen__body">
        ${
          screen.status === "loading" || screen.status === "idle"
            ? html`<p class="pubs__hint" role="status">${t("pubs.loading")}</p>`
            : nothing
        }
        ${
          screen.status === "error"
            ? emptyState(
                t("pubs.loadError"),
                html`<button
                  type="button"
                  class="btn btn--primary"
                  @click=${() => {
                    screen.status = "loading";
                    update();
                    void load({ seed: true });
                  }}
                >
                  ${t("pubs.retry")}
                </button>`,
              )
            : nothing
        }
        ${screen.status === "ready" ? catalogSection() : nothing}
        ${screen.status === "loading" ? nothing : addCard()}
      </div>
    </section>
  `;
}
