#!/usr/bin/env node
// Screenshot a page in headless Chrome over the DevTools Protocol. No browser
// driver, no dependency: Node 22's global WebSocket and fetch are enough.
//
// Usage:
//   node tools/screenshot.mjs <url> <out.png> [options]
//
//   --theme light|dark   force the theme: seeds `edicola.theme` in localStorage
//                        and emulates prefers-color-scheme (default: system)
//   --lang en|it         force the Language: seeds `edicola.lang` (default: browser)
//   --viewmode list|feed force Today's View Mode: seeds `edicola.viewmode`
//   --offline            cut the network before navigating, so `navigator.onLine`
//                        is false and nothing loads that is not already stored.
//                        Needs a primed --profile: the Shell comes from the
//                        service worker cache and the Items from IndexedDB.
//   --width 390          viewport width in CSS px  (default 390)
//   --height 844         viewport height in CSS px (default 844)
//   --scale 2            deviceScaleFactor (default 2)
//   --wait 1200          ms to wait after `load` for modules + lit render
//   --profile <dir>      reuse this Chrome profile instead of a throwaway one
//                        (needed to test offline: load once, stop the server,
//                        run again with the same --profile)
//   --eval "<js>"        evaluate an expression after load (awaited) and print
//                        its JSON to stderr; e.g. "caches.keys()"
//   --chrome <path>      Chrome binary (default: macOS Google Chrome, or $CHROME)
//
// Examples:
//   node tools/screenshot.mjs http://localhost:8000/#/settings shots/settings-dark-it.png --theme dark --lang it
//   node tools/screenshot.mjs http://localhost:8000/ shots/today.png --profile /tmp/edicola-prof --wait 4000
//
// The script prints a one-line JSON summary (title, booted flag, theme, lang,
// hash) and any console errors or uncaught exceptions to stderr, and exits 1
// on a failed navigation. Screenshots use a fixed viewport with
// captureBeyondViewport:false so position:fixed chrome composes correctly.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Parse `<url> <out> [--flag value]...` into an options object. */
function parseArgs(argv) {
  const opts = {
    url: null,
    out: null,
    theme: null,
    lang: null,
    viewmode: null,
    offline: false,
    width: 390,
    height: 844,
    scale: 2,
    wait: 1200,
    profile: null,
    eval: null,
    chrome: DEFAULT_CHROME,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (!(key in opts)) throw new Error(`Unknown option ${a}`);
      if (key === "offline") {
        opts.offline = true;
        continue;
      }
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      opts[key] = ["width", "height", "scale", "wait"].includes(key)
        ? Number(v)
        : v;
    } else positional.push(a);
  }
  [opts.url, opts.out] = positional;
  if (!opts.url || !opts.out) {
    throw new Error(
      "Usage: node tools/screenshot.mjs <url> <out.png> [options]",
    );
  }
  if (opts.theme && !["light", "dark"].includes(opts.theme))
    throw new Error("--theme must be light or dark");
  if (opts.lang && !["en", "it"].includes(opts.lang))
    throw new Error("--lang must be en or it");
  if (opts.viewmode && !["list", "feed"].includes(opts.viewmode))
    throw new Error("--viewmode must be list or feed");
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for Chrome to write DevToolsActivePort in the profile dir; return the port. */
async function waitForPort(profile, timeoutMs = 15000) {
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

/** Minimal CDP session over one WebSocket: `send(method, params)` + events. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else ok(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });
  const open = new Promise((ok, reject) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket error")), {
      once: true,
    });
  });
  return {
    ready: open,
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const throwaway = !opts.profile;
  const profile = opts.profile
    ? resolve(opts.profile)
    : mkdtempSync(join(tmpdir(), "edicola-shot-"));
  mkdirSync(profile, { recursive: true });
  // Chrome rewrites this on start; a stale one from a previous run would fool us.
  rmSync(join(profile, "DevToolsActivePort"), { force: true });

  const chrome = spawn(
    opts.chrome,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--window-size=${opts.width},${opts.height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const exited = new Promise((ok) => chrome.once("exit", ok));

  let failed = false;
  try {
    const port = await waitForPort(profile);
    const target = await (
      await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
        method: "PUT",
      })
    ).json();
    const cdp = connect(target.webSocketDebuggerUrl);
    await cdp.ready;

    const errors = [];
    cdp.on("Runtime.exceptionThrown", (p) =>
      errors.push(
        `exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`,
      ),
    );
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error" || p.type === "warning")
        errors.push(
          `console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(" ")}`,
        );
    });
    cdp.on("Log.entryAdded", (p) => {
      if (p.entry.level === "error")
        errors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ""}`);
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: opts.scale,
      mobile: true,
    });
    // Theme BEFORE navigate, so the pre-paint script sees it.
    if (opts.theme) {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: opts.theme }],
      });
    }
    // Offline BEFORE navigate too: a page that has already loaded its modules
    // over the network is not the offline case anyone is trying to see.
    if (opts.offline) {
      await cdp.send("Network.enable");
      // The HTTP cache has to go too, or a picture fetched on the previous run
      // is served from it and the offline feed looks online.
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.clearBrowserCache");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
    }
    const seed = [];
    if (opts.theme)
      seed.push(
        `localStorage.setItem('edicola.theme', ${JSON.stringify(opts.theme)})`,
      );
    if (opts.lang)
      seed.push(
        `localStorage.setItem('edicola.lang', ${JSON.stringify(opts.lang)})`,
      );
    if (opts.viewmode) {
      seed.push(
        `localStorage.setItem('edicola.viewmode', ${JSON.stringify(opts.viewmode)})`,
      );
    }
    if (seed.length) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `try { ${seed.join("; ")} } catch (e) {}`,
      });
    }

    const loaded = cdp.once("Page.loadEventFired", 30000);
    const nav = await cdp.send("Page.navigate", { url: opts.url });
    if (nav.errorText) throw new Error(`Navigation failed: ${nav.errorText}`);
    await loaded;
    await sleep(opts.wait);

    const summary = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        title: document.title,
        booted: !!window.__edicolaBooted,
        theme: document.documentElement.dataset.theme,
        lang: document.documentElement.lang,
        hash: location.hash,
        online: navigator.onLine,
        controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      })`,
      returnByValue: true,
    });
    console.error(summary.result.value);

    if (opts.eval) {
      const res = await cdp.send("Runtime.evaluate", {
        expression: `Promise.resolve(${opts.eval}).then((v) => JSON.stringify(v))`,
        awaitPromise: true,
        returnByValue: true,
      });
      console.error(`eval: ${res.result.value ?? res.result.description}`);
    }

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    mkdirSync(dirname(resolve(opts.out)), { recursive: true });
    writeFileSync(resolve(opts.out), Buffer.from(shot.data, "base64"));
    console.error(`wrote ${opts.out}`);

    for (const e of errors) console.error(`  ! ${e}`);
    cdp.close();
  } catch (err) {
    failed = true;
    console.error(`screenshot failed: ${err.message}`);
  } finally {
    chrome.kill();
    await exited;
    if (throwaway) rmSync(profile, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
