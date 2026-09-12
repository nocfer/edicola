// Reader: one Item, full screen (spec stories 15-18, 20, 22).
//
// A full-screen push — `main.js` hides the tab bar on this route, and this
// screen puts its own controls in the vacated slot: the same floating glass
// capsule, with back, save, share and the link to the Original in place of the
// four routes. ADR-0004's two requirements are met across the screen rather
// than in one bar: the link to the Original is always on screen, in the
// capsule, and the Publication's name heads the Article and closes it. Edicola
// never presents itself as the publisher, and it never tries to obtain what a
// publisher withheld: an Item with no Article shows its Summary and says
// plainly why the text is short.
//
// What happens on open:
//   1. The Item, its Publication and its Article are read from Dexie, and the
//      Item is marked Read (opening is what Read means — CONTEXT.md).
//   2. The Article's images are mapped to object URLs from the stored blobs
//      (`article-render.js`), so a complete Article renders with no network.
//   3. An Item with no Article triggers Extraction on the spot while online
//      (`fetch-one.js`), behind a spinner, and swaps the Article in on
//      success. One attempt per Item per session, plus an explicit retry.
//
// Every object URL created here is revoked when the Reader unmounts — on
// leaving the route, on moving to another Item, and on `pagehide` — so a
// session of reading does not accumulate every image it ever showed.
//
// Reading Position: the window is the scroll container, as on Today, and the
// Article sits in the element with the stable id `READER_SCROLL_ID` carrying
// `data-item-id`. A passive `scroll` listener turns `window.scrollY` into a
// fraction of that element's travel (`reading-position.js`) and writes it to
// the Item, debounced; on open the fraction is applied back after lit has
// rendered and the images have laid out; reaching the end clears it, because
// reopening a finished Article at its last line is worse than opening it at
// the top.

import { prepareArticle, revokeObjectUrls } from "../article-render.js";
import { getDatabase, imageKeyFor } from "../db.js";
import {
  extractArticleInBrowser,
  windowFor as browserWindowFor,
} from "../extract.js";
import { fetchArticleNow } from "../fetch-one.js";
import { formatDate, formatRelative, t, tCount } from "../i18n.js";
import { toggleItemSaved, shareItem } from "../item-actions.js";
import { setReadingPosition } from "../item-state.js";
import {
  clampPosition,
  debounce,
  isAtEnd,
  isWorthRestoring,
  readingPositionOf,
  RESTORE_ABANDON_PX,
  RESTORE_ATTEMPTS_MS,
  RESTORE_SETTLE_MS,
  SAVE_DEBOUNCE_MS,
  scrollTargetFor,
} from "../reading-position.js";
import { html, nothing, unsafeHTML } from "../render.js";
import { MAX_ARTICLE_ATTEMPTS } from "../retention.js";
import { goBack, hrefFor, parseRoute } from "../router.js";
import { pageFetcher } from "../settings.js";
import { state, update } from "../state.js";
import { getSyncStore } from "../store.js";
import { bookmarkIcon, emptyState, externalIcon, shareIcon } from "./layout.js";

/** @typedef {import('../db.js').ItemRow} ItemRow */
/** @typedef {import('../db.js').ArticleRow} ArticleRow */
/** @typedef {import('../db.js').PublicationRow} PublicationRow */

/**
 * Id of the Article's scroll container. Ticket 11 (Reading Position) reads the
 * element with this id and its `data-item-id` attribute; the window is what
 * actually scrolls, so a fraction is `window.scrollY` against this element's
 * offset and height.
 */
export const READER_SCROLL_ID = "reader-scroll";

/**
 * Reasons that mean the publisher did not send the full Article: Extraction
 * ran on what an anonymous visitor was given and found a teaser, or no article
 * text at all (ADR-0004). Every other reason is a request that failed, which
 * is a different sentence.
 */
const WITHHELD_REASONS = new Set(["too-short", "no-content"]);

/** Summary-only reasons that have their own line of copy (`reader.reason.*`). */
const KNOWN_REASONS = new Set([
  "no-content",
  "too-short",
  "blocked",
  "not-found",
  "offline",
  "timeout",
  "too-large",
  "proxy-unconfigured",
  "no-link",
]);

/**
 * This screen's transient state, one module-level object as tickets 08 and 09
 * settled it: nothing outside this screen reads it, it does not survive a
 * reload, and every mutation ends in a bare `update()` so main.js's single
 * subscriber is what redraws.
 *
 * @typedef {object} ScreenState
 * @property {'idle'|'loading'|'ready'|'missing'|'error'} status
 * @property {string|null} itemId The Item currently mounted.
 * @property {ItemRow|null} item
 * @property {PublicationRow|null} publication
 * @property {ArticleRow|null} article
 * @property {string} articleHtml Article markup with stored images swapped in.
 * @property {string[]} objectUrls Object URLs to revoke on unmount.
 * @property {number} imagesFromStorage
 * @property {number} imagesFromNetwork
 * @property {boolean} fetching An on-demand Extraction is in flight.
 * @property {string|null} fetchReason Why the last Extraction gave no Article.
 * @property {number} position The Reading Position last written for this Item.
 * @property {boolean} restoring A restore sequence is still re-applying, so
 *   the scroll listener must not mistake a growing Article for progress.
 */

/** @type {ScreenState} */
const screen = {
  status: "idle",
  itemId: null,
  item: null,
  publication: null,
  article: null,
  articleHtml: "",
  objectUrls: [],
  imagesFromStorage: 0,
  imagesFromNetwork: 0,
  fetching: false,
  fetchReason: null,
  position: 0,
  restoring: false,
};

/** Items whose on-demand Extraction has already been tried this session. */
const attempted = new Set();

// --- Mounting and unmounting ----------------------------------------------

/**
 * Read the Item, its Publication and its Article, mark it Read, and map the
 * Article's images to the stored blobs.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function load(id) {
  try {
    const db = getDatabase();
    /** @type {ItemRow|undefined} */
    const item = await db.items.get(id);
    if (!item) {
      if (screen.itemId === id) screen.status = "missing";
      update();
      return;
    }
    const publication = await db.publications.get(item.publicationId);
    if (screen.itemId !== id) return;
    screen.item = item;
    screen.publication = publication ?? null;
    screen.status = "ready";
    // Read before anything else writes it: `markRead` and the scroll listener
    // both touch this row, and the Reading Position we must restore is the one
    // the reader left behind, not whatever the first frame measures.
    const stored = clampPosition(item.readingPosition);
    screen.position = stored;
    await markRead(item);
    if (item.hasArticle) await mountArticle(id, await db.articles.get(id));
    update();
    scheduleRestore(id, stored);
    if (needsExtraction()) void extractNow();
  } catch (error) {
    console.warn("The Reader could not read this Item:", error);
    if (screen.itemId === id && screen.status !== "ready") {
      screen.status = "error";
    }
    update();
  }
}

/**
 * Put an Article on screen: map its images to object URLs from storage first,
 * so the markup that reaches lit already points at `blob:` URLs and no image
 * request ever leaves the device for a picture we hold.
 * @param {string} id The Item this Article belongs to (guards a late resolve).
 * @param {ArticleRow|undefined} article
 * @returns {Promise<void>}
 */
async function mountArticle(id, article) {
  if (!article) return;
  const prepared = await prepareArticle(article.html, {
    db: getDatabase(),
    imageKeyFor,
    windowFor: browserWindowFor,
    createObjectURL: (blob) => URL.createObjectURL(blob),
  });
  // The reader may have left, or moved on, while the blobs were being read.
  if (screen.itemId !== id) {
    revokeObjectUrls(prepared.objectUrls, {
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    });
    return;
  }
  releaseObjectUrls();
  screen.article = article;
  screen.articleHtml = prepared.html;
  screen.objectUrls = prepared.objectUrls;
  screen.imagesFromStorage = prepared.fromStorage;
  screen.imagesFromNetwork = prepared.fromNetwork;
}

/**
 * Opening an Item is what marks it Read (CONTEXT.md: scrolling past it on
 * Today does not). `read` is a plain boolean; only `saved` is `0 | 1`.
 * @param {ItemRow} item
 * @returns {Promise<void>}
 */
async function markRead(item) {
  if (item.read) return;
  try {
    await getDatabase().items.update(item.id, { read: true });
    item.read = true;
  } catch (error) {
    console.warn("This Item could not be marked read:", error);
  }
}

/** Release the object URLs of the Article on screen. */
function releaseObjectUrls() {
  if (screen.objectUrls.length === 0) return;
  revokeObjectUrls(screen.objectUrls, {
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  });
  screen.objectUrls = [];
}

/** Forget the Item on screen and give its object URLs back to the browser. */
function unmount() {
  // The reader is leaving, so the debounced Reading Position write must land
  // now rather than after the Item it belongs to has been forgotten.
  positionSaver.flush();
  cancelRestore();
  releaseObjectUrls();
  screen.status = "idle";
  screen.itemId = null;
  screen.item = null;
  screen.publication = null;
  screen.article = null;
  screen.articleHtml = "";
  screen.imagesFromStorage = 0;
  screen.imagesFromNetwork = 0;
  screen.fetching = false;
  screen.fetchReason = null;
  screen.position = 0;
}

let installed = false;

/**
 * Unmount when the reader leaves. This hangs off `hashchange` rather than off
 * the render because a view that is no longer rendered cannot notice that it
 * was left — the same reason ticket 09 gave for Today's scroll restore.
 * `pagehide` covers a reload or a closed tab.
 */
function installListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("hashchange", () => {
    if (parseRoute(location.hash).name !== "reader") unmount();
  });
  window.addEventListener("pagehide", () => {
    positionSaver.flush();
    releaseObjectUrls();
  });
  window.addEventListener("scroll", trackReadingPosition, { passive: true });
}

/**
 * Mount the Item named by the route, if it is not the one already on screen.
 * @param {string} id
 */
function ensureMounted(id) {
  installListeners();
  if (screen.itemId === id && screen.status !== "idle") return;
  if (screen.itemId !== id) unmount();
  screen.itemId = id;
  screen.status = "loading";
  void load(id);
}

// --- Reading Position ------------------------------------------------------

/**
 * The four measurements a Reading Position is computed from, or null when the
 * Article container is not on screen — or is on screen for a different Item,
 * which happens for a frame when the route moves from one Item to another and
 * lit has not yet swapped `data-item-id`.
 * @returns {import('../reading-position.js').ScrollMetrics | null}
 */
function scrollMetrics() {
  if (typeof document === "undefined") return null;
  const el = document.getElementById(READER_SCROLL_ID);
  if (!el) return null;
  if (el.getAttribute("data-item-id") !== screen.itemId) return null;
  return {
    scrollY: window.scrollY,
    top: el.offsetTop,
    height: el.offsetHeight,
    viewport: window.innerHeight,
  };
}

/**
 * Write the Reading Position of the Item on screen. Debounced, so dragging a
 * finger down a 3000 px Article is one write and not two hundred; the trailing
 * edge is what matters, because the last position is the one to come back to.
 */
const positionSaver = debounce((/** @type {number} */ position) => {
  const item = screen.item;
  if (!item) return;
  screen.position = position;
  item.readingPosition = position;
  setReadingPosition(getDatabase(), item.id, position).catch((error) => {
    console.warn("The Reading Position could not be written:", error);
  });
}, SAVE_DEBOUNCE_MS);

/**
 * Follow the reader down the Article. Reaching the end clears the Reading
 * Position rather than storing 1: an Article the reader finished should open at
 * its top next time, not at its last line.
 */
function trackReadingPosition() {
  if (screen.restoring) return;
  if (parseRoute(location.hash).name !== "reader") return;
  const metrics = scrollMetrics();
  if (!metrics) return;
  const position = readingPositionOf(metrics);
  const next = isAtEnd(position) ? 0 : position;
  if (next === screen.position) return;
  positionSaver.call(next);
}

/** @type {ReturnType<typeof setTimeout> | null} */
let restoreTimer = null;
/** The offset the last restore attempt applied, so a manual scroll wins. */
/** @type {number | null} */
let restoredTo = null;

/** Stop re-applying a Reading Position. */
function cancelRestore() {
  if (restoreTimer !== null) clearTimeout(restoreTimer);
  restoreTimer = null;
  restoredTo = null;
  screen.restoring = false;
}

/**
 * Put the reader back where they were.
 *
 * Two frames first, for the reason ticket 09 gave for Today: `main.js` scrolls
 * to the top on every path change and lit fills the Article in the same tick,
 * so a restore in the same frame is undone. Then the same offset is re-applied
 * a couple of times, because the Article's images are `loading="lazy"` and the
 * container grows as they lay out — the first target can be short by hundreds
 * of pixels. A reader who scrolls themselves in the meantime is left alone.
 *
 * @param {string} id The Item this position belongs to.
 * @param {number} position
 */
function scheduleRestore(id, position) {
  cancelRestore();
  if (!isWorthRestoring(position)) return;
  if (typeof requestAnimationFrame !== "function") return;
  screen.restoring = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => applyRestore(id, position, 0));
  });
}

/**
 * @param {string} id
 * @param {number} position
 * @param {number} attempt Index into `RESTORE_ATTEMPTS_MS`.
 */
function applyRestore(id, position, attempt) {
  restoreTimer = null;
  if (screen.itemId !== id || parseRoute(location.hash).name !== "reader") {
    cancelRestore();
    return;
  }
  const metrics = scrollMetrics();
  if (!metrics) {
    cancelRestore();
    return;
  }
  const drifted =
    restoredTo !== null &&
    Math.abs(window.scrollY - restoredTo) > RESTORE_ABANDON_PX;
  if (drifted) {
    // The reader took over. Their scroll is the truth from here on.
    cancelRestore();
    return;
  }
  const target = scrollTargetFor(position, metrics);
  if (target > 0) {
    window.scrollTo(0, target);
    restoredTo = target;
  }
  const next = attempt + 1;
  if (next >= RESTORE_ATTEMPTS_MS.length) {
    // Hand the scroll listener back once the last attempt has settled.
    restoreTimer = setTimeout(cancelRestore, RESTORE_SETTLE_MS);
    return;
  }
  restoreTimer = setTimeout(
    () => applyRestore(id, position, next),
    RESTORE_ATTEMPTS_MS[next],
  );
}

// --- On-demand Extraction --------------------------------------------------

/** Whether opening this Item should try Extraction right now. */
function needsExtraction() {
  const item = screen.item;
  if (!item || screen.article || screen.fetching) return false;
  if (!state.online || !item.link) return false;
  return !attempted.has(item.id);
}

/**
 * Fetch and extract the Original now, behind a spinner, and swap the Article
 * in place on success. Called once per Item per session on open, and again
 * from the retry button.
 * @returns {Promise<void>}
 */
async function extractNow() {
  const item = screen.item;
  if (!item || screen.fetching) return;
  const id = item.id;
  attempted.add(id);
  screen.fetching = true;
  screen.fetchReason = null;
  update();
  try {
    const result = await fetchArticleNow(item, {
      store: getSyncStore(),
      fetcher: await pageFetcher(),
      extractArticle: extractArticleInBrowser,
    });
    if (screen.itemId !== id) return;
    if (result.ok && result.article) {
      item.hasArticle = true;
      item.summaryOnly = false;
      item.summaryOnlyReason = null;
      await mountArticle(id, result.article);
    } else {
      item.summaryOnly = true;
      item.summaryOnlyReason = result.reason;
      screen.fetchReason = result.reason;
    }
  } catch (error) {
    console.warn("On-demand Extraction failed:", error);
    if (screen.itemId === id) screen.fetchReason = "error";
  } finally {
    if (screen.itemId === id) screen.fetching = false;
    update();
  }
}

// --- Actions ---------------------------------------------------------------

/**
 * Flip `saved`. The optimistic flip, the pop, the redraw, the write and the
 * toast all live in `item-actions.js`, shared with Feed mode's action bar;
 * this screen only has to say which Item and which control was tapped.
 * @param {Event} event
 * @returns {Promise<void>}
 */
async function toggleSaved(event) {
  if (!screen.item) return;
  await toggleItemSaved(screen.item, event.currentTarget);
}

/**
 * Share the Original. `item-actions.js` owns the Web Share call and its
 * clipboard fallback, shared with Feed mode.
 * @returns {Promise<void>}
 */
function share() {
  return shareItem(/** @type {any} */ (screen.item) || {});
}

// --- Templates -------------------------------------------------------------

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

/** The name of the Publication this Item came from, never left blank. */
function publicationName() {
  const publication = screen.publication;
  if (publication?.name) return String(publication.name);
  return screen.item?.publicationId || t("reader.title");
}

/**
 * A link to the Original. Always rendered when the Item has one (ADR-0004).
 * @param {string} className
 * @param {unknown} label  text, or a lit template (the control bar passes an
 *   icon and a caption, so it looks like the buttons beside it)
 */
function originalLink(className, label) {
  const link = screen.item?.link;
  if (!link) return nothing;
  return html`<a
    class=${className}
    href=${link}
    target="_blank"
    rel="noopener"
    title=${t("reader.originalAria", { publication: publicationName() })}
    >${label}</a
  >`;
}

/**
 * The Reader's controls: the tab bar's floating glass capsule, in the tab
 * bar's place, carrying actions instead of routes. The Reader is a full-screen
 * push that hides the tab bar (`hidesTabBar`), so that slot is free — and
 * reusing `.tabbar` rather than restyling a header of its own keeps the two
 * bars one definition, the way every other floating panel shares the glass
 * recipe.
 *
 * ADR-0004 asks the Reader to show the Publication and a link to the Original.
 * The link is here and always on screen; the Publication's name is in the
 * Article's head and again in its footer, because a capsule of icons with
 * one-word captions has no room for a masthead.
 */
function controlBar() {
  const item = screen.item;
  const isSaved = Boolean(item?.saved);
  return html`
    <div class="tabbar">
      <button
        type="button"
        class="tabbar__tab"
        title=${t("reader.back")}
        @click=${goBack}
      >
        ${backIcon}<span>${t("reader.back")}</span>
      </button>
      ${
        item
          ? html`
            <button
              type="button"
              class="tabbar__tab"
              aria-pressed=${isSaved ? "true" : "false"}
              title=${t(isSaved ? "reader.unsaveAria" : "reader.saveAria")}
              @click=${toggleSaved}
            >
              ${bookmarkIcon(isSaved)}<span
                >${t(isSaved ? "app.saved" : "app.save")}</span
              >
            </button>
            ${
              item.link
                ? html`<button
                    type="button"
                    class="tabbar__tab"
                    title=${t("app.share")}
                    @click=${share}
                  >
                    ${shareIcon}<span>${t("app.share")}</span>
                  </button>`
                : nothing
            }
            ${originalLink(
              "tabbar__tab",
              html`${externalIcon}<span>${t("reader.originalShort")}</span>`,
            )}
          `
          : nothing
      }
    </div>
  `;
}

/** Title, byline, date and — for a full Article — its length. */
function articleHead() {
  const item = /** @type {ItemRow} */ (screen.item);
  const article = screen.article;
  const title = article?.title || item.title;
  const byline = article?.byline;
  return html`
    <h1 class="reader__title">${title}</h1>
    <p class="reader__meta">
      <span>${t("reader.source", { publication: publicationName() })}</span>
      ${byline ? html`<span class="reader__byline">${byline}</span>` : nothing}
      <span class="reader__when" title=${formatRelative(item.publishedAt)}
        >${formatDate(item.publishedAt, { dateStyle: "long" })}</span
      >
      ${
        article
          ? html`<span>${tCount("reader.words", article.wordCount)}</span>`
          : nothing
      }
      ${
        // The control bar has no room for the Offline chip every other screen
        // carries in its header, so it rides with the rest of this Item's
        // provenance instead.
        state.online
          ? nothing
          : html`<span class="chip chip--muted">${t("app.offline")}</span>`
      }
    </p>
  `;
}

/** The Article itself: stored, sanitized markup with its images from storage. */
function articleBody() {
  return html`
    <div class="reader__article">${unsafeHTML(screen.articleHtml)}</div>
  `;
}

/** The spinner an on-demand Extraction runs behind. */
function fetchingNotice() {
  return html`
    <div class="card reader__fetching" role="status">
      <span class="reader__spinner" aria-hidden="true"></span>
      <span>${t("reader.fetching")}</span>
    </div>
  `;
}

/** The Feed's Summary — all there is to show until an Article exists. */
function summaryBlock() {
  const item = /** @type {ItemRow} */ (screen.item);
  if (!item.summaryHtml) {
    return html`<p class="reader__nosummary">${t("reader.noSummary")}</p>`;
  }
  return html`
    <div class="reader__article reader__summary">
      <p class="reader__summarylabel">${t("reader.summaryTitle")}</p>
      ${unsafeHTML(item.summaryHtml)}
    </div>
  `;
}

/**
 * Why there is no Article, and the Original (ADR-0004).
 *
 * Which sentence is honest depends on what happened, and the headline is part
 * of the claim. An Item Pre-fetching never reached is not Summary-only at all:
 * Retention caps how many Articles a Sync fetches per Publication, so most of
 * a Feed is routinely in that state, and heading it "Summary only" told the
 * reader a publisher had withheld something nobody ever asked for.
 *
 * Below that, Extraction which ran and found little means the publisher did
 * not send the full Article — the paywall case the ADR is about. But that
 * sentence is only honest once Sync has stopped trying. `too-short` was
 * measured flipping between a whole Article and a 39-word stub on identical
 * requests, so while attempts remain the app has not reached the conclusion
 * the sentence states. A fetch the reader triggered from this screen settles
 * it immediately: they asked, it ran, and nothing is pending behind it.
 *
 * Every other reason is a request that failed, which blames nobody.
 */
function fallbackCard() {
  const item = /** @type {ItemRow} */ (screen.item);
  const reason = screen.fetchReason || item.summaryOnlyReason;
  const offline = !state.online;
  const settled =
    Boolean(screen.fetchReason) || (item.attempts ?? 0) >= MAX_ARTICLE_ATTEMPTS;
  const withheld = Boolean(reason) && WITHHELD_REASONS.has(reason) && settled;
  const body = withheld ? "reader.summaryOnlyBody" : "reader.fetchFailed";
  return html`
    <div class="card reader__fallback">
      <p class="reader__fallbackhead">
        ${t(reason ? "reader.noArticleHead" : "reader.notFetched")}
      </p>
      ${reason ? html`<p class="reader__fallbackbody">${t(body)}</p>` : nothing}
      ${
        reason && KNOWN_REASONS.has(reason)
          ? html`<p class="reader__reason">${t(`reader.reason.${reason}`)}</p>`
          : nothing
      }
      ${
        offline
          ? html`<p class="reader__reason">${t("reader.offline")}</p>`
          : nothing
      }
      <div class="reader__fallbackactions">
        ${originalLink("btn btn--primary", t("reader.original"))}
        ${
          item.link && !offline
            ? html`<button
                type="button"
                class="btn"
                ?disabled=${screen.fetching}
                @click=${() => {
                  void extractNow();
                }}
              >
                ${
                  attempted.has(item.id)
                    ? t("reader.retry")
                    : t("reader.fetchArticle")
                }
              </button>`
            : nothing
        }
      </div>
    </div>
  `;
}

/**
 * A screen with no Item to show: it was Evicted, or storage would not answer.
 * @param {string} text
 */
function notice(text) {
  return emptyState(
    text,
    html`<a class="btn btn--primary" href=${hrefFor("today")}
      >${t("reader.toToday")}</a
    >`,
  );
}

/** @param {import('../state.js').State} appState */
export function readerView(appState) {
  const id = appState.route.params.id || "";
  ensureMounted(id);
  const item = screen.item;

  return html`
    <section class="screen screen--reader">
      <div class="screen__body reader__body">
        ${
          screen.status === "loading"
            ? html`<p class="reader__hint" role="status">
                ${t("reader.loading")}
              </p>`
            : nothing
        }
        ${screen.status === "missing" ? notice(t("reader.missing")) : nothing}
        ${screen.status === "error" ? notice(t("reader.loadError")) : nothing}
        ${
          item
            ? html`<div
                class="reader__scroll"
                id=${READER_SCROLL_ID}
                data-item-id=${item.id}
              >
                ${articleHead()}
                ${screen.fetching ? fetchingNotice() : nothing}
                ${screen.article ? articleBody() : summaryBlock()}
                ${screen.article || screen.fetching ? nothing : fallbackCard()}
                <footer class="reader__footer">
                  <p class="reader__footertext">
                    ${t("reader.source", { publication: publicationName() })}
                  </p>
                  ${originalLink("btn", t("reader.original"))}
                </footer>
              </div>`
            : nothing
        }
      </div>
      ${controlBar()}
    </section>
  `;
}
