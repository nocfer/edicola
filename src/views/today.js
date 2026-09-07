// Today: one timeline across the Enabled Publications, newest first, grouped by
// day under sticky headers (spec stories 10-14, 21).
//
// This is the browser half of the screen. Everything that decides *what* the
// list contains — the Retention window, the day sections, the localized
// headers, the per-Publication Unread counts — lives in `src/today-model.js`,
// pure and unit tested. Here we only do what a browser can do: read the Items
// out of Dexie, render the model, drive a Sync from the refresh control, write
// read state, and keep the reader's place in the list.
//
// Sync is *not* started here. `main.js` calls `initSyncClient()` and
// `syncIfStale()` at boot (spec story 29), so this screen reads `state.sync`
// and never writes it: a change to `state.sync` redraws the screen through the
// single subscriber, and a redraw is what schedules the reload that makes the
// list grow as Items arrive.
//
// The screen's transient state (which filter is on, which chip menu is open,
// the pull gesture, the scroll offset) is one module-level `screen` object, the
// same shape ticket 08 settled on for Publications: nothing outside this screen
// reads it, it does not survive a reload, and every mutation ends in a bare
// `update()` so main.js's one subscriber is what redraws.

import { getDatabase } from "../db.js";
import { formatRelative, LOCALES, t, tCount } from "../i18n.js";
import { markPublicationRead } from "../item-state.js";
import { html, nothing, repeat } from "../render.js";
import { showToast, state, update } from "../state.js";
import { getSyncStore } from "../store.js";
import { hrefFor, parseRoute } from "../router.js";
import { syncNow } from "../sync-client.js";
import { buildTodayModel } from "../today-model.js";
import { emptyState, screenHeader } from "./layout.js";

/** @typedef {import('../db.js').ItemRow} ItemRow */
/** @typedef {import('../db.js').PublicationRow} PublicationRow */
/** @typedef {import('../today-model.js').FilterChip} FilterChip */
/** @typedef {import('../today-model.js').TodayCard} TodayCard */
/** @typedef {import('../today-model.js').DaySection} DaySection */

/** Pull distance (CSS px) that arms a refresh. */
const PULL_TRIGGER_PX = 72;

/** Pull distance the indicator stops growing at. */
const PULL_MAX_PX = 112;

/** Fraction of the finger's travel the indicator follows, for a rubber feel. */
const PULL_RESISTANCE = 0.5;

/** Debounce on the reload a Sync's progress triggers. */
const RELOAD_DEBOUNCE_MS = 250;

/**
 * This screen's transient state.
 * @typedef {object} ScreenState
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {PublicationRow[]} publications Enabled, by name.
 * @property {ItemRow[]} items Every stored Item of those Publications.
 * @property {string|null} filterPublicationId The chip that is on, null for All.
 * @property {string|null} menuFor Publication id whose chip menu is open.
 * @property {Set<string>} brokenThumbs Thumbnail URLs that failed to load.
 * @property {number} pull Current pull distance in CSS px, 0 when idle.
 * @property {string} syncMark Signature of the `state.sync` we last reacted to.
 * @property {number} scrollY Where the reader was in the list.
 */

/** @type {ScreenState} */
const screen = {
  status: "idle",
  publications: [],
  items: [],
  filterPublicationId: null,
  menuFor: null,
  brokenThumbs: new Set(),
  pull: 0,
  syncMark: "",
  scrollY: 0,
};

// --- Loading ---------------------------------------------------------------

/**
 * Read the Enabled Publications and their Items. The Publications come from the
 * `SyncStore` (the same "Enabled" rule a Sync uses); the Items are read
 * straight off the Dexie handle, because the store's interface is deliberately
 * the Sync pipeline's and has no read path for a screen. Bounding the list is
 * the model's job, not the query's: one `where('publicationId')` per
 * Publication is a handful of index lookups over at most a few dozen rows each,
 * and keeping the rule in one pure place is worth more than the round trips.
 * @returns {Promise<void>}
 */
async function load() {
  try {
    const publications = await getSyncStore().getEnabledPublications();
    publications.sort((a, b) =>
      String(a.name).localeCompare(
        String(b.name),
        LOCALES[state.lang] || LOCALES.en,
      ),
    );
    const db = getDatabase();
    /** @type {ItemRow[]} */
    const items = [];
    for (const publication of publications) {
      const rows = await db.items
        .where("publicationId")
        .equals(publication.id)
        .toArray();
      items.push(...rows);
    }
    screen.publications = publications;
    screen.items = items;
    if (
      screen.filterPublicationId &&
      !publications.some((p) => p.id === screen.filterPublicationId)
    ) {
      screen.filterPublicationId = null;
    }
    screen.status = "ready";
  } catch (error) {
    console.warn("Today could not be read:", error);
    if (screen.status !== "ready") screen.status = "error";
  }
  update();
}

let started = false;

/** Load once, the first time the screen renders. */
function ensureLoaded() {
  if (started) return;
  started = true;
  screen.status = "loading";
  installListeners();
  void load();
}

/** @type {ReturnType<typeof setTimeout> | null} */
let reloadTimer = null;

/** Reload soon, coalescing the burst of progress events a Sync publishes. */
function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void load();
  }, RELOAD_DEBOUNCE_MS);
}

/**
 * A signature of everything in `state.sync` that means "the database may have
 * changed". Comparing it on each render is how the list updates live as Items
 * arrive without this screen subscribing to the store a second time.
 * @returns {string}
 */
function syncSignature() {
  const sync = state.sync;
  return [
    sync.running ? 1 : 0,
    sync.phase ?? "",
    sync.done,
    sync.total,
    sync.lastSyncAt ?? "",
  ].join("|");
}

/** React to a Sync having moved on: reload the list. */
function watchSync() {
  const mark = syncSignature();
  if (mark === screen.syncMark) return;
  screen.syncMark = mark;
  if (screen.status !== "idle") scheduleReload();
}

// --- Actions ---------------------------------------------------------------

/**
 * Refresh: the button and the pull gesture both land here. While a filter is on
 * only that Publication is Synced — `syncNow` queues distinct scopes and joins
 * identical ones (ticket 07), so this cannot clobber a run already going.
 */
function refresh() {
  if (state.sync.running) return;
  const only = screen.filterPublicationId;
  const options = only ? { publicationIds: [only] } : {};
  syncNow(options)
    .then(() => load())
    .catch((error) => {
      console.warn("Refresh failed:", error);
      showToast(t("sync.error"));
    });
}

/** @param {string|null} publicationId */
function setFilter(publicationId) {
  screen.menuFor = null;
  screen.filterPublicationId = publicationId;
  update();
}

/** @param {string} publicationId */
function toggleMenu(publicationId) {
  screen.menuFor = screen.menuFor === publicationId ? null : publicationId;
  update();
}

/**
 * Mark every Item of one Publication read. The write covers the Publication's
 * whole table, not only the Items inside Today's window: "mark all read" that
 * left older Items Unread would be a lie the next Retention pass exposes.
 * @param {FilterChip} chip
 * @returns {Promise<void>}
 */
async function markAllRead(chip) {
  const publicationId = chip.publicationId;
  screen.menuFor = null;
  if (!publicationId) return;
  try {
    await markPublicationRead(getDatabase(), publicationId);
    // Reflect it in the rows already in memory so the chip count drops now,
    // instead of after the next reload.
    for (const item of screen.items) {
      if (item.publicationId === publicationId) item.read = true;
    }
    showToast(t("today.markedAllRead", { name: chip.name }));
  } catch (error) {
    console.warn("Items could not be marked read:", error);
    showToast(t("today.loadError"));
  }
  update();
}

// --- Pull to refresh, and keeping the reader's place -----------------------

let installed = false;
/** Y of the finger when a pull began, or null when no pull is in progress. */
let pullFrom = null;

/** Whether the gestures and the scroll memory should be active right now. */
function onToday() {
  return state.route.name === "today";
}

/** @param {number} distance */
function setPull(distance) {
  const next = Math.max(0, Math.round(distance));
  if (next === screen.pull) return;
  screen.pull = next;
  update();
}

/**
 * Touch pull-to-refresh, plus the scroll memory that survives a trip to the
 * Reader. Both are window listeners installed once: a view renders a template
 * and cannot own an event handler across redraws, and `main.js` (ticket 01)
 * owns the app frame.
 */
function installListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener(
    "touchstart",
    (event) => {
      pullFrom =
        onToday() && event.touches.length === 1 && window.scrollY <= 0
          ? event.touches[0].clientY
          : null;
    },
    { passive: true },
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      if (pullFrom === null) return;
      if (!onToday() || window.scrollY > 0) {
        pullFrom = null;
        setPull(0);
        return;
      }
      const travel = event.touches[0].clientY - pullFrom;
      if (travel <= 0) {
        setPull(0);
        return;
      }
      // Only now do we own the gesture, so the browser's own overscroll and a
      // sideways swipe are left alone.
      if (event.cancelable) event.preventDefault();
      setPull(Math.min(PULL_MAX_PX, travel * PULL_RESISTANCE));
    },
    { passive: false },
  );

  const release = () => {
    if (pullFrom === null) return;
    pullFrom = null;
    const armed = screen.pull >= PULL_TRIGGER_PX;
    setPull(0);
    if (armed) refresh();
  };
  window.addEventListener("touchend", release, { passive: true });
  window.addEventListener("touchcancel", release, { passive: true });

  window.addEventListener(
    "scroll",
    () => {
      if (onToday()) screen.scrollY = window.scrollY;
    },
    { passive: true },
  );

  window.addEventListener("hashchange", watchRouteForScroll);
}

/** Whether the last hash change took us off Today. */
let leftToday = false;

/**
 * Put the reader back where they were when they come back from the Reader.
 *
 * This has to hang off `hashchange` rather than off the render: while the
 * Reader is open Today is not rendered at all, so a view-side check can never
 * see the route leave. `main.js` scrolls to the top on every path change and
 * lit fills the list in the same tick, so the restore waits two frames and
 * lands after both.
 */
function watchRouteForScroll() {
  const nowOnToday = parseRoute(location.hash).name === "today";
  if (!nowOnToday) {
    leftToday = true;
    return;
  }
  if (!leftToday) return;
  leftToday = false;
  void refreshReadState();
  const y = screen.scrollY;
  if (y <= 0) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (parseRoute(location.hash).name === "today") window.scrollTo(0, y);
    });
  });
}

/**
 * Refresh the fields the reader owns on the rows already in memory, so the
 * Unread chips are right after a trip to the Reader (spec story 21: Unread
 * counts update on read). The rows are mutated in place rather than replaced,
 * so `repeat`'s keys and the list's height do not move and the scroll restore
 * above is not fought.
 * @returns {Promise<void>}
 */
async function refreshReadState() {
  if (screen.items.length === 0) return;
  try {
    const ids = screen.items.map((item) => item.id);
    const rows = await getDatabase().items.bulkGet(ids);
    let changed = false;
    rows.forEach((/** @type {ItemRow | undefined} */ row, i) => {
      const item = screen.items[i];
      if (!row || !item) return;
      if (item.read !== row.read || item.saved !== row.saved) changed = true;
      item.read = row.read;
      item.saved = row.saved;
    });
    if (changed) update();
  } catch (error) {
    console.warn("Read state could not be refreshed:", error);
  }
}

// --- Templates -------------------------------------------------------------

/** The refresh control and the "last refreshed" / progress line. */
function statusBar() {
  const sync = state.sync;
  const line = sync.running
    ? t(sync.phase === "articles" ? "sync.articles" : "sync.feeds", {
        done: sync.done,
        total: sync.total,
      })
    : `${t("sync.lastSynced")} ${
        sync.lastSyncAt ? formatRelative(sync.lastSyncAt) : t("sync.never")
      }`;
  return html`
    <div class="today__bar">
      <span class="today__status" role="status">${line}</span>
      <button
        type="button"
        class="btn btn--icon today__refresh"
        aria-label=${t("today.refresh")}
        title=${t("today.refresh")}
        ?disabled=${sync.running}
        @click=${refresh}
      >
        <span class="ico" aria-hidden="true">↻</span>
      </button>
    </div>
    ${sync.running ? progressBar(sync) : nothing}
  `;
}

/** @param {import('../state.js').SyncState} sync */
function progressBar(sync) {
  const pct = sync.total > 0 ? Math.round((sync.done / sync.total) * 100) : 0;
  return html`
    <div
      class="today__progress"
      role="progressbar"
      aria-label=${t("today.refreshing")}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow=${pct}
    >
      <span class="today__progressfill" style=${`width:${pct}%`}></span>
    </div>
  `;
}

/** The pull-to-refresh affordance; nothing at all until a finger moves. */
function pullIndicator() {
  if (screen.pull === 0) return nothing;
  const armed = screen.pull >= PULL_TRIGGER_PX;
  return html`
    <div
      class="today__pull"
      style=${`height:${screen.pull}px`}
      aria-hidden="true"
    >
      <span class="today__pulltext"
        >${armed ? t("today.release") : t("today.pull")}</span
      >
    </div>
  `;
}

/**
 * One filter chip, with its Unread count and — for a Publication with anything
 * Unread — an overflow button holding "mark all read". A long press on the chip
 * opens the same menu where the platform sends a `contextmenu` event.
 *
 * The wrap, not the chip, carries the pill so the pair reads as one control;
 * that is why the pressed state is set on both (`--on` on each).
 * @param {FilterChip} chip
 */
function filterChip(chip) {
  const all = chip.publicationId === null;
  const what = all
    ? t("today.filterAll")
    : t("today.filterTo", { name: chip.name });
  const open = !all && screen.menuFor === chip.publicationId;
  return html`
    <span class="today__chipwrap ${chip.active ? "today__chipwrap--on" : ""}">
      <button
        type="button"
        class="chip ${chip.active ? "chip--on" : ""}"
        aria-pressed=${chip.active ? "true" : "false"}
        aria-label=${`${what} · ${t("today.unreadCount", { count: chip.unread })}`}
        @click=${() => setFilter(chip.publicationId)}
        @contextmenu=${(event) => {
          if (all) return;
          event.preventDefault();
          toggleMenu(chip.publicationId);
        }}
      >
        <span class="today__chipname">${chip.name}</span>
        ${
          chip.unread > 0
            ? html`<span class="today__chipcount">${chip.unread}</span>`
            : nothing
        }
      </button>
      ${
        all || chip.unread === 0
          ? nothing
          : html`<button
              type="button"
              class="chip today__chipmore"
              aria-label=${t("today.moreAria", { name: chip.name })}
              aria-expanded=${open ? "true" : "false"}
              @click=${() => toggleMenu(chip.publicationId)}
            >
              <span aria-hidden="true">⋯</span>
            </button>`
      }
      ${
        open
          ? html`<span class="today__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                class="btn today__menuitem"
                @click=${() => markAllRead(chip)}
              >
                ${t("today.markAllRead")}
              </button>
            </span>`
          : nothing
      }
    </span>
  `;
}

/** @param {TodayCard} card */
function itemCard(card) {
  const when = formatRelative(card.publishedAt);
  const thumb =
    card.thumbnailUrl && !screen.brokenThumbs.has(card.thumbnailUrl)
      ? card.thumbnailUrl
      : null;
  return html`
    <a
      class="card today__card ${card.read ? "today__card--read" : ""}"
      href=${hrefFor("reader", { id: card.id })}
      aria-label=${t("today.cardAria", {
        title: card.title,
        publication: card.publicationName,
        when,
      })}
    >
      <span class="today__cardmain">
        <span class="today__meta">
          ${
            card.read
              ? nothing
              : html`<span
                  class="today__dot"
                  title=${t("today.unread")}
                  aria-hidden="true"
                ></span>`
          }
          <span class="today__pub">${card.publicationName}</span>
          <span class="today__when">${when}</span>
          ${
            card.summaryOnly
              ? html`<span class="today__flag">${t("today.summaryOnly")}</span>`
              : nothing
          }
        </span>
        <span class="today__title">${card.title}</span>
        ${
          card.summary
            ? html`<span class="today__summary">${card.summary}</span>`
            : nothing
        }
      </span>
      ${
        thumb
          ? html`<img
              class="today__thumb"
              src=${thumb}
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              @error=${onThumbError}
            />`
          : nothing
      }
    </a>
  `;
}

/**
 * A thumbnail that will not load leaves no gap and no broken-image glyph. The
 * element is hidden imperatively (no `?hidden` binding to undo it) and the URL
 * is remembered so a later render skips it — without an `update()`, because the
 * DOM is already correct and a redraw per broken image would be wasteful.
 * @param {Event} event
 */
function onThumbError(event) {
  const img = /** @type {HTMLImageElement} */ (event.currentTarget);
  const url = img.getAttribute("src");
  if (url) screen.brokenThumbs.add(url);
  img.hidden = true;
}

/** @param {DaySection} section */
function daySection(section) {
  return html`
    <section class="today__day">
      <h2 class="today__dayhead">${section.label}</h2>
      <div class="today__cards">
        ${repeat(section.cards, (card) => card.id, itemCard)}
      </div>
    </section>
  `;
}

/** The action every "nothing to show" state offers: refresh now. */
function refreshAction() {
  return html`
    <button
      type="button"
      class="btn btn--primary"
      ?disabled=${state.sync.running}
      @click=${refresh}
    >
      ${state.sync.running ? t("sync.running") : t("sync.now")}
    </button>
  `;
}

/**
 * What to show instead of the list. Three honest cases the ticket names, plus
 * the two the data can still land in: a filter with nothing behind it, and
 * "your Feeds answered but had nothing".
 * @param {import('../today-model.js').TodayModel} model
 */
function emptyBody(model) {
  if (screen.publications.length === 0) {
    return emptyState(
      t("today.placeholder"),
      html`<a class="btn btn--primary" href=${hrefFor("publications")}
        >${t("today.choosePublications")}</a
      >`,
    );
  }
  if (model.filterPublicationId) {
    return emptyState(
      tCount("today.emptyFilter", model.windowDays, {
        name: model.filterName ?? "",
      }),
    );
  }
  if (!state.online) return emptyState(t("today.offlineEmpty"));
  const neverSynced = screen.publications.every((p) => !p.lastSyncedAt);
  return emptyState(
    neverSynced ? t("today.neverSynced") : t("today.empty"),
    refreshAction(),
  );
}

/** @param {import('../state.js').State} appState */
export function todayView(appState) {
  watchSync();
  ensureLoaded();

  const model = buildTodayModel(screen.items, publicationsById(), {
    filterPublicationId: screen.filterPublicationId,
    lang: appState.lang,
  });
  const loading = screen.status === "idle" || screen.status === "loading";

  return html`
    <section class="screen">
      ${screenHeader(appState, t("today.title"))}
      ${pullIndicator()}
      <div class="screen__body today__body">
        ${statusBar()}
        ${
          model.chips.length > 1
            ? html`<div
                class="seg today__filters"
                role="group"
                aria-label=${t("today.filters")}
              >
                ${model.chips.map(filterChip)}
              </div>`
            : nothing
        }
        ${
          loading
            ? html`<p class="today__hint" role="status">${t("today.loading")}</p>`
            : nothing
        }
        ${
          screen.status === "error"
            ? emptyState(
                t("today.loadError"),
                html`<button
                  type="button"
                  class="btn btn--primary"
                  @click=${() => {
                    screen.status = "loading";
                    update();
                    void load();
                  }}
                >
                  ${t("today.retry")}
                </button>`,
              )
            : nothing
        }
        ${
          screen.status === "ready" && model.cardCount === 0
            ? emptyBody(model)
            : nothing
        }
        ${
          model.cardCount > 0
            ? html`<div class="today__list">
                  ${repeat(model.sections, (section) => section.key, daySection)}
                </div>
                <p class="today__bounded">
                  ${tCount("today.bounded", model.windowDays)}
                </p>`
            : nothing
        }
      </div>
    </section>
  `;
}

/**
 * The Enabled Publications as the model wants them: a Map keyed by id, in the
 * order the chips should appear.
 * @returns {Map<string, PublicationRow>}
 */
function publicationsById() {
  return new Map(screen.publications.map((p) => [p.id, p]));
}
