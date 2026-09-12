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

// The CDP session itself lives in tools/testing/cdp.js, shared with
// tools/qa-run.mjs. Keep the plumbing there: two copies of a WebSocket
// protocol client drift, and the second one is always the stale one.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_CHROME, launch, sleep } from "./testing/cdp.js";

/** Parse `<url> <out> [--flag value]...` into an options object. */
function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      theme: { type: "string" },
      lang: { type: "string" },
      viewmode: { type: "string" },
      offline: { type: "boolean", default: false },
      width: { type: "string", default: "390" },
      height: { type: "string", default: "844" },
      scale: { type: "string", default: "2" },
      wait: { type: "string", default: "1200" },
      profile: { type: "string" },
      eval: { type: "string" },
      chrome: { type: "string", default: DEFAULT_CHROME },
    },
  });
  const [url, out] = positionals;
  if (!url || !out) {
    throw new Error(
      "Usage: node tools/screenshot.mjs <url> <out.png> [options]",
    );
  }
  if (values.theme && !["light", "dark"].includes(values.theme))
    throw new Error("--theme must be light or dark");
  if (values.lang && !["en", "it"].includes(values.lang))
    throw new Error("--lang must be en or it");
  if (values.viewmode && !["list", "feed"].includes(values.viewmode))
    throw new Error("--viewmode must be list or feed");
  return {
    ...values,
    url,
    out,
    width: Number(values.width),
    height: Number(values.height),
    scale: Number(values.scale),
    wait: Number(values.wait),
  };
}

async function main() {
  const opts = parseOptions(process.argv.slice(2));
  let failed = false;
  /** @type {Awaited<ReturnType<typeof launch>> | null} */
  let browser = null;
  try {
    browser = await launch({
      profile: opts.profile,
      width: opts.width,
      height: opts.height,
      scale: opts.scale,
      chrome: opts.chrome,
    });
    const { cdp, errors } = browser;

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
  } catch (err) {
    failed = true;
    console.error(`screenshot failed: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main();
