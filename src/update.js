// Safe updates (ADR-0008): a new Shell is announced, never applied silently,
// and a Shell older than the database gets out of the way instead of running
// old code against newer data.
//
// Two halves:
//
// 1. **The update prompt.** `sw.js` no longer calls `skipWaiting()` on install,
//    so a new worker sits in `registration.waiting` until the reader says yes.
//    `initUpdates()` notices it and sets `state.appUpdate.available`; main.js
//    renders the prompt; `applyUpdate()` posts `{ type: 'skip-waiting' }` to the
//    waiting worker and reloads on `controllerchange`, so every tab lands on the
//    same version. The failure this prevents is a half-swapped Shell reading a
//    reader's Saved Articles with the wrong code.
//
// 2. **The version guard.** `db.js` stamps `APP_VERSION` into `meta.appVersion`
//    when the database opens, and hands back what was there *before* the stamp.
//    If that is newer than the Shell now running, this Shell is stale — a
//    cached module, a worker that never activated — and one reload picks up the
//    newer one. A sessionStorage guard makes it exactly one reload, never a
//    loop, and nothing is unregistered: the self-heal watchdog in index.html
//    owns that heavier hammer.
//
// Everything here takes its dependencies as parameters and imports only
// `state.js`, so the comparison and guard logic are unit-tested under Node
// (test/settings.test.js). `db.js` is reached through a lazy dynamic import so
// this module never pulls the Dexie CDN bundle into Node.

import { state, update } from "./state.js";

/**
 * `type` of the message the page posts to a waiting worker to make it activate.
 * `sw.js` matches this string literally in its existing `message` handler.
 */
export const SKIP_WAITING_MESSAGE = "skip-waiting";

/** sessionStorage key that makes the version-guard reload happen once. */
export const RELOAD_GUARD_KEY = "edicola.versionReload";

/** How long to wait for `controllerchange` before reloading anyway. */
const CONTROLLER_CHANGE_TIMEOUT_MS = 4000;

/**
 * Compare two dotted version strings numerically, segment by segment: -1 when
 * `a` is older, 1 when it is newer, 0 when they are equal. A missing segment
 * counts as 0 ("1.2" equals "1.2.0") and a non-numeric segment counts as 0 too,
 * so a hand-edited or pre-release value can never look newer than it is.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {-1 | 0 | 1}
 */
export function compareAppVersions(a, b) {
  const left = String(a ?? "").split(".");
  const right = String(b ?? "").split(".");
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = Number.parseInt(left[i] ?? "0", 10) || 0;
    const y = Number.parseInt(right[i] ?? "0", 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether the running Shell should reload to pick up a newer one: only when the
 * database was written by a strictly newer version and this session has not
 * reloaded for that reason already.
 * @param {object} input
 * @param {string} input.running The `APP_VERSION` of the Shell now executing.
 * @param {string | null | undefined} input.stored `meta.appVersion` before this
 *   boot stamped it; null on a first run.
 * @param {boolean} input.alreadyReloaded The sessionStorage guard is set.
 * @returns {boolean}
 */
export function shouldReloadForVersion({ running, stored, alreadyReloaded }) {
  if (alreadyReloaded) return false;
  if (!stored) return false;
  return compareAppVersions(running, stored) < 0;
}

/**
 * Apply the version guard. Resolves with whether a reload was triggered.
 * Every dependency is a parameter, so the decision is testable without a
 * browser: pass a fake `session` and a `reload` spy.
 *
 * @param {object} input
 * @param {string} input.runningVersion
 * @param {string | null | undefined} input.storedVersion
 * @param {Storage | null} [input.session]
 * @param {() => void} [input.reload]
 * @returns {boolean}
 */
export function runVersionGuard({
  runningVersion,
  storedVersion,
  session = globalThis.sessionStorage,
  reload = () => globalThis.location.reload(),
}) {
  let alreadyReloaded = false;
  try {
    alreadyReloaded = session?.getItem(RELOAD_GUARD_KEY) === "1";
  } catch {
    // No sessionStorage (private mode, storage disabled): treat the guard as
    // unset but do not reload without being able to set it, or a broken
    // storage becomes a reload loop.
    return false;
  }
  if (
    !shouldReloadForVersion({
      running: runningVersion,
      stored: storedVersion,
      alreadyReloaded,
    })
  )
    return false;
  try {
    session?.setItem(RELOAD_GUARD_KEY, "1");
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * Publish a patch into `state.appUpdate` and redraw.
 * @param {Partial<import('./state.js').UpdateState>} patch
 */
function publish(patch) {
  update({ appUpdate: { ...state.appUpdate, ...patch } });
}

/**
 * Announce a waiting worker whenever one appears: now, if it is already there,
 * and on every future install that finishes while this page is open.
 *
 * @param {object} input
 * @param {any} input.registration A `ServiceWorkerRegistration`.
 * @param {() => void} input.onWaiting
 * @returns {void}
 */
function watchForWaitingWorker({ registration, onWaiting }) {
  if (registration.waiting && registration.active) onWaiting();

  /** @param {any} worker */
  const watchInstalling = (worker) => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && registration.active) onWaiting();
    });
  };

  watchInstalling(registration.installing);
  registration.addEventListener("updatefound", () => {
    watchInstalling(registration.installing);
  });
}

/**
 * Tell the waiting worker to activate and reload once it has taken over, so
 * every tab lands on the same version. Resolves with whether a waiting worker
 * was found; with none (the reader confirmed a prompt that has gone stale) it
 * reloads anyway, which is the honest outcome of "give me the new version".
 *
 * @param {object} [deps]
 * @param {any} [deps.container] `navigator.serviceWorker`.
 * @param {() => void} [deps.reload]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function applyUpdate(deps = {}) {
  const {
    container = globalThis.navigator?.serviceWorker,
    reload = () => globalThis.location.reload(),
    timeoutMs = CONTROLLER_CHANGE_TIMEOUT_MS,
  } = deps;
  publish({ applying: true });
  if (!container) {
    reload();
    return false;
  }
  const registration = await container.getRegistration();
  const waiting = registration?.waiting;
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    reload();
  };
  if (!waiting) {
    once();
    return false;
  }
  container.addEventListener("controllerchange", once, { once: true });
  // The worker may activate without a controllerchange reaching this page
  // (it was never controlled, or the event was missed). Reload regardless.
  setTimeout(once, timeoutMs);
  waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
  return true;
}

/** Hide the prompt for this session without applying the update. */
export function dismissUpdate() {
  publish({ available: false });
}

let initialized = false;

/**
 * Wire both halves at boot. Idempotent. Never throws: a browser without service
 * workers, or a database that will not open, must not stop the app from
 * rendering — the whole point of ADR-0008 is that updating is the safe path.
 * @returns {void}
 */
export function initUpdates() {
  if (initialized) return;
  initialized = true;

  void (async () => {
    try {
      const { APP_VERSION, readVersionsBeforeStamp } = await import("./db.js");
      const previous = await readVersionsBeforeStamp();
      runVersionGuard({
        runningVersion: APP_VERSION,
        storedVersion: previous.appVersion,
      });
    } catch (error) {
      console.warn("Version guard skipped:", error);
    }
  })();

  const container = globalThis.navigator?.serviceWorker;
  if (!container) return;

  void container.ready
    .then((registration) => {
      watchForWaitingWorker({
        registration,
        onWaiting: () => publish({ available: true }),
      });
      // Re-check on every return to the tab: a reader who leaves Edicola open
      // for days would otherwise never see a version shipped in between.
      globalThis.document?.addEventListener("visibilitychange", () => {
        if (globalThis.document.visibilityState !== "visible") return;
        void registration.update().catch(() => {});
      });
    })
    .catch(() => {});
}
