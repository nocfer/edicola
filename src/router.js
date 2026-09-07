// Hash router. Five screens (CLAUDE.md "Routing is hash-based"):
//
//   #/                 Today
//   #/saved            Saved
//   #/publications     Publications
//   #/item/:id         Reader (full-screen push: hides the tab bar)
//   #/settings         Settings
//
// `parseRoute` is pure so it can be unit tested in Node; everything that touches
// `location`/`history` is kept in the small functions below it. The router does
// not hold state: `startRouter` hands every change to a callback, and main.js
// puts the Route into the store with `update({ route })`.

/** @typedef {'today'|'saved'|'publications'|'settings'|'reader'|'not-found'} RouteName */

/**
 * @typedef {object} Route
 * @property {RouteName} name
 * @property {Record<string, string>} params  `{ id }` for the Reader, else `{}`
 * @property {string} path  normalized path after the `#`, e.g. `/saved`
 */

/** Screens reachable from the bottom tab bar, in display order. */
export const TABS = /** @type {const} */ ([
  "today",
  "saved",
  "publications",
  "settings",
]);

/** @type {Record<string, RouteName>} */
const STATIC_PATHS = {
  "/": "today",
  "/saved": "saved",
  "/publications": "publications",
  "/settings": "settings",
};

/**
 * Parse a location hash (with or without the leading `#`) into a Route.
 * Unknown paths yield `not-found` rather than throwing.
 * @param {string} hash  e.g. `#/item/abc`, `/settings`, `` (empty = Today)
 * @returns {Route}
 */
export function parseRoute(hash) {
  let path = String(hash || "").replace(/^#/, "");
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  const name = STATIC_PATHS[path];
  if (name) return { name, params: {}, path };
  const item = path.match(/^\/item\/([^/]+)$/);
  if (item) {
    let id = item[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the raw segment: a malformed escape is still a usable key.
    }
    return { name: "reader", params: { id }, path };
  }
  return { name: "not-found", params: {}, path };
}

/**
 * The path (after `#`) for a screen. The Reader needs `params.id`.
 * @param {RouteName} name
 * @param {Record<string, string>} [params]
 * @returns {string}
 */
export function pathFor(name, params = {}) {
  switch (name) {
    case "today":
      return "/";
    case "reader":
      return `/item/${encodeURIComponent(params.id ?? "")}`;
    case "not-found":
      return "/404";
    default:
      return `/${name}`;
  }
}

/**
 * An href suitable for `<a href>`: `#` plus `pathFor`.
 * @param {RouteName} name
 * @param {Record<string, string>} [params]
 * @returns {string}
 */
export function hrefFor(name, params = {}) {
  return `#${pathFor(name, params)}`;
}

/** Whether a Route belongs to a bottom tab (the Reader and 404 do not). */
export function isTabRoute(/** @type {Route} */ route) {
  return TABS.includes(/** @type {any} */ (route.name));
}

/** The Reader is a full-screen push: it hides the tab bar. */
export function hidesTabBar(/** @type {Route} */ route) {
  return route.name === "reader";
}

/** The Route for the current `location.hash`. */
export function currentRoute() {
  return parseRoute(typeof location === "undefined" ? "" : location.hash);
}

/**
 * Navigate by setting the hash; the `hashchange` listener does the rest.
 * @param {RouteName} name
 * @param {Record<string, string>} [params]
 */
export function navigate(name, params = {}) {
  location.hash = pathFor(name, params);
}

// Number of in-app hash navigations seen this session. `goBack` uses it to tell
// "the reader came from Today" (history.back is safe) from "the reader opened
// the app straight on #/item/x" (history.back would leave the app).
let depth = 0;
// Set by `goBack` so the `hashchange` it causes is not counted as a forward step.
let backPending = false;

/**
 * Leave the current screen: the previous in-app screen when there is one,
 * otherwise Today.
 */
export function goBack() {
  if (depth > 0) {
    depth -= 1;
    backPending = true;
    history.back();
  } else {
    navigate("today");
  }
}

/**
 * Start listening for hash changes. Calls `onChange` once immediately with the
 * current Route, then on every `hashchange`. Returns a stop function.
 * @param {(route: Route) => void} onChange
 */
export function startRouter(onChange) {
  const handler = () => {
    if (backPending) backPending = false;
    else depth += 1;
    onChange(currentRoute());
  };
  window.addEventListener("hashchange", handler);
  onChange(currentRoute());
  return () => window.removeEventListener("hashchange", handler);
}
