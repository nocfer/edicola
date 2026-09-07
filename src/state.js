// The single app store (CLAUDE.md "Single store, one subscriber").
//
// `state` is one mutable object. Readers import it and read fields directly;
// writers go through `update(patch)`, which merges the patch and notifies every
// subscriber, so a redraw is a consequence of the write and never a separate
// call to remember. `render` (in main.js) is the sole subscriber. A bare
// `update()` notifies without changing a field, for when something nested was
// mutated in place and the view just needs to redraw.
//
// Side effects of a state change (persisting the theme, flipping <html lang>,
// re-translating static copy) live in main.js's render, not here and not in the
// views: a view that wants the theme to change calls `update({ theme })`.
//
// This module never touches `document`, `localStorage` or `navigator` at import
// time, so tests can import it under Node. main.js seeds the browser-derived
// fields (theme, lang, online) at boot.

/** @typedef {import('./router.js').Route} Route */
/** @typedef {'system'|'light'|'dark'} ThemePreference */
/** @typedef {'en'|'it'} Lang */

/**
 * What a Sync is doing, published by `sync-client.js` (never written by a
 * view). `phase`, `done` and `total` are only meaningful while `running`.
 *
 * @typedef {object} SyncState
 * @property {boolean} running  a Sync is in flight
 * @property {'feeds'|'articles'|null} phase  which half of the pipeline
 * @property {number} done   units finished in this phase
 * @property {number} total  units in this phase
 * @property {number|null} lastSyncAt  epoch ms of the last completed Sync
 * @property {import('./sync.js').SyncSummary|null} lastSummary  what it did
 */

/**
 * @typedef {object} State
 * @property {Route} route   the current screen, kept in sync by the router
 * @property {ThemePreference} theme  the reader's preference, not the resolved theme
 * @property {Lang} lang     the UI Language (ADR-0006)
 * @property {boolean} online  mirrors `navigator.onLine`
 * @property {string|null} toast  transient message shown by the `.toast` primitive
 * @property {SyncState} sync  progress and result of the last Sync
 */

/** @type {State} */
export const state = {
  route: { name: "today", params: {}, path: "/" },
  theme: "system",
  lang: "en",
  online: true,
  toast: null,
  sync: {
    running: false,
    phase: null,
    done: 0,
    total: 0,
    lastSyncAt: null,
    lastSummary: null,
  },
};

/** @type {Array<() => void>} */
const listeners = [];

/**
 * Merge `patch` into `state` (if given) and notify every subscriber.
 * @param {Partial<State>} [patch]
 */
export function update(patch) {
  if (patch) Object.assign(state, patch);
  for (const fn of listeners.slice()) fn();
}

/**
 * Register a reaction to state changes; returns an unsubscribe function.
 * @param {() => void} fn
 */
export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  };
}

let toastTimer;

/**
 * Show a transient message in the `.toast` primitive, replacing any current
 * one, and clear it after `duration` ms.
 * @param {string} message  already localized
 * @param {number} [duration]
 */
export function showToast(message, duration = 2500) {
  clearTimeout(toastTimer);
  update({ toast: message });
  toastTimer = setTimeout(() => {
    if (state.toast === message) update({ toast: null });
  }, duration);
}
