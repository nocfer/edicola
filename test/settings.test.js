// The pure halves of Settings: Retention defaults and bounds, Proxy template
// validation, the Proxy "Test" flow with an injected fetch, the typed layer
// over the `settings` table against a fake Dexie table, the storage
// measurement and byte formatting, and ADR-0008's version comparison and
// reload guard.
//
// Nothing here touches IndexedDB, the DOM or the network: every module under
// test takes its database, fetch or storage as a parameter, which is exactly
// what makes the highest seams of this screen assertable in Node.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_RETENTION } from "../src/retention.js";
import { DEFAULT_PROXY_TEMPLATE } from "../src/fetcher.js";
import {
  clampRetentionValue,
  createSettingsStore,
  DEFAULT_SETTINGS,
  effectiveProxyTemplate,
  EVICTING_FIELDS,
  MIB,
  normalizeNations,
  normalizeRetention,
  normalizeSettings,
  PROXY_PLACEHOLDER,
  retentionEquals,
  RETENTION_BOUNDS,
  RETENTION_FIELDS,
  retentionShrank,
  SETTINGS_KEYS,
  testProxyTemplate,
  usesDefaultProxy,
  validateProxyTemplate,
} from "../src/settings.js";
import {
  clearContent,
  countEnabledPublications,
  estimateValueBytes,
  formatBytes,
  PREFERENCE_KEYS,
  readStorageUsage,
  resetApp,
  STORAGE_TABLES,
} from "../src/storage-usage.js";
import {
  compareAppVersions,
  RELOAD_GUARD_KEY,
  runVersionGuard,
  SKIP_WAITING_MESSAGE,
} from "../src/update.js";

// --- Retention defaults and bounds ----------------------------------------

test("the defaults shown are DEFAULT_RETENTION, unchanged", () => {
  assert.equal(DEFAULT_SETTINGS.retention, DEFAULT_RETENTION);
  assert.deepEqual(
    DEFAULT_SETTINGS.nations,
    [],
    "no Nation is chosen until the reader chooses",
  );
  assert.deepEqual(normalizeRetention(null), { ...DEFAULT_RETENTION });
  assert.deepEqual(normalizeRetention(undefined), { ...DEFAULT_RETENTION });
  assert.deepEqual(normalizeRetention({}), { ...DEFAULT_RETENTION });
});

test("every Retention limit has bounds, and the default sits inside them", () => {
  assert.deepEqual(
    [...RETENTION_FIELDS].sort(),
    Object.keys(DEFAULT_RETENTION).sort(),
  );
  for (const field of RETENTION_FIELDS) {
    const bound = RETENTION_BOUNDS[field];
    assert.ok(bound, `no bounds for ${field}`);
    assert.ok(bound.min < bound.max, `${field} bounds are inverted`);
    const value = DEFAULT_RETENTION[field];
    assert.ok(
      value >= bound.min && value <= bound.max,
      `${field} default ${value} is outside [${bound.min}, ${bound.max}]`,
    );
  }
});

test("a value out of bounds is clamped, not rejected", () => {
  assert.equal(clampRetentionValue("maxAgeDays", 0), 1);
  assert.equal(clampRetentionValue("maxAgeDays", 10_000), 365);
  assert.equal(clampRetentionValue("keepPerPublication", 3), 10);
  assert.equal(clampRetentionValue("keepPerPublication", 99_999), 500);
  assert.equal(clampRetentionValue("prefetchPerPublication", -5), 0);
  assert.equal(clampRetentionValue("maxImageBytesPerArticle", 0), 0);
  assert.equal(clampRetentionValue("maxTotalBytes", 1), 50 * MIB);
});

test("a value that is not a finite number falls back to the default", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "abc",
    Number.NaN,
    Infinity,
    true,
    {},
  ]) {
    assert.equal(
      clampRetentionValue("maxAgeDays", bad),
      DEFAULT_RETENTION.maxAgeDays,
      `${String(bad)} should fall back`,
    );
  }
  assert.equal(clampRetentionValue("maxAgeDays", "45"), 45);
  assert.equal(clampRetentionValue("maxAgeDays", 45.6), 46);
});

test("normalizeRetention keeps every field and never mutates its input", () => {
  const input = { maxAgeDays: 7, keepPerPublication: 1 };
  const frozen = JSON.stringify(input);
  const out = normalizeRetention(input);
  assert.equal(JSON.stringify(input), frozen);
  assert.deepEqual(Object.keys(out).sort(), [...RETENTION_FIELDS].sort());
  assert.equal(out.maxAgeDays, 7);
  assert.equal(out.keepPerPublication, 10, "clamped to the minimum");
  assert.equal(out.maxTotalBytes, DEFAULT_RETENTION.maxTotalBytes);
});

test("retentionShrank only fires for limits that govern stored content", () => {
  const before = normalizeRetention(null);
  assert.equal(retentionShrank(before, before), false);
  assert.equal(
    retentionShrank(before, { ...before, maxAgeDays: 7 }),
    true,
    "fewer days kept must Evict",
  );
  assert.equal(
    retentionShrank(before, { ...before, maxTotalBytes: 50 * MIB }),
    true,
  );
  assert.equal(
    retentionShrank(before, { ...before, keepPerPublication: 10 }),
    true,
  );
  assert.equal(
    retentionShrank(before, { ...before, prefetchPerPublication: 1 }),
    false,
    "Pre-fetch only bounds the next Sync",
  );
  assert.equal(
    retentionShrank(before, { ...before, maxImageBytesPerArticle: 0 }),
    false,
    "the image cap is applied by Extraction, never retroactively",
  );
  assert.equal(
    retentionShrank(before, { ...before, maxAgeDays: 90 }),
    false,
    "growing a limit Evicts nothing",
  );
  assert.deepEqual(
    EVICTING_FIELDS.filter((f) => !RETENTION_FIELDS.includes(f)),
    [],
  );
});

test("retentionEquals compares every field", () => {
  const a = normalizeRetention(null);
  assert.equal(retentionEquals(a, { ...a }), true);
  assert.equal(
    retentionEquals(a, { ...a, maxAgeDays: a.maxAgeDays + 1 }),
    false,
  );
});

// --- Proxy template validation --------------------------------------------

test("an empty template is valid and means the default Proxy", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const check = validateProxyTemplate(empty);
    assert.equal(check.valid, true);
    assert.equal(check.usesDefault, true);
    assert.equal(check.problem, null);
    assert.equal(effectiveProxyTemplate(empty), DEFAULT_PROXY_TEMPLATE);
    assert.equal(usesDefaultProxy(empty), true);
  }
});

test("a template without {url} is rejected", () => {
  const check = validateProxyTemplate("https://relay.example/fetch");
  assert.equal(check.valid, false);
  assert.equal(check.problem, "missing-placeholder");
  assert.equal(PROXY_PLACEHOLDER, "{url}");
});

test("a template that is not an absolute URL is rejected", () => {
  assert.equal(validateProxyTemplate("/proxy?url={url}").problem, "malformed");
  assert.equal(
    validateProxyTemplate("relay.example/?url={url}").problem,
    "malformed",
  );
});

test("plain http is rejected except on localhost", () => {
  assert.equal(
    validateProxyTemplate("http://relay.example/?url={url}").problem,
    "insecure-scheme",
  );
  assert.equal(
    validateProxyTemplate("ftp://relay.example/?url={url}").problem,
    "insecure-scheme",
  );
  assert.equal(
    validateProxyTemplate("http://localhost:8787/?url={url}").valid,
    true,
  );
  assert.equal(
    validateProxyTemplate("http://127.0.0.1:8787/?url={url}").valid,
    true,
  );
});

test("a valid custom template is trimmed and used instead of the default", () => {
  const check = validateProxyTemplate("  https://my.worker.dev/?url={url}  ");
  assert.equal(check.valid, true);
  assert.equal(check.usesDefault, false);
  assert.equal(check.template, "https://my.worker.dev/?url={url}");
  assert.equal(
    effectiveProxyTemplate("  https://my.worker.dev/?url={url}  "),
    "https://my.worker.dev/?url={url}",
  );
  assert.equal(usesDefaultProxy("https://my.worker.dev/?url={url}"), false);
});

test("the default template itself validates and carries the placeholder", () => {
  const check = validateProxyTemplate(DEFAULT_PROXY_TEMPLATE);
  assert.equal(check.valid, true);
  assert.ok(DEFAULT_PROXY_TEMPLATE.includes(PROXY_PLACEHOLDER));
});

test("an unusable stored template falls back rather than disabling the Proxy", () => {
  assert.equal(effectiveProxyTemplate("nonsense"), DEFAULT_PROXY_TEMPLATE);
  assert.equal(
    normalizeSettings({ proxyTemplate: "nonsense" }).proxyTemplate,
    "",
  );
});

// --- The Proxy "Test" button ----------------------------------------------

const TEST_FEED = "https://feeds.example/rss.xml";
const TEST_TEMPLATE = "https://my.worker.dev/?url={url}";
const TEST_RELAY = `https://my.worker.dev/?url=${encodeURIComponent(TEST_FEED)}`;
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel/></rss>';

/**
 * A `fetch` standing in for the browser's: the Feed itself is CORS-blocked (a
 * thrown TypeError, exactly what a browser does), so only the relay can answer.
 */
function corsBlockedFeed(relay) {
  const calls = [];
  const impl = async (url) => {
    const key = String(url);
    calls.push(key);
    if (key === TEST_FEED) throw new TypeError("Failed to fetch");
    return relay();
  };
  return { impl, calls };
}

/** @param {string} body */
const answer =
  (body, status = 200) =>
  () =>
    new Response(body, { status, headers: { "content-type": "text/plain" } });

test("Test reports success when a real Feed comes back through the relay", async () => {
  const { impl, calls } = corsBlockedFeed(answer(RSS));
  const result = await testProxyTemplate(TEST_TEMPLATE, {
    fetch: impl,
    feedUrl: TEST_FEED,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, null);
  assert.equal(result.via, "proxy");
  assert.equal(result.status, 200);
  assert.equal(result.bytes, RSS.length);
  assert.deepEqual(
    calls,
    [TEST_FEED, TEST_RELAY],
    "direct first, then the relay — the same order a Sync uses (ADR-0001)",
  );
});

test("Test reports the fetcher's kind and status when the relay fails", async () => {
  const { impl } = corsBlockedFeed(answer("Rate limit exceeded", 429));
  const result = await testProxyTemplate(TEST_TEMPLATE, {
    fetch: impl,
    feedUrl: TEST_FEED,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "blocked");
  assert.equal(result.status, 429);
  assert.equal(result.via, "proxy");
});

test("Test reports not-found for a 404 from the relay", async () => {
  const { impl } = corsBlockedFeed(answer("no", 404));
  const result = await testProxyTemplate(TEST_TEMPLATE, {
    fetch: impl,
    feedUrl: TEST_FEED,
  });
  assert.equal(result.kind, "not-found");
});

test("Test reports offline when neither attempt reaches anything", async () => {
  const impl = async () => {
    throw new TypeError("Failed to fetch");
  };
  const result = await testProxyTemplate(TEST_TEMPLATE, {
    fetch: impl,
    feedUrl: TEST_FEED,
    onLine: () => false,
  });
  assert.equal(result.kind, "offline");
});

test("Test reports not-a-feed when the relay answers with a page", async () => {
  const { impl } = corsBlockedFeed(
    answer("<!doctype html><html><body>Hello</body></html>"),
  );
  const result = await testProxyTemplate(TEST_TEMPLATE, {
    fetch: impl,
    feedUrl: TEST_FEED,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "not-a-feed");
});

test("Test says so when the Feed was reachable without the relay", async () => {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return new Response(RSS, { status: 200 });
  };
  const result = await testProxyTemplate(TEST_TEMPLATE, {
    fetch: impl,
    feedUrl: TEST_FEED,
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, "direct");
  assert.equal(result.kind, "direct", "the relay was never exercised");
  assert.deepEqual(calls, [TEST_FEED]);
});

test("Test refuses an invalid template without touching the network", async () => {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return new Response("whatever");
  };
  const result = await testProxyTemplate(
    "https://relay.example/no-placeholder",
    {
      fetch: impl,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.kind, "proxy-unconfigured");
  assert.deepEqual(calls, []);
});

// --- The typed layer over the `settings` table ----------------------------

/** A fake Dexie handle with just the `settings` table the store uses. */
function fakeDb(rows = []) {
  const map = new Map(rows.map((row) => [row.key, row]));
  return {
    rows: map,
    settings: {
      async get(key) {
        return map.get(key);
      },
      async put(row) {
        map.set(row.key, row);
      },
      async clear() {
        map.clear();
      },
    },
  };
}

test("an empty settings table reads back as the defaults", async () => {
  const store = createSettingsStore(/** @type {any} */ (fakeDb()));
  assert.deepEqual(await store.read(), {
    proxyTemplate: "",
    retention: { ...DEFAULT_RETENTION },
    nations: [],
  });
});

test("the store writes one row per key and normalizes on the way in", async () => {
  const db = fakeDb();
  const store = createSettingsStore(/** @type {any} */ (db));
  await store.write({ proxyTemplate: "  https://my.worker.dev/?url={url} " });
  await store.write({
    retention: { maxAgeDays: 9999, keepPerPublication: 1 },
  });
  assert.deepEqual(
    [...db.rows.keys()].sort(),
    [SETTINGS_KEYS.proxyTemplate, SETTINGS_KEYS.retention].sort(),
  );
  const settings = await store.read();
  assert.equal(settings.proxyTemplate, "https://my.worker.dev/?url={url}");
  assert.equal(settings.retention.maxAgeDays, 365);
  assert.equal(settings.retention.keepPerPublication, 10);
  assert.equal(
    settings.retention.prefetchPerPublication,
    DEFAULT_RETENTION.prefetchPerPublication,
    "an untouched limit keeps its default",
  );
});

test("a retention patch replaces the whole object, it does not merge", async () => {
  // Which is why the Settings screen writes a complete `RetentionLimits`: a
  // patch that names one limit takes the DEFAULTS for the rest, not whatever
  // was stored. Documented on the SettingsStore typedef.
  const store = createSettingsStore(/** @type {any} */ (fakeDb()));
  await store.write({ retention: { maxAgeDays: 7, keepPerPublication: 20 } });
  await store.write({ retention: { maxAgeDays: 9 } });
  const limits = (await store.read()).retention;
  assert.equal(limits.maxAgeDays, 9);
  assert.equal(
    limits.keepPerPublication,
    DEFAULT_RETENTION.keepPerPublication,
    "an unnamed limit returns to its default",
  );
});

test("a hand-edited or corrupt row cannot brick the screen", async () => {
  const db = fakeDb([
    { key: SETTINGS_KEYS.proxyTemplate, value: { not: "a string" } },
    { key: SETTINGS_KEYS.retention, value: "nonsense" },
  ]);
  const store = createSettingsStore(/** @type {any} */ (db));
  const settings = await store.read();
  assert.equal(settings.proxyTemplate, "");
  assert.deepEqual(settings.retention, { ...DEFAULT_RETENTION });
});

test("an invalid template is stored as empty, so the default applies", async () => {
  const store = createSettingsStore(/** @type {any} */ (fakeDb()));
  const saved = await store.write({
    proxyTemplate: "http://relay.example/?url={url}",
  });
  assert.equal(saved.proxyTemplate, "");
  assert.equal(
    effectiveProxyTemplate(saved.proxyTemplate),
    DEFAULT_PROXY_TEMPLATE,
  );
});

// --- The Nation selection -------------------------------------------------

test("a Nation selection is cleaned up rather than trusted", () => {
  assert.deepEqual(normalizeNations(["gb", " it "]), ["GB", "IT"]);
  assert.deepEqual(normalizeNations(["GB", "GB"]), ["GB"], "deduplicated");
  assert.deepEqual(normalizeNations(["GB", "", 7, null, "GBR"]), ["GB"]);
  assert.deepEqual(normalizeNations("GB"), [], "not an array");
  assert.deepEqual(normalizeNations(undefined), []);
  assert.deepEqual(
    normalizeNations(["ZZ"]),
    ["ZZ"],
    "a Nation the Catalog has dropped still reads back; the screen filters it",
  );
  const input = ["gb"];
  normalizeNations(input);
  assert.deepEqual(input, ["gb"], "never mutates its input");
});

test("no Nation is selected until the reader chooses, which is the first-run signal", async () => {
  const store = createSettingsStore(/** @type {any} */ (fakeDb()));
  assert.deepEqual((await store.read()).nations, []);
});

test("the Nation selection round-trips through its own row", async () => {
  const db = fakeDb();
  const store = createSettingsStore(/** @type {any} */ (db));
  assert.deepEqual((await store.write({ nations: ["GB", "it"] })).nations, [
    "GB",
    "IT",
  ]);
  assert.deepEqual((await store.read()).nations, ["GB", "IT"]);
  assert.deepEqual(
    db.rows.get(SETTINGS_KEYS.nations).value,
    ["GB", "IT"],
    "stored under the documented key",
  );
  assert.deepEqual(
    (await store.read()).retention,
    { ...DEFAULT_RETENTION },
    "the other settings are untouched",
  );
});

test("an empty Nation selection is refused, not stored", async () => {
  const db = fakeDb();
  const store = createSettingsStore(/** @type {any} */ (db));
  await store.write({ nations: ["GB"] });
  await assert.rejects(() => store.write({ nations: [] }), RangeError);
  await assert.rejects(
    () => store.write({ nations: ["nonsense"] }),
    RangeError,
  );
  assert.deepEqual(
    (await store.read()).nations,
    ["GB"],
    "the previous choice survives a refused write",
  );
});

test("a corrupt Nation row reads back as no choice at all", async () => {
  const db = fakeDb([{ key: SETTINGS_KEYS.nations, value: "GB,IT" }]);
  const store = createSettingsStore(/** @type {any} */ (db));
  assert.deepEqual((await store.read()).nations, []);
});

test("clear drops every stored setting", async () => {
  const db = fakeDb();
  const store = createSettingsStore(/** @type {any} */ (db));
  await store.write({ retention: { ...DEFAULT_RETENTION, maxAgeDays: 7 } });
  await store.clear();
  assert.equal(db.rows.size, 0);
  assert.deepEqual((await store.read()).retention, { ...DEFAULT_RETENTION });
});

// --- Storage measurement --------------------------------------------------

/** A fake Dexie handle whose tables stream rows through `each`. */
function fakeContentDb(tables) {
  /** @type {any} */
  const db = { deleted: false };
  for (const name of STORAGE_TABLES) {
    const rows = tables[name] ?? [];
    db[name] = {
      rows,
      async each(fn) {
        for (const row of rows) fn(row);
      },
      async count() {
        return rows.length;
      },
      async clear() {
        rows.length = 0;
      },
      async delete(key) {
        const i = rows.findIndex((row) => row.key === key);
        if (i !== -1) rows.splice(i, 1);
      },
      toCollection() {
        return {
          async modify(fn) {
            for (const row of rows) fn(row);
          },
        };
      },
    };
  }
  db.transaction = async (_mode, _tables, body) => await body();
  db.delete = async () => {
    db.deleted = true;
  };
  return db;
}

test("estimateValueBytes measures strings as UTF-8 and blobs by size", () => {
  assert.equal(estimateValueBytes("abc"), 3);
  assert.equal(estimateValueBytes("è"), 2, "one Italian accent is two bytes");
  assert.equal(estimateValueBytes(new Blob(["12345"])), 5);
  assert.equal(estimateValueBytes(null), 0);
  assert.ok(estimateValueBytes({ a: "xx", b: "yy" }) >= 8);
});

test("formatBytes rounds into familiar units and follows the locale", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * MIB), "5.0 MB");
  assert.equal(formatBytes(500 * MIB), "500 MB");
  assert.equal(formatBytes(1536, "it"), "1,5 KB");
  assert.equal(formatBytes(null), "—");
  assert.equal(formatBytes(-1), "—");
});

test("readStorageUsage counts every table, Saved Items and Enabled Publications", async () => {
  const db = fakeContentDb({
    publications: [
      { id: "a", name: "A", enabled: true },
      { id: "b", name: "B", enabled: false },
      { id: "c", name: "C", enabled: true },
    ],
    // `items.saved` is stored as 0 | 1, never a boolean (ticket 07's notes).
    items: [
      { id: "1", saved: 1, summaryText: "x" },
      { id: "2", saved: 0, summaryText: "y" },
      { id: "3", saved: 1, summaryText: "z" },
    ],
    articles: [{ itemId: "1", html: "<p>hello</p>" }],
    images: [{ key: "k", blob: new Blob(["0123456789"]), bytes: 10 }],
    settings: [{ key: "retention", value: { maxAgeDays: 30 } }],
    meta: [{ key: "appVersion", value: "0.1.0" }],
  });
  const usage = await readStorageUsage({
    db,
    estimate: async () => ({ usage: 1234, quota: 5678 }),
    getMeta: async (key) => (key === "persistentStorage" ? true : null),
    now: () => 42,
  });
  assert.equal(usage.usage, 1234);
  assert.equal(usage.quota, 5678);
  assert.equal(usage.persistent, true);
  assert.equal(usage.enabledPublications, 2);
  assert.equal(usage.savedItems, 2);
  assert.equal(usage.measuredAt, 42);
  assert.deepEqual(
    usage.tables.map((entry) => entry.table),
    [...STORAGE_TABLES],
  );
  assert.deepEqual(
    usage.tables.map((entry) => entry.rows),
    [3, 3, 1, 1, 1, 1],
  );
  assert.ok(
    usage.tables.find((entry) => entry.table === "images").bytes >= 10,
    "an image's blob counts its bytes",
  );
  assert.equal(
    usage.tablesBytes,
    usage.tables.reduce((total, entry) => total + entry.bytes, 0),
  );
});

test("readStorageUsage survives a browser with no storage estimate", async () => {
  const usage = await readStorageUsage({
    db: fakeContentDb({}),
    estimate: async () => {
      throw new Error("no such API");
    },
  });
  assert.equal(usage.usage, null);
  assert.equal(usage.quota, null);
  assert.equal(usage.persistent, null);
  assert.equal(usage.tablesBytes, 0);
});

test("countEnabledPublications counts only the Enabled ones", async () => {
  const db = fakeContentDb({
    publications: [{ enabled: true }, { enabled: false }, {}],
  });
  assert.equal(await countEnabledPublications(db), 1);
});

test("clearContent removes content and keeps Publications and settings", async () => {
  const db = fakeContentDb({
    publications: [{ id: "a", enabled: true, lastSyncedAt: 5, lastError: "x" }],
    items: [{ id: "1" }, { id: "2" }],
    articles: [{ itemId: "1" }],
    images: [{ key: "k" }],
    settings: [{ key: "retention", value: {} }],
    meta: [
      { key: "lastSyncAt", value: 99 },
      { key: "appVersion", value: "0.1.0" },
    ],
  });
  const cleared = await clearContent(db, { lastSyncAtKey: "lastSyncAt" });
  assert.deepEqual(cleared, { items: 2, articles: 1, images: 1 });
  assert.equal(db.items.rows.length, 0);
  assert.equal(db.articles.rows.length, 0);
  assert.equal(db.images.rows.length, 0);
  assert.equal(db.publications.rows.length, 1, "Enabled Publications survive");
  assert.equal(db.publications.rows[0].enabled, true);
  assert.equal(db.publications.rows[0].lastSyncedAt, null);
  assert.equal(db.settings.rows.length, 1, "settings survive");
  assert.deepEqual(
    db.meta.rows.map((row) => row.key),
    ["appVersion"],
    "the last-Sync stamp is forgotten so the next Sync refills",
  );
});

test("resetApp deletes the database and the reader's preferences", async () => {
  const db = fakeContentDb({});
  const removed = [];
  let sessionCleared = false;
  const local = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const session = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { removeItem: (key) => removed.push(key) },
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      clear: () => {
        sessionCleared = true;
      },
    },
  });
  try {
    await resetApp(db);
  } finally {
    restoreGlobal("localStorage", local);
    restoreGlobal("sessionStorage", session);
  }
  assert.equal(db.deleted, true);
  assert.deepEqual(removed, [...PREFERENCE_KEYS]);
  assert.equal(sessionCleared, true);
});

/** Put a global back exactly as it was, present or absent. */
function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

// --- ADR-0008: version comparison and the reload guard --------------------

test("compareAppVersions orders dotted versions numerically", () => {
  assert.equal(compareAppVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareAppVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareAppVersions("0.2.0", "0.1.9"), 1);
  assert.equal(
    compareAppVersions("0.9.0", "0.10.0"),
    -1,
    "not a string compare",
  );
  assert.equal(compareAppVersions("1.2", "1.2.0"), 0, "a missing segment is 0");
  assert.equal(compareAppVersions("1.2.3", "1.2"), 1);
  assert.equal(compareAppVersions(null, "0.1.0"), -1);
  assert.equal(compareAppVersions("0.1.0", null), 1);
});

test("only a strictly newer stored version asks for a reload", () => {
  const guard = (running, stored, reloaded = false) => {
    let triggered = false;
    runVersionGuard({
      runningVersion: running,
      storedVersion: stored,
      session: fakeSession(reloaded ? { [RELOAD_GUARD_KEY]: "1" } : {}),
      reload: () => {
        triggered = true;
      },
    });
    return triggered;
  };
  assert.equal(guard("0.1.0", "0.2.0"), true, "the Shell is older: reload");
  assert.equal(guard("0.2.0", "0.1.0"), false, "the Shell is newer: carry on");
  assert.equal(guard("0.1.0", "0.1.0"), false);
  assert.equal(
    guard("0.1.0", null),
    false,
    "a first run has nothing to compare",
  );
  assert.equal(guard("0.1.0", "0.2.0", true), false, "already reloaded once");
});

/** A sessionStorage double. */
function fakeSession(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: () => null,
    map,
  };
}

test("the version guard reloads exactly once per session", () => {
  const session = fakeSession();
  let reloads = 0;
  const run = () =>
    runVersionGuard({
      runningVersion: "0.1.0",
      storedVersion: "0.2.0",
      session: /** @type {any} */ (session),
      reload: () => {
        reloads += 1;
      },
    });
  assert.equal(run(), true);
  assert.equal(reloads, 1);
  assert.equal(session.map.get(RELOAD_GUARD_KEY), "1");
  assert.equal(run(), false, "the guard is set: no second reload");
  assert.equal(reloads, 1);
});

test("the version guard does nothing when the Shell is current", () => {
  const session = fakeSession();
  let reloads = 0;
  assert.equal(
    runVersionGuard({
      runningVersion: "0.2.0",
      storedVersion: "0.1.0",
      session: /** @type {any} */ (session),
      reload: () => {
        reloads += 1;
      },
    }),
    false,
  );
  assert.equal(reloads, 0);
  assert.equal(session.map.size, 0);
});

test("a broken sessionStorage never becomes a reload loop", () => {
  let reloads = 0;
  const throwing = /** @type {any} */ ({
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
  });
  assert.equal(
    runVersionGuard({
      runningVersion: "0.1.0",
      storedVersion: "0.9.0",
      session: throwing,
      reload: () => {
        reloads += 1;
      },
    }),
    false,
  );
  assert.equal(reloads, 0);
});

test("the skipWaiting message type matches the one sw.js listens for", () => {
  assert.equal(SKIP_WAITING_MESSAGE, "skip-waiting");
});
