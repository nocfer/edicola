// Reader: one Item, full screen (spec stories 15-18, 20, 22).
//
// A full-screen push — `main.js` hides the tab bar on this route and this
// screen carries its own back control. The header is sticky and holds the two
// things ADR-0004 requires to be visible at all times: the Publication's name
// and a link to the Original. Edicola never presents itself as the publisher,
// and it never tries to obtain what a publisher withheld: an Item with no
// Article shows its Summary and says plainly why the text is short.
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
// Reading Position (ticket 11) is deliberately not implemented here. The
// window is the scroll container, as on Today, and the Article sits in a
// container with the stable id `READER_SCROLL_ID` carrying `data-item-id`, so
// ticket 11 has one element to measure and one id to find it by.

import { prepareArticle, revokeObjectUrls } from "../article-render.js";
import { getDatabase, imageKeyFor } from "../db.js";
import {
  extractArticleInBrowser,
  windowFor as browserWindowFor,
} from "../extract.js";
import { fetchArticleNow } from "../fetch-one.js";
import { createFetcher } from "../fetcher.js";
import { formatDate, formatRelative, t } from "../i18n.js";
import { html, nothing, unsafeHTML } from "../render.js";
import { goBack, hrefFor, parseRoute } from "../router.js";
import { effectiveProxyTemplate, getSettingsStore } from "../settings.js";
import { showToast, state, update } from "../state.js";
import { getSyncStore } from "../store.js";
import { emptyState } from "./layout.js";

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
    await markRead(item);
    if (item.hasArticle) await mountArticle(id, await db.articles.get(id));
    update();
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
  window.addEventListener("pagehide", releaseObjectUrls);
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

// --- On-demand Extraction --------------------------------------------------

/** Whether opening this Item should try Extraction right now. */
function needsExtraction() {
  const item = screen.item;
  if (!item || screen.article || screen.fetching) return false;
  if (!state.online || !item.link) return false;
  return !attempted.has(item.id);
}

/**
 * The fetcher this screen uses: the browser's `fetch`, the reader's own Proxy
 * from the `settings` table, and `navigator.onLine` as the offline tiebreaker
 * (ADR-0001). Same shape as `sync-client.js`'s `pageFetcher`; a missing or
 * invalid row falls back to the shipped default.
 * @returns {Promise<import('../fetcher.js').Fetcher>}
 */
async function pageFetcher() {
  let proxyTemplate;
  try {
    proxyTemplate = effectiveProxyTemplate(
      await (await getSettingsStore()).getProxyTemplate(),
    );
  } catch {
    proxyTemplate = effectiveProxyTemplate("");
  }
  return createFetcher({
    fetch: (input, init) => globalThis.fetch(input, init),
    onLine: () => navigator.onLine,
    proxyTemplate,
  });
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
 * Flip `saved` and say so. Stored as `0 | 1` because IndexedDB cannot index a
 * boolean (see db.js); a Saved Item and its Article are never Evicted.
 * @returns {Promise<void>}
 */
async function toggleSaved() {
  const item = screen.item;
  if (!item) return;
  const next = item.saved ? 0 : 1;
  try {
    await getDatabase().items.update(item.id, { saved: next });
    item.saved = /** @type {0|1} */ (next);
    showToast(t(next ? "reader.savedToast" : "reader.unsavedToast"));
  } catch (error) {
    console.warn("Saved could not be written:", error);
    showToast(t("reader.saveFailed"));
  }
  update();
}

/**
 * Share the Original through the system sheet, falling back to copying the
 * link. A dismissed sheet is not a failure and says nothing.
 * @returns {Promise<void>}
 */
async function share() {
  const item = screen.item;
  if (!item?.link) return;
  const payload = { title: item.title || t("reader.title"), url: item.link };
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      if (/** @type {any} */ (error)?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(item.link);
    showToast(t("reader.shareCopied"));
  } catch (error) {
    console.warn("The link could not be shared:", error);
    showToast(t("reader.shareFailed"));
  }
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

/** @param {boolean} filled */
function bookmarkIcon(filled) {
  return html`<svg
    class="ico"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill=${filled ? "currentColor" : "none"}
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
  </svg>`;
}

const shareIcon = html`<svg
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
  <path d="M12 16V3" />
  <path d="m7 8 5-5 5 5" />
  <path d="M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
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
 * @param {string} label
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
 * The sticky header: back, the Publication's name with the link to its
 * Original, and the two Item actions. It is sticky because ADR-0004 asks for
 * the Publication and the Original to be visible, not merely present at the
 * top of a long Article.
 */
function header() {
  const item = screen.item;
  const isSaved = Boolean(item?.saved);
  return html`
    <header class="screen__header reader__header">
      <button
        type="button"
        class="btn btn--icon"
        aria-label=${t("reader.back")}
        title=${t("reader.back")}
        @click=${goBack}
      >
        ${backIcon}
      </button>
      <div class="reader__ident">
        <span class="reader__pub">${publicationName()}</span>
        ${originalLink("reader__origin", t("reader.original"))}
      </div>
      ${
        state.online
          ? nothing
          : html`<span class="chip chip--muted">${t("app.offline")}</span>`
      }
      ${
        item
          ? html`
            <button
              type="button"
              class="btn btn--icon reader__action ${
                isSaved ? "reader__action--on" : ""
              }"
              aria-pressed=${isSaved ? "true" : "false"}
              aria-label=${t(isSaved ? "reader.unsaveAria" : "reader.saveAria")}
              title=${t(isSaved ? "reader.saved" : "reader.save")}
              @click=${toggleSaved}
            >
              ${bookmarkIcon(isSaved)}
            </button>
            ${
              item.link
                ? html`<button
                    type="button"
                    class="btn btn--icon reader__action"
                    aria-label=${t("reader.share")}
                    title=${t("reader.share")}
                    @click=${share}
                  >
                    ${shareIcon}
                  </button>`
                : nothing
            }
          `
          : nothing
      }
    </header>
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
          ? html`<span>${t("reader.words", { count: article.wordCount })}</span>`
          : nothing
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
 * Why there is no Article, and the Original (ADR-0004). An Item the publisher
 * withheld says so plainly; an Item Extraction has simply not reached yet says
 * *that*, because claiming a paywall where there is none would be a lie in the
 * other direction.
 */
function fallbackCard() {
  const item = /** @type {ItemRow} */ (screen.item);
  const reason = screen.fetchReason || item.summaryOnlyReason;
  const withheld = Boolean(item.summaryOnly || screen.fetchReason);
  const offline = !state.online;
  return html`
    <div class="card reader__fallback">
      <p class="reader__fallbackhead">${t("reader.summaryOnly")}</p>
      <p class="reader__fallbackbody">
        ${t(withheld ? "reader.summaryOnlyBody" : "reader.notFetched")}
      </p>
      ${
        withheld && reason && KNOWN_REASONS.has(reason)
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
      ${header()}
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
    </section>
  `;
}
