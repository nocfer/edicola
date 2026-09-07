// Entry module: boots the store, the router and the single render subscriber.
//
// Everything that redraws goes through `update()` in state.js; this file owns
// the one `render` that reacts to it, plus the side effects that belong with a
// state change (persisting the theme preference, flipping <html lang>,
// re-translating the static copy in index.html, showing/hiding the tab bar).
// Views never touch the DOM outside their template; they call `update()`.

import { html, nothing, render } from "./render.js";
import { state, subscribe, update } from "./state.js";
import { applyStaticI18n, getLang, initLang, setLang } from "./i18n.js";
import { hidesTabBar, startRouter } from "./router.js";
import { todayView } from "./views/today.js";
import { savedView } from "./views/saved.js";
import { publicationsView } from "./views/publications.js";
import { settingsView } from "./views/settings.js";
import { readerView } from "./views/reader.js";
import { notFoundView } from "./views/not-found.js";

/** localStorage key shared with the pre-paint script in index.html. */
const THEME_KEY = "edicola.theme";

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

/** The store's sole subscriber: every `update()` redraws through here. */
function renderApp() {
  applyTheme(state.theme);
  applyLang(state.lang);
  const view = SCREENS[state.route.name] || notFoundView;
  render(
    html`${view(state)}${
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
state.online = navigator.onLine;

subscribe(renderApp);
startRouter((route) => update({ route }));

window.addEventListener("online", () => update({ online: true }));
window.addEventListener("offline", () => update({ online: false }));
lightQuery.addEventListener("change", () => {
  if (state.theme === "system") update();
});

// Signal a healthy boot to the self-heal watchdog in index.html: if the module
// graph linked and this startup ran, we are not in the bricked-Shell state the
// watchdog guards against.
window.__edicolaBooted = true;
