// Saved: everything the reader has marked to keep (spec stories 27-28).
//
// The same cards as Today, in a different order and with one extra control.
// The order is most recently Saved first — not most recently published —
// because Saved is a list the reader built, and the last thing they put on it
// is the thing they are looking for. `savedAt` is what records that; an Item
// Saved before that field existed sorts by its publication date instead
// (item-state.js).
//
// This screen is the one place in the app that shows Items outside Retention.
// Today deliberately bounds itself to the Retention window (ticket 09), so a
// Saved Item from months ago is *only* reachable here — which is the whole
// point of Saved, and why the empty state says what Saved means rather than
// just "nothing here".
//
// Publications are read whole, not only the Enabled ones: switching a
// Publication off does not unsave what the reader kept from it, and a card
// with no name would be worse than a card from a Publication that is currently
// off.
//
// The screen's transient state is one module-level `screen` object, as tickets
// 08, 09 and 10 settled it: nothing outside this screen reads it, it does not
// survive a reload, and every mutation ends in a bare `update()` so main.js's
// single subscriber is what redraws.

import { getDatabase } from "../db.js";
import { formatRelative, t, tCount } from "../i18n.js";
import { savedAtOf, savedItems, setItemSaved } from "../item-state.js";
import { html, nothing, repeat } from "../render.js";
import { hrefFor, parseRoute } from "../router.js";
import { showToast, update } from "../state.js";
import { oneLine } from "../today-model.js";
import { emptyState, once, screenHeader } from "./layout.js";

/** @typedef {import('../db.js').ItemRow} ItemRow */
/** @typedef {import('../db.js').PublicationRow} PublicationRow */

/**
 * This screen's transient state.
 * @typedef {object} ScreenState
 * @property {'idle'|'loading'|'ready'|'error'} status
 * @property {ItemRow[]} items Saved Items, most recently Saved first.
 * @property {Map<string, PublicationRow>} publications Every Publication, by id.
 * @property {Set<string>} busy Item ids with an unsave in flight.
 * @property {Set<string>} brokenThumbs Thumbnail URLs that failed to load.
 */

/** @type {ScreenState} */
const screen = {
  status: "idle",
  items: [],
  publications: new Map(),
  busy: new Set(),
  brokenThumbs: new Set(),
};

// --- Loading ---------------------------------------------------------------

/**
 * Read the Saved Items and the Publications they came from. One indexed lookup
 * on `items.saved` (which is why that column is `0 | 1` — IndexedDB cannot
 * index a boolean, see db.js) and one small table read.
 * @returns {Promise<void>}
 */
async function load() {
  try {
    const db = getDatabase();
    const items = await savedItems(db);
    /** @type {PublicationRow[]} */
    const publications = await db.publications.toArray();
    screen.items = items;
    screen.publications = new Map(publications.map((p) => [p.id, p]));
    screen.status = "ready";
  } catch (error) {
    console.warn("Saved could not be read:", error);
    if (screen.status !== "ready") screen.status = "error";
  }
  update();
}

const ensureLoaded = once(() => {
  screen.status = "loading";
  installListeners();
  void load();
});

let installed = false;
/** Whether the last hash change took us off Saved. */
let leftSaved = false;

/**
 * Reload when the reader comes back, because what they did while away is
 * exactly what this list shows: saving an Item in the Reader, or reading one.
 *
 * This hangs off `hashchange` rather than off the render for the reason ticket
 * 09 documented for Today: while another screen is open this one is not
 * rendered at all, so a view-side route check never sees the route leave.
 */
function installListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("hashchange", () => {
    const onSaved = parseRoute(location.hash).name === "saved";
    if (!onSaved) {
      leftSaved = true;
      return;
    }
    if (!leftSaved) return;
    leftSaved = false;
    void load();
  });
}

// --- Actions ---------------------------------------------------------------

/**
 * Unsave one Item from its card. The row leaves the list immediately, and the
 * toast says what that means: the Item is content again and Retention may
 * Evict it.
 * @param {ItemRow} item
 * @returns {Promise<void>}
 */
async function unsave(item) {
  if (screen.busy.has(item.id)) return;
  screen.busy.add(item.id);
  update();
  try {
    await setItemSaved(getDatabase(), item.id, false);
    screen.items = screen.items.filter((row) => row.id !== item.id);
    showToast(t("saved.unsavedToast"));
  } catch (error) {
    console.warn("This Item could not be unsaved:", error);
    showToast(t("saved.unsaveFailed"));
  } finally {
    screen.busy.delete(item.id);
    update();
  }
}

/**
 * A thumbnail that will not load leaves no gap and no broken-image glyph, the
 * same imperative hide Today uses: no `?hidden` binding to undo it, and no
 * `update()`, because the DOM is already right.
 * @param {Event} event
 */
function onThumbError(event) {
  const img = /** @type {HTMLImageElement} */ (event.currentTarget);
  const url = img.getAttribute("src");
  if (url) screen.brokenThumbs.add(url);
  img.hidden = true;
}

// --- Templates -------------------------------------------------------------

/** The name of the Publication an Item came from, never left blank. */
function publicationName(/** @type {ItemRow} */ item) {
  const publication = screen.publications.get(item.publicationId);
  return String(publication?.name || item.publicationId);
}

/** @param {ItemRow} item */
function savedCard(item) {
  const name = publicationName(item);
  const when = formatRelative(savedAtOf(item));
  const summary = oneLine(item.summaryText || "");
  const thumb =
    item.thumbnailUrl && !screen.brokenThumbs.has(item.thumbnailUrl)
      ? item.thumbnailUrl
      : null;
  const busy = screen.busy.has(item.id);
  return html`
    <div class="card saved__card ${item.read ? "saved__card--read" : ""}">
      <a
        class="saved__link"
        href=${hrefFor("reader", { id: item.id })}
        aria-label=${t("saved.cardAria", { title: item.title, publication: name, when })}
      >
        <span class="saved__cardmain">
          <span class="saved__meta">
            ${
              item.read
                ? nothing
                : html`<span
                    class="saved__dot"
                    title=${t("saved.unread")}
                    aria-hidden="true"
                  ></span>`
            }
            <span class="saved__pub">${name}</span>
            <span class="saved__when">${t("saved.savedWhen", { when })}</span>
            ${
              item.summaryOnly
                ? html`<span class="saved__flag">${t("saved.summaryOnly")}</span>`
                : nothing
            }
          </span>
          <span class="saved__cardtitle">${item.title}</span>
          ${summary ? html`<span class="saved__summary">${summary}</span>` : nothing}
        </span>
        ${
          thumb
            ? html`<img
                class="saved__thumb"
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
      <button
        type="button"
        class="btn saved__unsave"
        aria-label=${t("saved.unsaveAria", { title: item.title })}
        ?disabled=${busy}
        @click=${() => unsave(item)}
      >
        ${t("saved.unsave")}
      </button>
    </div>
  `;
}

/**
 * What to show with nothing Saved. It explains what Saved *is* — an Item that
 * is never removed — because "nothing here" alone leaves the reader with no
 * idea why the tab exists.
 */
function emptyBody() {
  return emptyState(
    `${t("saved.empty")} ${t("saved.emptyBody")}`,
    html`<a class="btn btn--primary" href=${hrefFor("today")}
      >${t("saved.toToday")}</a
    >`,
  );
}

/** @param {import('../state.js').State} appState */
export function savedView(appState) {
  ensureLoaded();
  const loading = screen.status === "idle" || screen.status === "loading";

  return html`
    <section class="screen">
      ${screenHeader(appState, t("saved.title"))}
      <div class="screen__body saved__body">
        ${
          loading
            ? html`<p class="saved__hint" role="status">${t("saved.loading")}</p>`
            : nothing
        }
        ${
          screen.status === "error"
            ? emptyState(
                t("saved.loadError"),
                html`<button
                  type="button"
                  class="btn btn--primary"
                  @click=${() => {
                    screen.status = "loading";
                    update();
                    void load();
                  }}
                >
                  ${t("saved.retry")}
                </button>`,
              )
            : nothing
        }
        ${
          screen.status === "ready" && screen.items.length === 0
            ? emptyBody()
            : nothing
        }
        ${
          screen.items.length > 0
            ? html`<p class="saved__count" role="status">
                  ${tCount("saved.count", screen.items.length)}
                </p>
                <div class="saved__list">
                  ${repeat(screen.items, (item) => item.id, savedCard)}
                </div>`
            : nothing
        }
      </div>
    </section>
  `;
}
