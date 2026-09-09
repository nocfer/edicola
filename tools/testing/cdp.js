// Headless Chrome over the DevTools Protocol, with no browser driver and no
// dependency: Node's global WebSocket and fetch are enough (CLAUDE.md gotcha
// 2). Extracted from tools/screenshot.mjs when tools/qa-run.mjs needed the
// same session for a different reason.
//
// screenshot.mjs launches a browser, takes one picture and exits. A QA run
// walks thirty Publications in one profile, and relaunching Chrome per step
// would throw away the IndexedDB warm-up and thirty seconds of startup each
// time. So the session is the unit here: `launch()` gives back a live `cdp`
// handle plus `close()`, and the caller decides how many pages to drive.
//
// Lives under tools/ (not test/) for the same reason as testing/dom.js: so
// `node --test` does not try to run it as a test file. Named exports only,
// like every module in this repo.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Chrome binary: `$CHROME`, or the macOS default. */
export const DEFAULT_CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for Chrome to write `DevToolsActivePort` into the profile; return the port.
 * @param {string} profile
 * @param {number} [timeoutMs]
 * @returns {Promise<number>}
 */
export async function waitForPort(profile, timeoutMs = 15000) {
  const file = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, "utf8").split("\n")[0]);
      if (port) return port;
    }
    await sleep(100);
  }
  throw new Error("Chrome did not expose a DevTools port in time");
}

/**
 * One CDP session over one WebSocket.
 * @typedef {object} CdpSession
 * @property {Promise<void>} ready Resolves when the socket is open.
 * @property {(method: string, params?: object) => Promise<any>} send
 * @property {(method: string, fn: (params: any) => void) => void} on
 * @property {(method: string, timeoutMs: number) => Promise<any>} once
 * @property {() => void} close
 */

/**
 * Connect to a target's WebSocket debugger URL.
 * @param {string} wsUrl
 * @returns {CdpSession}
 */
export function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
  const pending = new Map();
  /** @type {Map<string, ((params: any) => void)[]>} */
  const listeners = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`${msg.error.message}`));
      else entry.resolve(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });
  const open = new Promise((ok, reject) => {
    ws.addEventListener("open", () => ok(undefined), { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket error")), {
      once: true,
    });
  });
  return {
    ready: /** @type {Promise<void>} */ (open),
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((ok, reject) => {
        pending.set(id, { resolve: ok, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    },
    once(method, timeoutMs) {
      return new Promise((ok, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${method}`)),
          timeoutMs,
        );
        this.on(method, (params) => {
          clearTimeout(timer);
          ok(params);
        });
      });
    },
    close() {
      ws.close();
    },
  };
}

/**
 * A launched browser and the session driving its one page.
 * @typedef {object} Browser
 * @property {CdpSession} cdp
 * @property {string} profile Absolute path to the profile directory.
 * @property {string[]} errors Console errors and uncaught exceptions, appended
 *   as they arrive. Callers snapshot and splice it per step.
 * @property {() => Promise<void>} close Kills Chrome; removes a throwaway profile.
 */

/**
 * @typedef {object} LaunchOptions
 * @property {string} [profile] Reuse this profile instead of a throwaway one.
 *   A QA run needs one: IndexedDB is where every answer lives.
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [scale] deviceScaleFactor.
 * @property {string} [chrome] Chrome binary.
 * @property {string[]} [args] Extra Chrome flags.
 */

/**
 * Launch headless Chrome, open one page target and enable the domains every
 * caller here needs (Page, Runtime, Log) plus the device metrics override.
 * Console errors land in `errors` from the moment the session opens.
 * @param {LaunchOptions} [options]
 * @returns {Promise<Browser>}
 */
export async function launch({
  profile: profileOption,
  width = 390,
  height = 844,
  scale = 2,
  chrome: chromePath = DEFAULT_CHROME,
  args = [],
} = {}) {
  const throwaway = !profileOption;
  const profile = profileOption
    ? resolve(profileOption)
    : mkdtempSync(join(tmpdir(), "edicola-cdp-"));
  mkdirSync(profile, { recursive: true });
  // Chrome rewrites this on start; a stale one would fool waitForPort.
  rmSync(join(profile, "DevToolsActivePort"), { force: true });

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      ...args,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const exited = new Promise((ok) => chrome.once("exit", ok));

  const port = await waitForPort(profile);
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: "PUT",
    })
  ).json();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  /** @type {string[]} */
  const errors = [];
  cdp.on("Runtime.exceptionThrown", (p) =>
    errors.push(
      `exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`,
    ),
  );
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error" || p.type === "warning") {
      errors.push(
        `console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(" ")}`,
      );
    }
  });
  cdp.on("Log.entryAdded", (p) => {
    if (p.entry.level === "error") {
      errors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ""}`);
    }
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: true,
  });

  return {
    cdp,
    profile,
    errors,
    async close() {
      cdp.close();
      chrome.kill();
      await exited;
      if (throwaway) rmSync(profile, { recursive: true, force: true });
    },
  };
}

/**
 * Evaluate an expression in the page, awaiting a promise and returning the
 * value by JSON round-trip. Rejects with the page's own error message rather
 * than a CDP wrapper, so a failing step reads like a failing step.
 * @param {CdpSession} cdp
 * @param {string} expression
 * @returns {Promise<any>}
 */
export async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `Promise.resolve((async () => { ${expression} })()).then((v) => JSON.stringify(v ?? null))`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    throw new Error(
      details.exception?.description || details.text || "evaluate failed",
    );
  }
  return JSON.parse(result.result.value);
}

/**
 * Reload and wait for the load event. Use this, not `goto`, whenever the URL
 * would differ only in its hash: that is a same-document navigation and no
 * load event ever arrives, so a `goto` there waits until it times out.
 * @param {CdpSession} cdp
 * @param {number} [waitMs]
 */
export async function reload(cdp, waitMs = 1500) {
  const loaded = cdp.once("Page.loadEventFired", 30000);
  await cdp.send("Page.reload", { ignoreCache: false });
  await loaded;
  await sleep(waitMs);
}

/**
 * Navigate and wait for the load event, then settle for `waitMs` so the ES
 * modules and the first lit render are done.
 * @param {CdpSession} cdp
 * @param {string} url
 * @param {number} [waitMs]
 */
export async function goto(cdp, url, waitMs = 1500) {
  const loaded = cdp.once("Page.loadEventFired", 30000);
  const nav = await cdp.send("Page.navigate", { url });
  if (nav.errorText) throw new Error(`Navigation failed: ${nav.errorText}`);
  await loaded;
  await sleep(waitMs);
}
