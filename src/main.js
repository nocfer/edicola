// Entry module: boots the store, the router and the single render subscriber.
//
// Everything that redraws goes through `update()` in state.js; this file owns
// the one `render` that reacts to it, plus the side effects that belong with a
// state change (persisting the theme preference, flipping <html lang>,
// re-translating the static copy in index.html, showing/hiding the tab bar).
// Views never touch the DOM outside their template; they call `update()`.

import { html, nothing, render } from "./render.js";
import { state, subscribe, update } from "./state.js";
import { applyStaticI18n, getLang, initLang, setLang, t } from "./i18n.js";
import { hidesTabBar, startRouter } from "./router.js";
import { withViewTransition } from "./motion.js";
import { initSyncClient, syncIfStale } from "./sync-client.js";
import { applyUpdate, dismissUpdate, initUpdates } from "./update.js";
import { todayView } from "./views/today.js";
import { savedView } from "./views/saved.js";
import { publicationsView } from "./views/publications.js";
import { settingsView } from "./views/settings.js";
import { readerView } from "./views/reader.js";
import { storyView } from "./views/story.js";
import { notFoundView } from "./views/not-found.js";

/** localStorage key shared with the pre-paint script in index.html. */
const THEME_KEY = "edicola.theme";

/**
 * localStorage key for Today's View Mode. Unlike the theme this needs no
 * pre-paint script in index.html: the boot block below seeds `viewMode` before
 * `subscribe(renderApp)`, so nothing has painted yet and there is no flash of
 * the wrong presentation to prevent.
 */
const VIEWMODE_KEY = "edicola.viewmode";

const lightQuery = matchMedia("(prefers-color-scheme: light)");

/** @returns {import('./state.js').ThemePreference} */
function readThemePreference() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/**
 * Today's View Mode, Feed unless the reader has chosen List. Feed is the
 * default because it is the presentation the Catalog's pictures and Story
 * rings are for; List is a preference, so only a stored "list" turns it on.
 * @returns {import('./state.js').ViewMode}
 */
function readViewModePreference() {
  try {
    return localStorage.getItem(VIEWMODE_KEY) === "list" ? "list" : "feed";
  } catch {
    return "feed";
  }
}

/**
 * Persist Today's View Mode. A side effect of a state change, so it lives here
 * beside the theme's rather than in the view that flipped it.
 * @param {import('./state.js').ViewMode} mode
 */
function applyViewMode(mode) {
  try {
    if (mode === "feed") localStorage.setItem(VIEWMODE_KEY, mode);
    else localStorage.removeItem(VIEWMODE_KEY);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

/**
 * Apply the theme preference: resolve `system` against the OS, set the
 * `data-theme` attribute the token layer keys on, persist, and keep the
 * browser chrome colour in step with `--bg`.
 * @param {import('./state.js').ThemePreference} pref
 */
function applyTheme(pref) {
  const resolved =
    pref === "system" ? (lightQuery.matches ? "light" : "dark") : pref;
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  if (meta && bg) meta.setAttribute("content", bg);
}

let appliedLang = "";

/** @param {import('./state.js').Lang} lang */
function applyLang(lang) {
  if (lang === appliedLang) return;
  appliedLang = lang;
  if (getLang() !== lang) setLang(lang);
  document.documentElement.lang = lang;
  applyStaticI18n();
}

const SCREENS = {
  today: todayView,
  saved: savedView,
  publications: publicationsView,
  settings: settingsView,
  reader: readerView,
  story: storyView,
  "not-found": notFoundView,
};

const screenEl = /** @type {HTMLElement} */ (document.getElementById("screen"));
const tabbarEl = /** @type {HTMLElement} */ (document.getElementById("tabbar"));

let lastPath = "";

/** Mark the active tab and hide the bar on full-screen routes (the Reader). */
function updateTabBar(/** @type {import('./router.js').Route} */ route) {
  const hidden = hidesTabBar(route);
  tabbarEl.hidden = hidden;
  screenEl.classList.toggle("app--with-tabbar", !hidden);
  for (const tab of tabbarEl.querySelectorAll("[data-route]")) {
    if (tab.getAttribute("data-route") === route.name)
      tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
}

/**
 * The update prompt (ADR-0008): a new Shell is announced here and applied only
 * when the reader says so. Rendered beside the toast because it belongs to the
 * app frame, not to a screen — a reader on any tab must see it.
 */
function updatePrompt() {
  if (!state.appUpdate.available) return nothing;
  return html`
    <div class="update" role="alert">
      <span class="update__text">${t("settings.update.available")}</span>
      <button
        type="button"
        class="btn btn--primary update__apply"
        ?disabled=${state.appUpdate.applying}
        @click=${() => {
          void applyUpdate();
        }}
      >
        ${
          state.appUpdate.applying
            ? t("settings.update.applying")
            : t("settings.update.reload")
        }
      </button>
      <button
        type="button"
        class="btn update__later"
        ?disabled=${state.appUpdate.applying}
        @click=${dismissUpdate}
      >
        ${t("settings.update.later")}
      </button>
    </div>
  `;
}

/** The store's sole subscriber: every `update()` redraws through here. */
function renderApp() {
  applyTheme(state.theme);
  applyLang(state.lang);
  applyViewMode(state.viewMode);
  const view = SCREENS[state.route.name] || notFoundView;
  render(
    html`${view(state)}${updatePrompt()}${
      state.toast
        ? html`<div class="toast" role="status">${state.toast}</div>`
        : nothing
    }`,
    screenEl,
  );
  updateTabBar(state.route);
  if (state.route.path !== lastPath) {
    lastPath = state.route.path;
    window.scrollTo(0, 0);
  }
}

// --- Boot -----------------------------------------------------------------
document.getElementById("boot")?.remove();
state.theme = readThemePreference();
state.lang = initLang();
state.viewMode = readViewModePreference();
state.online = navigator.onLine;

/**
 * Give the View Transition's "after" snapshot something painted to show.
 * Today's cards remount from scratch on the way back from the Reader (its
 * lit-html tree was torn down while the Reader was on screen), so right
 * after `update({ route })` their pictures are still mid-decode — the
 * snapshot a cross-dissolve captures is of an unfinished paint, which is
 * what reads as a glitch. `decode()` waits for exactly that, but only for
 * pictures already inside the viewport: the rest are behind `loading="lazy"`
 * on purpose, and forcing them to load here would defeat that. Capped at
 * 150ms — long enough for a warm-cache decode, short enough that a slow one
 * cuts to the render rather than holding the transition open.
 * @returns {Promise<void>}
 */
function whenVisiblePicturesReady() {
  const vh = window.innerHeight;
  const imgs = Array.from(screenEl.querySelectorAll("img")).filter(
    (img) => img.getBoundingClientRect().top < vh,
  );
  const ready = Promise.all(imgs.map((img) => img.decode().catch(() => {})));
  return Promise.race([
    ready,
    new Promise((resolve) => setTimeout(resolve, 150)),
  ]);
}

subscribe(renderApp);
startRouter((route) => {
  // Every route change zooms+fades like the Feed/List toggle does (ADR-0012,
  // §"the group is here too") — a tab-bar swap, opening or closing the
  // Reader, closing the Story player, all the same transition. Opening the
  // Story is the one exception: it grows out of the ring that was tapped
  // (`growFrom` in views/story.js), and a root-level zoom on top of that
  // would fight the very rect it is growing from rather than complement it.
  const isStoryOpen = route.name === "story";
  const isBackToToday = route.name === "today" && state.route.name === "reader";
  if (route.name !== state.route.name && !isStoryOpen) {
    withViewTransition(async () => {
      update({ route });
      if (isBackToToday) await whenVisiblePicturesReady();
    });
  } else {
    update({ route });
  }
});

window.addEventListener("online", () => update({ online: true }));
window.addEventListener("offline", () => update({ online: false }));
lightQuery.addEventListener("change", () => {
  if (state.theme === "system") update();
});

// Sync wiring lives at boot, not in a view: the last-Sync time and the
// "refresh if stale" rule are app-level, and Today (which mounts after this)
// must not be the only screen that starts them. initSyncClient() restores
// lastSyncAt from the database and listens for the service worker's
// periodic-sync wake-up; syncIfStale() refreshes when the last Sync is older
// than fifteen minutes. Both no-op with no Enabled Publications, and a
// rejection here must never brick the boot the watchdog is about to bless.
initSyncClient();
syncIfStale().catch((error) => {
  console.warn("Startup sync skipped:", error);
});

// Safe updates (ADR-0008): watch for a waiting service worker so the reader is
// asked before a new Shell takes over, and compare this Shell's APP_VERSION
// with the one stamped in the database so a stale Shell reloads itself once.
// Both are opportunistic and never throw into the boot path.
initUpdates();

// Signal a healthy boot to the self-heal watchdog in index.html: if the module
// graph linked and this startup ran, we are not in the bricked-Shell state the
// watchdog guards against.
window.__edicolaBooted = true;
