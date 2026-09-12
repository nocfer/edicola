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
// was, which is the guarantee the whole rings design rests on. Seen is also
// what places the reader: the player opens on the reel's `startIndex`, the
// first Frame not yet Seen.
//
// **The player is dark in both themes, by decision.** Its scrim is
// `--scrim-ink`, defined once on bare `:root` and deliberately not redefined
// for light, because `--accent-ink` text over a light scrim scores 1.6:1
// against 14.6-15.6 over the dark one. The design has no light-theme Story
// artboard and this is the answer to that gap, not an omission to fill in. See
// .scratch/feed-view-mode/spec.md, "the finding that matters".
//
// **The player grows out of the ring that opened it, and the ring is a route
// away.** By the time this panel exists Today has been unmounted, so there is
// nothing left to measure — see `rememberRingRect` below for the two ways out
// of that and why this one was taken.

import { revokeObjectUrls } from "../article-render.js";
import { resolveCoverSources } from "../cover.js";
import { getDatabase, imageKeyFor } from "../db.js";
import { formatRelative, t, tCount } from "../i18n.js";
import { markItemSeen } from "../item-state.js";
import { growFrom, motionToken, prefersReducedMotion } from "../motion.js";
import { html, nothing, repeat } from "../render.js";
import { state, update } from "../state.js";
import { goBack, hrefFor, navigate } from "../router.js";
import { buildStoryReel } from "../today-model.js";
import { emptyState, screenHeader } from "./layout.js";

/** @typedef {import('../db.js').ItemRow} ItemRow */
/** @typedef {import('../db.js').PublicationRow} PublicationRow */
/** @typedef {import('../today-model.js').StoryReel} StoryReel */
/** @typedef {import('../today-model.js').TodayCard} TodayCard */

/** Vertical travel (CSS px) that counts as a swipe rather than a stray touch. */
const SWIPE_PX = 60;

/** How far content rises into a panel that is still growing (D1). */
const RISE_PX = 10;

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
    screen.index = currentReel().startIndex;
  } catch (error) {
    console.warn("The Story could not be read:", error);
    screen.status = "error";
  }
  // `update()` renders synchronously, so the panel is in the document on the
  // next line and the grow can measure it. This is the one place the open can
  // start from: `storyView` runs on every redraw, and `ensureLoaded` short
  // circuits on all of them but the first of a visit.
  update();
  if (screen.status === "ready" && onStory()) playOpen();
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
 * Open (or re-open) the reel the route names, resetting the position and the
 * Seen bookkeeping. Where it actually opens is the reel's answer, not this
 * one's: `load` asks for `startIndex` once the rows are in hand, and that is
 * the first Frame not yet Seen, so a reader who closed the player halfway and
 * came back carries on rather than tapping through the same Frames again. The
 * index is 0 here only because nothing is loaded yet.
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

// --- Motion (D1 open and close, D2 Frame advance) --------------------------

/**
 * The tapped ring's rect, measured in Today before the navigation unmounted
 * it, and spent by the next open.
 * @type {DOMRect | null}
 */
let ringRect = null;

/**
 * The open animation, kept so that closing can run it backwards.
 * @type {Animation | null}
 */
let openAnim = null;

/**
 * True between the tap that closes the player and the route actually changing,
 * so a second Escape or a second tap on the cross does not race the reverse.
 */
let closing = false;

/**
 * Remember which ring the reader tapped, in viewport coordinates. Today calls
 * this immediately before `navigate`.
 *
 * **Why a rect and not a `view-transition-name`.** The player is a route, so
 * the ring is unmounted the moment Today stops rendering and there is nothing
 * left for `growFrom` to measure. Matching view-transition-names on the ring
 * and the panel is the prettier answer and the browser would do the geometry
 * for us — but it needs both ends inside one `document.startViewTransition`
 * callback, which means Today has to still be rendering that ring while the
 * Story renders its panel. It is not: this app renders one screen at a time
 * into one root, `startViewTransition` is not wired up yet (ADR-0012 leaves
 * that to the List to Feed ticket), and where the API is missing the fallback
 * is no animation at all rather than this one. A `DOMRect` is four numbers
 * that survive the navigation, needs no new primitive, and gives close its
 * reverse for free. Cheap beats pretty here.
 *
 * @param {DOMRect | null} rect
 */
export function rememberRingRect(rect) {
  ringRect = rect;
}

/**
 * A duration token in the milliseconds `el.animate()` counts in — CSS writes
 * seconds, WAAPI does not.
 * @param {string} name
 * @returns {number}
 */
function ms(name) {
  return Number.parseFloat(motionToken(name)) * 1000;
}

/** The panel currently on screen, or null before the first render of one. */
function panelElement() {
  return /** @type {HTMLElement | null} */ (document.querySelector(".story"));
}

/**
 * Grow the player out of the ring that opened it (D1): `--dur-slow` on
 * `--ease-spring`, from the ring disc's rect and `--r-pill` to full bleed and
 * square corners.
 *
 * The Cover colour and the clip are set inline for the length of the grow and
 * handed back to the stylesheet on `finished`. Inline rather than a class,
 * because lit-html patches the class attribute on every redraw and would take
 * it away mid-flight; temporary rather than permanent, because the settled
 * player is `--scrim-ink` in both themes by ticket 03's decision and only the
 * growing disc is the Publication's colour. Without the colour the panel is a
 * neutral rectangle for the first frame, which is the flash the brief forbids;
 * without the clip the Frame's photo pokes out of the pill's corners.
 */
function playOpen() {
  const panel = panelElement();
  const origin = ringRect;
  ringRect = null;
  if (!panel?.animate) return;
  panel.style.backgroundColor = `var(--cover-${currentReel().coverIndex})`;
  panel.style.overflow = "hidden";
  // A reader who typed the URL has no ring behind them, and `growFrom` takes
  // the same cross-fade it takes under reduced motion rather than growing out
  // of the top-left corner.
  openAnim = growFrom(origin, panel, {
    duration: ms("--dur-slow"),
    easing: motionToken("--ease-spring"),
  });
  openAnim.finished
    .then(() => {
      panel.style.backgroundColor = "";
      panel.style.overflow = "";
    })
    .catch(() => {});
  arrive(panel);
}

/**
 * The Frame's content arriving just behind the panel: opacity and a 10px rise
 * over `--dur-arrive`, delayed `--delay-arrive` so it lands inside a box that
 * is already most of the way open instead of travelling with it.
 *
 * Every direct child, because the panel has no single inner wrapper and adding
 * one for this would be markup that exists only for an animation.
 * @param {HTMLElement} panel
 */
function arrive(panel) {
  if (prefersReducedMotion()) return;
  for (const child of Array.from(panel.children)) {
    child.animate(
      [
        { opacity: 0, transform: `translateY(${RISE_PX}px)` },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: ms("--dur-arrive"),
        delay: ms("--delay-arrive"),
        easing: motionToken("--ease"),
        // Backwards, not both: the fill is only needed to hold a child out of
        // sight through its delay, and the animation ends where the child
        // rests. A forward fill outranks author styles for the life of the
        // panel, which took `:active` off the two chevrons that are `.btn`s.
        fill: "backwards",
      },
    );
  }
}

/**
 * Swap to the new Frame immediately and settle it in with the same
 * zoom+fade the rest of the app uses for a screen change (ADR-0012): from
 * `--zoom`/transparent to full size and opaque.
 *
 * This used to hold the swap until an out-animation on the old Frame had
 * finished, so the photo the reader was leaving stayed on screen — shrinking,
 * but still the old photo — for a whole `--dur` before the new one even
 * started arriving. Two people tapping through a reel felt that as the new
 * photo being slow. There is only one `.story__frame` node (lit patches it in
 * place rather than swapping elements), so the old content cannot fade out
 * while the new one fades in beside it; showing the new one the instant it is
 * available and animating only its arrival is what actually reads as fast.
 *
 * @param {() => void} swap Applies the new position to the store.
 */
function advance(swap) {
  const leaving = panelElement()?.querySelector(".story__frame");
  for (const running of leaving?.getAnimations() ?? []) running.cancel();
  swap();
  if (prefersReducedMotion()) return;
  const arriving = panelElement()?.querySelector(".story__frame");
  if (!arriving?.animate) return;
  // Read rather than written as `var(--zoom)`: WAAPI does not resolve custom
  // properties inside keyframe values (see the same note on `growFrom`).
  arriving.animate(
    [
      { opacity: 0, transform: `scale(${motionToken("--zoom")})` },
      { opacity: 1, transform: "none" },
    ],
    {
      duration: ms("--dur-frame"),
      easing: motionToken("--ease-spring"),
      fill: "both",
    },
  );
}

// --- Advancing, and marking Seen ------------------------------------------

/** Whether the gestures and the key bindings should be active right now. */
function onStory() {
  return state.route.name === "story";
}

/**
 * Move one Frame in `dir`, or show the end panel when the reel runs out.
 * Advance is always something the reader did: there is no timer anywhere in
 * this file.
 *
 * The store change is handed to `advance` rather than made here so it can
 * cancel whatever arrival animation the previous step is still running
 * first — `advance` itself commits the swap synchronously, so two taps in
 * quick succession each land on the index current at the time they were
 * made. Running off the end is not a Frame change, so it redraws
 * immediately: the Frame under the end panel is the one that was already
 * showing.
 * @param {number} dir -1 or 1.
 * @param {number} total
 */
function step(dir, total) {
  const index = screen.index + dir;
  if (index < 0) return;
  if (index >= total) {
    // Past the last Frame the reel ends on a panel, not on a dead tap.
    screen.done = true;
    update();
    return;
  }
  advance(() => {
    screen.index = index;
    screen.done = false;
    update();
  });
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
    // The handle belongs to a panel that has just left the document; keeping it
    // would let the next close reverse an animation of the wrong Story.
    openAnim = null;
    closing = false;
    // Everything else measured belongs to the visit that is ending. A rect
    // kept past a failed load would grow the next Story out of a ring that is
    // no longer on screen, at a scroll position that no longer holds.
    ringRect = null;
  });
  window.addEventListener("pagehide", () => {
    revoke(screen.objectUrls);
    screen.objectUrls = [];
  });

  window.addEventListener("keydown", (event) => {
    if (!onStory()) return;
    const total = currentReel().frames.length;
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight") step(1, total);
    else if (event.key === "ArrowLeft") step(-1, total);
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

/**
 * Leave the player: back to the feed, at the scroll position it kept.
 *
 * The route change is what closes it: main.js wraps every route change away
 * from the Story player in the same zoom+fade every other screen change gets
 * (ADR-0012), so there is nothing left to animate here beyond cancelling
 * whatever open animation is still running — reversing `growFrom` would play
 * the open backwards, not close, and closing always takes the same short
 * time regardless of how far the open had gotten.
 */
function close() {
  if (closing) return;
  closing = true;
  openAnim?.cancel();
  openAnim = null;
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
 * Position pips: one segment per Frame, filled up to the current one.
 *
 * A pip fills in response to a tap and never ahead of one. Nothing in this
 * player advances by itself, which is still the reason, but it is no longer
 * true that they do not animate: the arriving pip fills over `--dur-frame`,
 * the same span the arriving Frame takes. The rule that makes the two
 * inseparable is that the fill is a CSS transition on `--on`, and this template
 * puts `--on` where the store says the position is — so the pip cannot report a
 * Frame that has not landed, whatever a tap does mid-transition.
 *
 * A pip row is not readable on its own at six segments, so the "Frame 3 of 6"
 * line beside it carries the same fact in words.
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
      @click=${() => step(-1, total)}
    ></button>
    <button
      type="button"
      class="story__zone story__zone--next"
      aria-hidden="true"
      tabindex="-1"
      @click=${() => step(1, total)}
    ></button>
    <button
      type="button"
      class="btn btn--tap story__nav story__nav--back"
      aria-label=${t("story.previous")}
      title=${t("story.previous")}
      ?disabled=${screen.index === 0}
      @click=${() => step(-1, total)}
    >
      ${chevron("left")}
    </button>
    <button
      type="button"
      class="btn btn--tap story__nav story__nav--next"
      aria-label=${t("story.next")}
      title=${t("story.next")}
      @click=${() => step(1, total)}
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
            @click=${() => {
              update({ todayFilter: reel.publicationId });
              navigate("today");
            }}
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
