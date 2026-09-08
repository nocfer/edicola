// Today: the Items of every Enabled Publication, newest first, in one of two
// View Modes (spec stories 10-14, 21, plus Feed View Mode).
//
// **List** is the day-grouped timeline under sticky headers Today has always
// had. **Feed** is the same Items as one column of full-bleed post cards, with
// a row of Publication rings where List mode puts its filter chips. One route,
// one model, two templates: `buildTodayModel` decides both shapes and neither
// template decides anything. The toggle writes `update({ viewMode })` and
// `main.js` persists it.
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

import { revokeObjectUrls } from "../article-render.js";
import { resolveCoverSources } from "../cover.js";
import { getDatabase, imageKeyFor } from "../db.js";
import { formatRelative, LOCALES, t, tCount } from "../i18n.js";
import { shareItem, toggleItemSaved } from "../item-actions.js";
import { markPublicationRead } from "../item-state.js";
import { html, nothing, repeat } from "../render.js";
import { showToast, state, update } from "../state.js";
import { getSyncStore } from "../store.js";
import { hrefFor, navigate, parseRoute } from "../router.js";
import { syncNow } from "../sync-client.js";
import { buildTodayModel } from "../today-model.js";
import {
  bookmarkIcon,
  emptyState,
  externalIcon,
  feedIcon,
  listIcon,
  screenHeader,
  shareIcon,
} from "./layout.js";

/** @typedef {import('../db.js').ItemRow} ItemRow */
/** @typedef {import('../db.js').PublicationRow} PublicationRow */
/** @typedef {import('../today-model.js').FilterChip} FilterChip */
/** @typedef {import('../today-model.js').TodayCard} TodayCard */
/** @typedef {import('../today-model.js').DaySection} DaySection */
/** @typedef {import('../today-model.js').Ring} Ring */
/** @typedef {import('../cover.js').CoverSource} CoverSource */

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
 * @property {Map<string, CoverSource>} coverSources What fills each Item's
 *   picture slot in Feed mode, resolved against the `images` table.
 * @property {string[]} objectUrls Object URLs `coverSources` created; revoked
 *   on the next load and on `pagehide` (never on leaving Today — the rows stay
 *   in memory and render again on the way back).
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
  coverSources: new Map(),
  objectUrls: [],
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
    await refreshCoverSources(items);
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

/**
 * Work out what fills each Item's picture slot: the stored blob if we hold the
 * bytes, else the publisher's URL, else a generated Cover (`src/cover.js` owns
 * that order). Resolved once per load rather than per card so the whole feed
 * costs one `bulkGet`, and the previous load's object URLs are released first —
 * a screen that reloaded on every Sync tick and kept them would hold every
 * picture it had ever shown.
 *
 * It never throws into `load`: a database that cannot be read leaves every
 * card on its publisher URL or its Cover, and the feed still renders.
 *
 * @param {ItemRow[]} items
 * @returns {Promise<void>}
 */
async function refreshCoverSources(items) {
  const previous = screen.objectUrls;
  const resolved = await resolveCoverSources(items, {
    db: getDatabase(),
    imageKeyFor,
    createObjectURL: (blob) => URL.createObjectURL(blob),
  });
  screen.coverSources = resolved.sources;
  screen.objectUrls = resolved.objectUrls;
  revokeObjectUrls(previous, {
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  });
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

/**
 * Switch View Mode. The write goes through the store like every other write;
 * `main.js` persists it to `edicola.viewmode` as a side effect of the redraw,
 * so this screen does not touch storage.
 * @param {import('../state.js').ViewMode} viewMode
 */
function setViewMode(viewMode) {
  if (state.viewMode === viewMode) return;
  screen.menuFor = null;
  update({ viewMode });
}

/**
 * Tap a Publication's ring. A ring with a reel opens that Publication's Story
 * (ticket 03); the no-reel state has no reel to open, so it filters the feed
 * instead — and tapping the ring that is already the filter clears it, because
 * Feed mode has no "All" chip to go back to.
 * @param {Ring} ring
 */
function tapRing(ring) {
  if (ring.state === "none") {
    setFilter(ring.active ? null : ring.publicationId);
    return;
  }
  screen.menuFor = null;
  navigate("story", { id: ring.publicationId });
}

/**
 * Filter the feed to one Publication and go to Today. Exported for the Story
 * player's end panel ("Show only BBC News", board 08), which is the one place
 * outside this screen that needs to set its filter — reaching in through a
 * named function keeps `screen` private and keeps the write going through
 * `update()` like every other.
 * @param {string} publicationId
 */
export function showOnlyPublication(publicationId) {
  screen.menuFor = null;
  screen.filterPublicationId = publicationId;
  navigate("today");
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
 * @param {{ publicationId: string | null, name: string }} chip A filter chip or
 *   a Feed mode ring; both carry the two fields this reads.
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

  // A reload or a closed tab is the one exit `load()` never runs after, so it
  // is the one place the feed's object URLs would otherwise outlive it. Leaving
  // Today deliberately does NOT revoke: the rows stay in memory and the feed
  // renders them again on the way back, so a revoke here would hand the reader
  // a column of dead `blob:` URLs.
  window.addEventListener("pagehide", () => {
    revokeObjectUrls(screen.objectUrls, {
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    });
    screen.objectUrls = [];
  });
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
 * counts update on read) and a ring is dimmed after a trip through its Story.
 * `seen` is copied for that second reason: a full pass through a reel that
 * un-dimmed its ring the moment the reader came back would make the Story look
 * like it had not happened. The rows are mutated in place rather than replaced,
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
      if (
        item.read !== row.read ||
        item.saved !== row.saved ||
        item.seen !== row.seen
      ) {
        changed = true;
      }
      item.read = row.read;
      item.saved = row.saved;
      item.seen = row.seen;
    });
    if (changed) update();
  } catch (error) {
    console.warn("Read state could not be refreshed:", error);
  }
}

// --- Templates -------------------------------------------------------------

/**
 * The View Mode toggle and the refresh control, both in the screen header
 * beside the title (boards 01 and 11). The toggle is the `seg` primitive with
 * `aria-pressed` on each half, so the pair reads as one two-state control.
 */
function headerControls() {
  const sync = state.sync;
  return html`
    <span class="seg today__modes" role="group" aria-label=${t("today.viewMode")}>
      ${viewModeButton("list", listIcon, "today.viewList", "today.viewListAria")}
      ${viewModeButton("feed", feedIcon, "today.viewFeed", "today.viewFeedAria")}
    </span>
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
  `;
}

/**
 * @param {import('../state.js').ViewMode} mode
 * @param {unknown} icon
 * @param {string} labelKey
 * @param {string} ariaKey
 */
function viewModeButton(mode, icon, labelKey, ariaKey) {
  const on = state.viewMode === mode;
  return html`<button
    type="button"
    class="chip today__mode ${on ? "chip--on" : ""}"
    aria-pressed=${on ? "true" : "false"}
    aria-label=${t(ariaKey)}
    title=${t(labelKey)}
    @click=${() => setViewMode(mode)}
  >
    ${icon}
  </button>`;
}

/** The "last refreshed" / progress line, and the bar a Sync fills. */
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
 * A picture that will not load leaves no gap and no broken-image glyph. The
 * element is hidden imperatively so the current DOM is right immediately, the
 * URL is remembered so no later render offers it again, and a redraw follows
 * because Feed mode must put the generated Cover in the slot the photo just
 * failed to fill — a 4:5 hole is exactly the "looks broken" the Cover treatment
 * exists to avoid. List mode reaches the same answer it always did, one redraw
 * later.
 * @param {Event} event
 */
function onThumbError(event) {
  const img = /** @type {HTMLImageElement} */ (event.currentTarget);
  const url = img.getAttribute("src");
  if (url) screen.brokenThumbs.add(url);
  img.hidden = true;
  if (url) update();
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

// --- Feed mode -------------------------------------------------------------
//
// The rings row and the post cards. Nothing here decides anything: the ring
// states, the flat card order and what fills each picture slot all arrive on
// the model (`today-model.js`, `cover.js`).

/**
 * One Publication's ring. Three states, told apart by ring weight before
 * colour (board 09): a 2px accent ring when there are Unread Items nobody has
 * looked through, a 1px hairline ring once every Frame has been Seen, and no
 * ring at all when there is no reel. Only the last one is permanent in this
 * ticket — a tap filters the feed until ticket 03 gives the reel a Story.
 *
 * The `⋯` opens the menu a long press opens, so the gesture is never the only
 * way in, and its hit area is a full 44px around the 24px glyph.
 * @param {Ring} ring
 */
function publicationRing(ring) {
  const open = screen.menuFor === ring.publicationId;
  const stateLabel = t(
    ring.state === "unseen"
      ? "today.ringUnseen"
      : ring.state === "seen"
        ? "today.ringSeen"
        : "today.ringNone",
    { name: ring.name },
  );
  const label =
    ring.unread > 0
      ? `${stateLabel} · ${t("today.unreadCount", { count: ring.unread })}`
      : stateLabel;
  return html`
    <span class="feed__ring feed__ring--${ring.state}">
      <button
        type="button"
        class="feed__ringbtn"
        aria-label=${label}
        aria-pressed=${ring.active ? "true" : "false"}
        @click=${() => tapRing(ring)}
        @contextmenu=${(/** @type {Event} */ event) => {
          event.preventDefault();
          toggleMenu(ring.publicationId);
        }}
      >
        <span class="feed__ringtile ramp ramp--${ring.coverIndex}"
          >${ring.monogram}</span
        >
      </button>
      <button
        type="button"
        class="feed__ringmore"
        aria-label=${t("today.moreAria", { name: ring.name })}
        aria-expanded=${open ? "true" : "false"}
        @click=${() => toggleMenu(ring.publicationId)}
      >
        <span class="feed__ringmoredot" aria-hidden="true">⋯</span>
      </button>
      <span class="feed__ringname">${ring.name}</span>
    </span>
  `;
}

/**
 * The menu behind a long press or the `⋯`: the two actions List mode's chip
 * menu already offers, plus a way back out of a filter — Feed mode replaced the
 * chip row, so there is no "All" chip to clear it with.
 *
 * It renders *below* the rings row rather than floating over the ring, because
 * the row is a horizontal scroller and an `overflow-x: auto` box clips its
 * children on both axes. Reusing `.today__menu` keeps the look; `--static`
 * drops the absolute positioning it does not want here.
 * @param {Ring} ring
 */
function ringMenu(ring) {
  return html`
    <span class="today__menu today__menu--static feed__ringmenu" role="menu">
      <button
        type="button"
        role="menuitem"
        class="btn today__menuitem"
        @click=${() => setFilter(ring.active ? null : ring.publicationId)}
      >
        ${ring.active ? t("today.showAll") : t("today.filterTo", { name: ring.name })}
      </button>
      ${
        ring.unread === 0
          ? nothing
          : html`<button
              type="button"
              role="menuitem"
              class="btn today__menuitem"
              @click=${() => markAllRead(ring)}
            >
              ${t("today.markAllRead")}
            </button>`
      }
    </span>
  `;
}

/**
 * The rings row: one horizontal scroller where List mode puts its chips, plus
 * the open ring's menu underneath it. With no Enabled Publications there is
 * nothing to make a ring from, so the row is absent rather than empty
 * (board 04).
 * @param {import('../today-model.js').TodayModel} model
 */
function ringsRow(model) {
  if (model.rings.length === 0) return nothing;
  const open = model.rings.find(
    (ring) => ring.publicationId === screen.menuFor,
  );
  return html`
    <div class="feed__rings" role="group" aria-label=${t("today.rings")}>
      ${repeat(model.rings, (ring) => ring.publicationId, publicationRing)}
    </div>
    ${open ? ringMenu(open) : nothing}
  `;
}

/**
 * Whether this card shows a real picture. A Cover is the answer both when
 * nothing was resolved and when the photo we were offered has already failed
 * to load, which is what keeps an offline feed deliberate rather than holed.
 * @param {TodayCard} card
 */
function cardPhoto(card) {
  const { kind, url } = card.cover;
  if (kind === "cover" || !url) return null;
  return screen.brokenThumbs.has(url) ? null : url;
}

/**
 * One post card. Header row, the picture at 4:5, the action bar, then the text.
 *
 * The two picture variants are one system read two ways: a **Cover** carries
 * the headline itself and the text below is the Summary alone, while a
 * **photo** leaves the headline to the text block. The headline appears once
 * either way — printing it twice is the detail that would make the two
 * variants read as two designs.
 * @param {TodayCard} card
 */
function feedCard(card) {
  const when = formatRelative(card.publishedAt);
  const photo = cardPhoto(card);
  const aria = t("today.cardAria", {
    title: card.title,
    publication: card.publicationName,
    when,
  });
  return html`
    <article class="card card--flush feed__card">
      <div class="feed__head">
        <span class="feed__avatar ramp ramp--${card.coverIndex}"
          >${card.monogram}</span
        >
        <span class="feed__pub">${card.publicationName}</span>
        <span class="feed__when">${when}</span>
        <span class="feed__gap"></span>
        ${
          card.read
            ? nothing
            : html`<span
                class="feed__dot"
                title=${t("today.unread")}
                aria-hidden="true"
              ></span>`
        }
      </div>
      <a
        class="feed__media ${photo ? "" : `ramp ramp--${card.coverIndex}`}"
        href=${hrefFor("reader", { id: card.id })}
        aria-label=${aria}
      >
        ${
          photo
            ? html`<img
                class="feed__photo"
                src=${photo}
                alt=""
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                @error=${onThumbError}
              />`
            : html`<span class="feed__watermark" aria-hidden="true"
                  >${card.monogram}</span
                >
                <h3 class="feed__coverhead">${card.title}</h3>`
        }
        ${
          card.summaryOnly
            ? html`<span class="feed__badge">${t("today.summaryOnly")}</span>`
            : nothing
        }
      </a>
      ${actionBar(card)}
      ${
        photo || card.summary
          ? html`<a
              class="feed__text"
              href=${hrefFor("reader", { id: card.id })}
              tabindex="-1"
            >
              ${photo ? html`<h3 class="feed__title">${card.title}</h3>` : nothing}
              ${
                card.summary
                  ? html`<p class="feed__summary">${card.summary}</p>`
                  : nothing
              }
            </a>`
          : nothing
      }
    </article>
  `;
}

/**
 * Save, Share, Original — the Reader's own three actions, through the shared
 * handlers in `item-actions.js` so there is one Web Share call with one
 * clipboard fallback. Nothing here counts anything: there is no server to send
 * a like to and nobody to show it to.
 * @param {TodayCard} card
 */
function actionBar(card) {
  const item = screen.items.find((row) => row.id === card.id);
  if (!item) return nothing;
  const isSaved = Boolean(item.saved);
  return html`
    <div class="feed__actions">
      <button
        type="button"
        class="btn btn--tap feed__action ${isSaved ? "feed__action--on" : ""}"
        aria-pressed=${isSaved ? "true" : "false"}
        aria-label=${t(isSaved ? "today.unsaveAria" : "today.saveAria", {
          title: card.title,
        })}
        title=${t(isSaved ? "today.savedAction" : "today.save")}
        @click=${(/** @type {Event} */ event) =>
          toggleItemSaved(item, event.currentTarget)}
      >
        ${bookmarkIcon(isSaved)}
      </button>
      ${
        item.link
          ? html`<button
                type="button"
                class="btn btn--tap feed__action"
                aria-label=${t("today.shareAria", { title: card.title })}
                title=${t("today.share")}
                @click=${() => shareItem(item)}
              >
                ${shareIcon}
              </button>
              <a
                class="btn btn--tap feed__action"
                href=${item.link}
                target="_blank"
                rel="noopener"
                aria-label=${t("today.originalAria", {
                  title: card.title,
                  publication: card.publicationName,
                })}
                title=${t("today.original")}
              >
                ${externalIcon}
              </a>`
          : nothing
      }
    </div>
  `;
}

/**
 * The end of the feed. The Retention bound is the honest reason the column
 * stops, and it is the same `windowDays` List mode prints in its footer line.
 * @param {import('../today-model.js').TodayModel} model
 */
function endCard(model) {
  return html`
    <div class="feed__end">
      <span class="feed__endtitle">${t("today.caughtUp")}</span>
      <span class="feed__endnote"
        >${tCount("today.caughtUpDays", model.windowDays)}</span
      >
    </div>
  `;
}

/** @param {import('../today-model.js').TodayModel} model */
function feedList(model) {
  return html`
    <div class="feed__list">
      ${repeat(model.cards, (card) => card.id, feedCard)}
    </div>
    ${endCard(model)}
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

/**
 * Today, in whichever View Mode is on. The two modes share the header, the
 * status line, the pull gesture, every empty state and the error state; they
 * differ in one row (chips or rings) and one body (day sections or post
 * cards). Anything that reads "Feed mode quietly has fewer states than List
 * mode" belongs on this list, not in a second screen.
 * @param {import('../state.js').State} appState
 */
export function todayView(appState) {
  watchSync();
  ensureLoaded();

  const feed = appState.viewMode === "feed";
  const model = buildTodayModel(screen.items, publicationsById(), {
    filterPublicationId: screen.filterPublicationId,
    lang: appState.lang,
    coverSources: feed ? screen.coverSources : null,
  });
  const loading = screen.status === "idle" || screen.status === "loading";

  return html`
    <section class="screen">
      ${screenHeader(appState, t("today.title"), nothing, headerControls())}
      ${pullIndicator()}
      <div class="screen__body today__body">
        ${statusBar()}
        ${
          feed
            ? ringsRow(model)
            : model.chips.length > 1
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
          feed && !appState.online && model.cardCount > 0
            ? html`<p class="today__hint">${t("today.coversStandIn")}</p>`
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
          model.cardCount === 0
            ? nothing
            : feed
              ? feedList(model)
              : html`<div class="today__list">
                    ${repeat(model.sections, (section) => section.key, daySection)}
                  </div>
                  <p class="today__bounded">
                    ${tCount("today.bounded", model.windowDays)}
                  </p>`
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
