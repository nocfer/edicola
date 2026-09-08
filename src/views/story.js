// The Story player: one Publication's reel of Unread Items, one Frame at a
// time, full screen with the tab bar hidden (ticket 03).
//
// **It is a route, `#/story/:publicationId`, not an overlay on Today.** The
// deciding factor is the back button: the player has to close on the browser's
// own back gesture and land the reader back at the same place in the feed, and
// a route gets that from history for free while an overlay would have to push a
// synthetic entry and then guess what a `popstate` meant. The Reader is the
// precedent — a full-screen push that hides the tab bar through `hidesTabBar`
// in router.js — and this follows it exactly, which is also why Today's scroll
// restore already works on the way back: it hangs off `hashchange`.
//
// **Nothing here is timed.** The pips are a position indicator, never a
// countdown; nothing advances by itself. Every gesture has a visible twin: the
// tap thirds have the chevron buttons, the swipe up has the Read button, the
// swipe down has the close ×, and arrow keys and Escape do the same work for a
// keyboard.
//
// **A Frame marks the Item Seen, never Read.** `markItemSeen` writes that one
// field (item-state.js); only the Reader marks Read. So a full pass through a
// reel dims its ring and leaves the Publication's Unread count exactly where it
// was, which is the guarantee the whole rings design rests on.
//
// **The player is dark in both themes, by decision.** Its scrim is
// `--scrim-ink`, defined once on bare `:root` and deliberately not redefined
// for light, because `--accent-ink` text over a light scrim scores 1.6:1
// against 14.6-15.6 over the dark one. The design has no light-theme Story
// artboard and this is the answer to that gap, not an omission to fill in. See
// .scratch/feed-view-mode/spec.md, "the finding that matters".

import { revokeObjectUrls } from "../article-render.js";
import { resolveCoverSources } from "../cover.js";
import { getDatabase, imageKeyFor } from "../db.js";
import { formatRelative, t, tCount } from "../i18n.js";
import { markItemSeen } from "../item-state.js";
import { html, nothing, repeat } from "../render.js";
import { state, update } from "../state.js";
import { goBack, hrefFor, navigate } from "../router.js";
import { buildStoryReel } from "../today-model.js";
import { emptyState, screenHeader } from "./layout.js";
import { showOnlyPublication } from "./today.js";

/** @typedef {import('../db.js').ItemRow} ItemRow */
/** @typedef {import('../db.js').PublicationRow} PublicationRow */
/** @typedef {import('../today-model.js').StoryReel} StoryReel */
/** @typedef {import('../today-model.js').TodayCard} TodayCard */

/** Vertical travel (CSS px) that counts as a swipe rather than a stray touch. */
const SWIPE_PX = 60;

/**
 * This screen's transient state, the same module-level shape Today and
 * Publications use.
 * @typedef {object} ScreenState
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {string} publicationId Whose reel is loaded, "" when none is.
 * @property {PublicationRow|null} publication
 * @property {ItemRow[]} items That Publication's stored Items.
 * @property {Map<string, import('../cover.js').CoverSource>} coverSources
 * @property {string[]} objectUrls Object URLs to revoke when the reel changes.
 * @property {number} index Which Frame is showing, 0-based.
 * @property {boolean} done The reel is finished and the end panel is up.
 * @property {Set<string>} marked Items already marked Seen this visit.
 * @property {Set<string>} brokenPhotos Picture URLs that failed to load.
 */

/** @type {ScreenState} */
const screen = {
  status: "idle",
  publicationId: "",
  publication: null,
  items: [],
  coverSources: new Map(),
  objectUrls: [],
  index: 0,
  done: false,
  marked: new Set(),
  brokenPhotos: new Set(),
};

// --- Loading ---------------------------------------------------------------

/**
 * Read one Publication and its Items, then resolve what fills each Frame's
 * picture. The player must not decide where a picture comes from — that order
 * (stored blob, publisher URL, generated Cover) belongs to `cover.js`.
 * @param {string} publicationId
 * @returns {Promise<void>}
 */
async function load(publicationId) {
  try {
    const db = getDatabase();
    const publication = await db.publications.get(publicationId);
    const items = await db.items
      .where("publicationId")
      .equals(publicationId)
      .toArray();
    const previous = screen.objectUrls;
    const resolved = await resolveCoverSources(items, {
      db,
      imageKeyFor,
      createObjectURL: (blob) => URL.createObjectURL(blob),
    });
    revoke(previous);
    screen.publication = publication ?? null;
    screen.items = items;
    screen.coverSources = resolved.sources;
    screen.objectUrls = resolved.objectUrls;
    screen.status = "ready";
  } catch (error) {
    console.warn("The Story could not be read:", error);
    screen.status = "error";
  }
  update();
}

/**
 * Release object URLs this player is done with, through the same helper the
 * Reader uses for an Article's images.
 * @param {string[]} urls
 */
function revoke(urls) {
  revokeObjectUrls(urls, {
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  });
}

/**
 * Open (or re-open) the reel the route names. A different Publication resets
 * the position and the Seen bookkeeping; the same one, re-entered, starts at
 * the top again, because a reader who came back to a ring asked for the reel,
 * not for where they stopped.
 * @param {string} publicationId
 */
function ensureLoaded(publicationId) {
  installListeners();
  if (screen.publicationId === publicationId && screen.status !== "idle") {
    return;
  }
  screen.publicationId = publicationId;
  screen.status = "loading";
  screen.index = 0;
  screen.done = false;
  screen.marked = new Set();
  screen.brokenPhotos = new Set();
  void load(publicationId);
}

// --- Advancing, and marking Seen ------------------------------------------

/** Whether the gestures and the key bindings should be active right now. */
function onStory() {
  return state.route.name === "story";
}

/**
 * Show the Frame at `index`, or the end panel when the reel runs out. Advance
 * is always something the reader did: there is no timer anywhere in this file.
 * @param {number} index
 * @param {number} total
 */
function goTo(index, total) {
  if (index < 0) return;
  if (index >= total) {
    // Past the last Frame the reel ends on a panel, not on a dead tap.
    screen.done = true;
    update();
    return;
  }
  screen.index = index;
  screen.done = false;
  update();
}

/**
 * Record that a Frame was shown. Called from the template, once per Item per
 * visit: the write is idempotent and cheap, but a redraw per render would be
 * neither, so `marked` remembers what has already gone to the database.
 *
 * `markItemSeen` writes `seen` and nothing else. Read stays the Reader's.
 * @param {TodayCard} frame
 */
function markSeen(frame) {
  if (screen.marked.has(frame.id)) return;
  screen.marked.add(frame.id);
  const row = screen.items.find((item) => item.id === frame.id);
  if (row) row.seen = true;
  markItemSeen(getDatabase(), frame.id).catch((error) => {
    console.warn("Seen could not be written:", error);
  });
}

let installed = false;
/** Y of the finger when a swipe began, or null when none is in progress. */
let swipeFrom = null;

/**
 * Keyboard parity and the two swipes, installed once on `window`: a view
 * renders a template and cannot own a listener across redraws. Every one of
 * these has a visible twin on screen, which is the point — a hidden gesture is
 * the opposite of approachable.
 */
function installListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Leaving the player releases its pictures, and marks the reel stale so
  // re-entry reloads rather than rendering against `blob:` URLs that have just
  // been revoked. `pagehide` covers a reload or a closed tab.
  window.addEventListener("hashchange", () => {
    if (onStory()) return;
    revoke(screen.objectUrls);
    screen.objectUrls = [];
    screen.status = "idle";
  });
  window.addEventListener("pagehide", () => {
    revoke(screen.objectUrls);
    screen.objectUrls = [];
  });

  window.addEventListener("keydown", (event) => {
    if (!onStory()) return;
    const total = currentReel().frames.length;
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight") goTo(screen.index + 1, total);
    else if (event.key === "ArrowLeft") goTo(screen.index - 1, total);
    else return;
    event.preventDefault();
  });

  window.addEventListener(
    "touchstart",
    (event) => {
      swipeFrom =
        onStory() && event.touches.length === 1
          ? event.touches[0].clientY
          : null;
    },
    { passive: true },
  );

  window.addEventListener(
    "touchend",
    (event) => {
      if (swipeFrom === null || !onStory()) {
        swipeFrom = null;
        return;
      }
      const travel =
        (event.changedTouches[0]?.clientY ?? swipeFrom) - swipeFrom;
      swipeFrom = null;
      if (travel > SWIPE_PX) close();
      else if (travel < -SWIPE_PX) openReader();
    },
    { passive: true },
  );
}

/** Leave the player: back to the feed, at the scroll position it kept. */
function close() {
  goBack();
}

/** The visible Read button and the swipe up both land here. */
function openReader() {
  const frame = currentReel().frames[screen.index];
  if (frame) navigate("reader", { id: frame.id });
}

// --- The model -------------------------------------------------------------

/**
 * This reel, from the pure builder. Recomputed per render rather than cached:
 * it is a filter over a few dozen rows already in memory, and a cache here
 * would be a second place for "which Items are Unread" to be wrong.
 * @returns {StoryReel}
 */
function currentReel() {
  return buildStoryReel(
    screen.items,
    screen.publication
      ? new Map([[screen.publicationId, screen.publication]])
      : new Map(),
    {
      publicationId: screen.publicationId,
      lang: state.lang,
      coverSources: screen.coverSources,
    },
  );
}

// --- Templates -------------------------------------------------------------

const closeIcon = html`<svg
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
  <path d="M18 6 6 18" />
  <path d="m6 6 12 12" />
</svg>`;

/** @param {'left'|'right'|'up'} direction */
function chevron(direction) {
  const path =
    direction === "left"
      ? "m15 18-6-6 6-6"
      : direction === "right"
        ? "m9 18 6-6-6-6"
        : "m18 15-6-6-6 6";
  return html`<svg
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
    <path d=${path} />
  </svg>`;
}

/**
 * Position pips: one segment per Frame, filled up to the current one. They are
 * a position indicator and never animate, because nothing in this player
 * advances by itself. A pip row is not readable on its own at six segments, so
 * the "Frame 3 of 6" line beside it carries the same fact in words.
 * @param {number} index
 * @param {number} total
 */
function pips(index, total) {
  const segments = Array.from({ length: total }, (_, i) => i);
  return html`
    <div class="story__pips" aria-hidden="true">
      ${repeat(
        segments,
        (i) => i,
        (i) =>
          html`<span
            class="story__pip ${i <= index ? "story__pip--on" : ""}"
          ></span>`,
      )}
    </div>
  `;
}

/**
 * The Frame's picture: the photo when we have one, otherwise the Publication's
 * generated Cover. The `.14`-opacity monogram watermark belongs to the Cover
 * only — board 06 leaves a photo alone, and a watermark over a photograph is
 * noise rather than identity.
 * @param {TodayCard} frame
 */
function frameBackdrop(frame) {
  const photo = framePhoto(frame);
  if (photo) {
    return html`<img
      class="story__photo"
      src=${photo}
      alt=""
      decoding="async"
      referrerpolicy="no-referrer"
      @error=${onPhotoError}
    />`;
  }
  return html`<span class="story__watermark" aria-hidden="true"
    >${frame.monogram}</span
  >`;
}

/**
 * The picture this Frame can actually show, or null for the Cover. A URL that
 * has already failed counts as no picture: a full-screen Frame is the worst
 * place to leave the hole Covers exist to fill, which is why the Feed's cards
 * do the same.
 * @param {TodayCard} frame
 * @returns {string | null}
 */
function framePhoto(frame) {
  const { kind, url } = frame.cover;
  if (kind === "cover" || !url) return null;
  return screen.brokenPhotos.has(url) ? null : url;
}

/**
 * A Frame picture that will not load: hide it now, remember the URL so no
 * later render offers it again, and redraw so the Cover takes the slot.
 * @param {Event} event
 */
function onPhotoError(event) {
  const img = /** @type {HTMLImageElement} */ (event.currentTarget);
  const url = img.getAttribute("src");
  img.hidden = true;
  if (!url) return;
  screen.brokenPhotos.add(url);
  update();
}

/**
 * One Frame. The picture is full-bleed behind the scrim gradient; the headline
 * and the Summary sit over the scrim in `--accent-ink`, which does not vary
 * between themes — see the note at the top of this file.
 * @param {TodayCard} frame
 */
function frameBody(frame) {
  const cover = framePhoto(frame) === null;
  return html`
    <div
      class="story__frame ${
        cover ? `story__frame--cover ramp ramp--${frame.coverIndex}` : ""
      }"
    >
      ${frameBackdrop(frame)}
      <div class="story__scrim" aria-hidden="true"></div>
      ${
        frame.summaryOnly
          ? html`<span class="story__badge">${t("today.summaryOnly")}</span>`
          : nothing
      }
      <div class="story__copy">
        <h2 class="story__title">${frame.title}</h2>
        ${
          frame.summary
            ? html`<p class="story__summary">${frame.summary}</p>`
            : nothing
        }
      </div>
    </div>
  `;
}

/**
 * The tap thirds, and the chevrons that are their visible twin. The zones are
 * out of the accessibility tree on purpose: they duplicate the buttons beside
 * them, and a screen reader offering both would be reading one control twice.
 * @param {number} total
 */
function advanceControls(total) {
  return html`
    <button
      type="button"
      class="story__zone story__zone--back"
      aria-hidden="true"
      tabindex="-1"
      @click=${() => goTo(screen.index - 1, total)}
    ></button>
    <button
      type="button"
      class="story__zone story__zone--next"
      aria-hidden="true"
      tabindex="-1"
      @click=${() => goTo(screen.index + 1, total)}
    ></button>
    <button
      type="button"
      class="btn btn--tap story__nav story__nav--back"
      aria-label=${t("story.previous")}
      title=${t("story.previous")}
      ?disabled=${screen.index === 0}
      @click=${() => goTo(screen.index - 1, total)}
    >
      ${chevron("left")}
    </button>
    <button
      type="button"
      class="btn btn--tap story__nav story__nav--next"
      aria-label=${t("story.next")}
      title=${t("story.next")}
      @click=${() => goTo(screen.index + 1, total)}
    >
      ${chevron("right")}
    </button>
  `;
}

/**
 * The Read button, always visible. The swipe-up chevron above it is the
 * familiar hint, never the only way in. A Summary-only Item says what the tap
 * will actually do, because sixteen of the thirty Catalog Publications are
 * truncated and "Read" would be a promise the Reader cannot keep.
 * @param {TodayCard} frame
 */
function readBar(frame) {
  return html`
    <div class="story__foot">
      <span class="story__hint" aria-hidden="true">${chevron("up")}</span>
      <a
        class="btn btn--primary story__read"
        href=${hrefFor("reader", { id: frame.id })}
        >${t(frame.summaryOnly ? "story.readSummary" : "story.read")}</a
      >
    </div>
  `;
}

/**
 * The end of the reel (board 08): it says the reel is finished, says plainly
 * that nothing was marked Read, and offers two ways on. It never loops into
 * another Publication's reel and it never closes on its own.
 * @param {StoryReel} reel
 */
function endPanel(reel) {
  return html`
    <div class="story__endwrap" role="dialog" aria-label=${t("story.endTitle")}>
      <div class="story__flat" aria-hidden="true"></div>
      <div class="story__end">
        <span class="story__endtitle">${t("story.endTitle")}</span>
        <p class="story__endbody">
          ${tCount("story.endBody", reel.frames.length, {
            name: reel.name,
          })}
        </p>
        <div class="story__endactions">
          <button
            type="button"
            class="btn btn--primary"
            @click=${close}
          >
            ${t("story.backToToday")}
          </button>
          <button
            type="button"
            class="btn story__ghost"
            @click=${() => showOnlyPublication(reel.publicationId)}
          >
            ${t("today.filterTo", { name: reel.name })}
          </button>
        </div>
      </div>
    </div>
  `;
}

/** The pips, the Publication's identity, the position in words, and the ×. */
function playerHeader(reel, index, total) {
  const frame = reel.frames[index];
  return html`
    <div class="story__head">
      ${pips(index, total)}
      <div class="story__ident">
        <span class="story__avatar ramp ramp--${reel.coverIndex}"
          >${reel.monogram}</span
        >
        <span class="story__pub">${reel.name}</span>
        ${
          frame
            ? html`<span class="story__when"
                >${formatRelative(frame.publishedAt)}</span
              >`
            : nothing
        }
        <span class="story__count"
          >${t("story.position", { index: index + 1, total })}</span
        >
        <button
          type="button"
          class="btn btn--tap story__close"
          aria-label=${t("story.close")}
          title=${t("story.close")}
          @click=${close}
        >
          ${closeIcon}
        </button>
      </div>
    </div>
  `;
}

/**
 * A reel with no Frames. Reachable by coming back to a `#/story/…` URL after
 * reading everything, so it is a real state and not a can't-happen: it says so
 * and offers the way back, rather than showing a black screen.
 * @param {StoryReel} reel
 */
function noReel(reel) {
  return html`
    <section class="screen story story--empty">
      ${screenHeader(
        state,
        reel.name,
        html`<button
          type="button"
          class="btn btn--icon"
          aria-label=${t("story.close")}
          title=${t("story.close")}
          @click=${close}
        >
          ${closeIcon}
        </button>`,
      )}
      ${emptyState(
        t("story.empty", { name: reel.name }),
        html`<button type="button" class="btn btn--primary" @click=${close}>
          ${t("story.backToToday")}
        </button>`,
      )}
    </section>
  `;
}

/** @param {import('../state.js').State} appState */
export function storyView(appState) {
  const publicationId = appState.route.params.id ?? "";
  ensureLoaded(publicationId);

  if (screen.status === "loading" || screen.status === "idle") {
    return html`<section class="screen story story--empty">
      <p class="story__loading" role="status">${t("app.loading")}</p>
    </section>`;
  }
  if (screen.status === "error") {
    return html`<section class="screen story story--empty">
      ${emptyState(
        t("story.loadError"),
        html`<button type="button" class="btn btn--primary" @click=${close}>
          ${t("story.backToToday")}
        </button>`,
      )}
    </section>`;
  }

  const reel = currentReel();
  const total = reel.frames.length;
  if (total === 0) return noReel(reel);

  const index = Math.min(screen.index, total - 1);
  const frame = reel.frames[index];
  // Showing a Frame is what marks it Seen. Never Read.
  markSeen(frame);

  return html`
    <section class="story">
      ${playerHeader(reel, index, total)}
      ${frameBody(frame)}
      ${screen.done ? endPanel(reel) : advanceControls(total)}
      ${screen.done ? nothing : readBar(frame)}
    </section>
  `;
}
