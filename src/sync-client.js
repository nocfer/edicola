// The page's side of Sync: wires the pure pipeline in `sync.js` to the real
// database, the real fetcher and the real DOM, guards against two runs at once,
// publishes progress into the store, asks for persistent storage and registers
// Periodic Background Sync where the browser has it.
//
// `sync.js` knows none of this — it takes every dependency as a parameter. This
// module is the only place where those parameters are the browser's own.

import { META_KEYS } from "./db.js";
import {
  extractArticleInBrowser,
  sanitizeSummaryInBrowser,
} from "./extract.js";
import { parseFeed } from "./feed.js";
import { createFetcher } from "./fetcher.js";
import { state, update } from "./state.js";
import { getSyncStore } from "./store.js";
import { runSync } from "./sync.js";

/** Sync on open when the last one is older than this (spec: 15 minutes). */
export const DEFAULT_STALE_MS = 15 * 60 * 1000;

/** Periodic Background Sync tag registered with the service worker. */
export const PERIODIC_SYNC_TAG = "edicola-sync";

/** Shortest interval we ask the browser for; it throttles as it pleases. */
export const PERIODIC_SYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * `type` of the message the service worker posts to open clients when its
 * `periodicsync` event fires. A worker cannot write to IndexedDB through the
 * pipeline (no `DOMParser`, no DOMPurify — ADR-0007), so all it can do is wake
 * a page that is open; `startSyncMessageListener` answers with `syncIfStale`.
 */
export const PERIODIC_SYNC_MESSAGE = "periodic-sync";

/** @typedef {import('./sync.js').SyncSummary} SyncSummary */
/** @typedef {import('./store.js').SyncStore} SyncStore */

/** The in-flight run, so a second "Sync now" joins it instead of racing it. */
/** @type {Promise<SyncSummary> | null} */
let inFlight = null;

/**
 * Merge a patch into `state.sync` and redraw.
 * @param {Partial<import('./state.js').SyncState>} patch
 */
function publish(patch) {
  update({ sync: { ...state.sync, ...patch } });
}

/**
 * The fetcher the page uses: the browser's `fetch`, the default Proxy and
 * `navigator.onLine` as the offline tiebreaker (ADR-0001). Ticket 12 will pass
 * the reader's own Proxy template from the `settings` table.
 * @returns {import('./fetcher.js').Fetcher}
 */
function pageFetcher() {
  return createFetcher({
    fetch: (input, init) => globalThis.fetch(input, init),
    onLine: () => navigator.onLine,
  });
}

/**
 * Run one Sync now, or join the one already running.
 * @param {{ publicationIds?: string[] }} [options]
 * @returns {Promise<SyncSummary>}
 */
export function syncNow({ publicationIds } = {}) {
  if (inFlight) return inFlight;
  const store = getSyncStore();
  inFlight = (async () => {
    publish({ running: true, phase: "feeds", done: 0, total: 0 });
    await requestPersistentStorage(store);
    try {
      const summary = await runSync({
        store,
        fetcher: pageFetcher(),
        parseFeed,
        extractArticle: extractArticleInBrowser,
        sanitizeSummary: sanitizeSummaryInBrowser,
        DOMParser,
        publicationIds: publicationIds ?? null,
        onProgress: ({ phase, done, total }) => publish({ phase, done, total }),
      });
      publish({
        running: false,
        phase: null,
        done: 0,
        total: 0,
        lastSyncAt: Number(await store.getMeta(META_KEYS.lastSyncAt)) || null,
        lastSummary: summary,
      });
      return summary;
    } catch (error) {
      publish({ running: false, phase: null, done: 0, total: 0 });
      throw error;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Sync only if the last one is older than `maxAgeMs`. Resolves with null when
 * the content is fresh enough to leave alone.
 * @param {number} [maxAgeMs]
 * @returns {Promise<SyncSummary | null>}
 */
export async function syncIfStale(maxAgeMs = DEFAULT_STALE_MS) {
  const last = Number(await getSyncStore().getMeta(META_KEYS.lastSyncAt));
  if (Number.isFinite(last) && Date.now() - last < maxAgeMs) return null;
  return await syncNow();
}

/**
 * Ask the browser to keep the database (ADR-0003): without this it may evict
 * IndexedDB under pressure and silently break offline reading. The answer is
 * recorded in `meta` so Settings (ticket 12) can show it. We stop asking once
 * it is granted, but do ask again after a refusal: browsers grant persistence
 * as a site earns engagement.
 * @param {SyncStore} [store]
 * @returns {Promise<boolean | 'unsupported'>}
 */
export async function requestPersistentStorage(store = getSyncStore()) {
  const recorded = await store.getMeta(META_KEYS.persistentStorage);
  if (recorded === true) return true;
  /** @type {boolean | 'unsupported'} */
  let result = "unsupported";
  try {
    if (typeof navigator.storage?.persist === "function") {
      result = await navigator.storage.persist();
    }
  } catch {
    result = false;
  }
  await store.setMeta(META_KEYS.persistentStorage, result);
  return result;
}

/**
 * Register Periodic Background Sync when the browser supports it and the
 * permission is already granted (ADR-0007: an enhancement, never relied upon).
 * Resolves with whether the registration happened.
 * @param {number} [minInterval]
 * @returns {Promise<boolean>}
 */
export async function registerPeriodicSync(
  minInterval = PERIODIC_SYNC_MIN_INTERVAL_MS,
) {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const registration = /** @type {any} */ (
      await navigator.serviceWorker.ready
    );
    if (!registration.periodicSync) return false;
    const status = await navigator.permissions.query(
      /** @type {any} */ ({ name: "periodic-background-sync" }),
    );
    if (status.state !== "granted") return false;
    await registration.periodicSync.register(PERIODIC_SYNC_TAG, {
      minInterval,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Listen for the service worker's `periodic-sync` message and Sync if the
 * content is stale. Returns an unsubscribe function.
 * @returns {() => void}
 */
export function startSyncMessageListener() {
  if (!("serviceWorker" in navigator)) return () => {};
  /** @param {MessageEvent} event */
  const onMessage = (event) => {
    if (event.data?.type !== PERIODIC_SYNC_MESSAGE) return;
    void syncIfStale().catch(() => {});
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () =>
    navigator.serviceWorker.removeEventListener("message", onMessage);
}

let initialized = false;

/**
 * Bring `state.sync` in step with the database and start the opportunistic
 * pieces. Idempotent, so any screen may call it on render; ticket 09 should
 * call it (and `syncIfStale`) once at boot from `main.js`.
 * @returns {void}
 */
export function initSyncClient() {
  if (initialized) return;
  initialized = true;
  startSyncMessageListener();
  void registerPeriodicSync();
  void getSyncStore()
    .getMeta(META_KEYS.lastSyncAt)
    .then((value) => {
      const at = Number(value);
      if (Number.isFinite(at) && at > 0) publish({ lastSyncAt: at });
    })
    .catch(() => {});
}
