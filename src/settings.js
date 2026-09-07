// The reader's Settings: the typed layer over the `settings` table, plus the
// pure model the Settings screen renders (defaults, bounds, Proxy template
// validation).
//
// The pure half imports nothing but `retention.js` and `fetcher.js` — both
// free of Dexie and of the DOM — so it is importable and unit-testable under
// Node (test/settings.test.js). The Dexie half takes its database handle as a
// parameter for the same reason (CLAUDE.md: "modules that must be testable in
// Node take their DOM, fetch and store as parameters"); `getSettingsStore()`
// resolves the app's one handle through a lazy dynamic import of `db.js`, so
// importing this module never pulls the Dexie CDN bundle into Node.
//
// Two rows live in the `settings` table, one per key in `SETTINGS_KEYS`:
// `proxyTemplate` (a string; "" means "use the default") and `retention` (a
// RetentionLimits object). Anything missing or out of bounds reads back as the
// default, so a hand-edited row can never brick the screen.

import { createFetcher, DEFAULT_PROXY_TEMPLATE } from "./fetcher.js";
import { DEFAULT_RETENTION } from "./retention.js";

/** @typedef {import('./retention.js').RetentionLimits} RetentionLimits */

/** Keys of the rows the `settings` table holds. */
export const SETTINGS_KEYS = Object.freeze({
  proxyTemplate: "proxyTemplate",
  retention: "retention",
});

/** The placeholder a Proxy template must carry (ADR-0001). */
export const PROXY_PLACEHOLDER = "{url}";

/** Mebibyte, the unit the byte-valued Retention limits are shown in. */
export const MIB = 2 ** 20;

/**
 * A real Feed the "Test" button fetches through the reader's template. Chosen
 * because it is in the shipped Catalog, answers no CORS header of its own (so a
 * success really did go through the Proxy) and is small.
 */
export const PROXY_TEST_FEED_URL = "https://feeds.bbci.co.uk/news/rss.xml";

/** Longest body the Proxy test reads before deciding; a Feed head is enough. */
export const PROXY_TEST_MAX_BYTES = 256 * 1024;

/**
 * Everything the `settings` table holds, with every field present.
 * @typedef {object} Settings
 * @property {string} proxyTemplate The reader's override; "" = the default.
 * @property {RetentionLimits} retention
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  proxyTemplate: "",
  retention: DEFAULT_RETENTION,
});

/**
 * One Retention limit's editable range.
 * @typedef {object} RetentionBound
 * @property {number} min Smallest value the reader may save.
 * @property {number} max Largest value the reader may save.
 * @property {number} step Granularity of the number input.
 * @property {'days'|'bytes'|'items'} unit What the number counts.
 */

/**
 * Bounds for every Retention limit, in the limit's own canonical unit (bytes
 * for the two byte fields — the screen divides by `MIB` for display). Chosen to
 * stay sane rather than to be theoretically maximal: a 5 GiB cap is already
 * more than a phone will grant, and fewer than ten Items per Publication makes
 * Today feel broken.
 * @type {Readonly<Record<keyof RetentionLimits, RetentionBound>>}
 */
export const RETENTION_BOUNDS = Object.freeze({
  maxAgeDays: { min: 1, max: 365, step: 1, unit: "days" },
  maxTotalBytes: {
    min: 50 * MIB,
    max: 5120 * MIB,
    step: 10 * MIB,
    unit: "bytes",
  },
  maxImageBytesPerArticle: { min: 0, max: 50 * MIB, step: MIB, unit: "bytes" },
  keepPerPublication: { min: 10, max: 500, step: 10, unit: "items" },
  prefetchPerPublication: { min: 0, max: 50, step: 1, unit: "items" },
});

/**
 * The Retention limits in the order the screen shows them.
 * @type {ReadonlyArray<keyof RetentionLimits>}
 */
export const RETENTION_FIELDS = Object.freeze([
  "maxAgeDays",
  "maxTotalBytes",
  "maxImageBytesPerArticle",
  "keepPerPublication",
  "prefetchPerPublication",
]);

/**
 * Limits whose shrinking makes stored content fall outside Retention, so saving
 * a smaller value must run Eviction. The other two do not: `prefetchPerPublication`
 * only bounds the next Sync, and `maxImageBytesPerArticle` is applied by
 * Extraction when an Article is fetched (ticket 05's notes), never retroactively.
 * @type {ReadonlyArray<keyof RetentionLimits>}
 */
export const EVICTING_FIELDS = Object.freeze([
  "maxAgeDays",
  "maxTotalBytes",
  "keepPerPublication",
]);

/**
 * Why a Proxy template cannot be used.
 * @typedef {null|'missing-placeholder'|'malformed'|'insecure-scheme'} ProxyTemplateProblem
 */

/**
 * Verdict on a Proxy template.
 * @typedef {object} ProxyTemplateCheck
 * @property {boolean} valid Whether the template may be saved.
 * @property {ProxyTemplateProblem} problem Why not, or null.
 * @property {boolean} usesDefault The template is empty, so the default applies.
 * @property {string} template The trimmed template.
 */

/** Hosts allowed to serve a Proxy over plain http (development only). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Check a Proxy template the reader typed. An empty template is valid and means
 * "use the default"; anything else must carry `{url}`, expand to an absolute
 * URL, and be https (http is tolerated only on localhost, because a plain-http
 * relay is mixed content on a real deployment and the browser blocks it).
 * @param {string | null | undefined} template
 * @returns {ProxyTemplateCheck}
 */
export function validateProxyTemplate(template) {
  const trimmed = String(template ?? "").trim();
  if (trimmed === "")
    return { valid: true, problem: null, usesDefault: true, template: "" };
  /** @param {ProxyTemplateProblem} problem */
  const fail = (problem) => ({
    valid: false,
    problem,
    usesDefault: false,
    template: trimmed,
  });
  if (!trimmed.includes(PROXY_PLACEHOLDER)) return fail("missing-placeholder");
  let url;
  try {
    url = new URL(
      trimmed.split(PROXY_PLACEHOLDER).join(encodeURIComponent("https://e.gg")),
    );
  } catch {
    return fail("malformed");
  }
  if (url.protocol !== "https:") {
    if (url.protocol !== "http:" || !LOCAL_HOSTS.has(url.hostname))
      return fail("insecure-scheme");
  }
  return { valid: true, problem: null, usesDefault: false, template: trimmed };
}

/**
 * The template the fetcher should actually use: the reader's override when it
 * is valid, the default otherwise. A stored value that no longer validates
 * (hand-edited row, or a rule we tightened) falls back rather than disabling
 * the Proxy, because a disabled Proxy looks like a broken app.
 * @param {string | null | undefined} stored
 * @returns {string}
 */
export function effectiveProxyTemplate(stored) {
  const check = validateProxyTemplate(stored);
  if (!check.valid || check.usesDefault) return DEFAULT_PROXY_TEMPLATE;
  return check.template;
}

/**
 * Whether the reader is running the shipped default Proxy.
 * @param {string | null | undefined} stored
 * @returns {boolean}
 */
export function usesDefaultProxy(stored) {
  return effectiveProxyTemplate(stored) === DEFAULT_PROXY_TEMPLATE;
}

/**
 * Clamp one Retention limit into its bounds. A missing, non-numeric or
 * non-finite value becomes the default; everything else is rounded to a whole
 * number (bytes, days or Items — none of them are fractional) and clamped.
 * @param {keyof RetentionLimits} field
 * @param {unknown} value
 * @returns {number}
 */
export function clampRetentionValue(field, value) {
  const bound = RETENTION_BOUNDS[field];
  const fallback = DEFAULT_RETENTION[field];
  if (!bound) return fallback;
  // `Number(null)`, `Number("")` and `Number(false)` are all 0, which would
  // clamp to the minimum instead of falling back. Rule them out first.
  if (value == null || value === "" || typeof value === "boolean")
    return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(bound.max, Math.max(bound.min, Math.round(n)));
}

/**
 * A complete, in-bounds `RetentionLimits` from whatever was stored or typed.
 * Never mutates the input and never returns a partial object, so every caller
 * can read every field.
 * @param {Partial<RetentionLimits> | null | undefined} partial
 * @returns {RetentionLimits}
 */
export function normalizeRetention(partial) {
  const source = partial && typeof partial === "object" ? partial : {};
  /** @type {any} */
  const out = {};
  for (const field of RETENTION_FIELDS) {
    out[field] = clampRetentionValue(
      field,
      field in source ? source[field] : DEFAULT_RETENTION[field],
    );
  }
  return out;
}

/**
 * Whether saving `after` over `before` shrinks a limit that governs stored
 * content, so Eviction must run.
 * @param {RetentionLimits} before
 * @param {RetentionLimits} after
 * @returns {boolean}
 */
export function retentionShrank(before, after) {
  return EVICTING_FIELDS.some((field) => after[field] < before[field]);
}

/**
 * Whether two sets of limits are identical, so "Save" can be a no-op.
 * @param {RetentionLimits} a
 * @param {RetentionLimits} b
 * @returns {boolean}
 */
export function retentionEquals(a, b) {
  return RETENTION_FIELDS.every((field) => a[field] === b[field]);
}

/**
 * Normalize a whole stored settings object.
 * @param {Partial<Settings> | null | undefined} stored
 * @returns {Settings}
 */
export function normalizeSettings(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  const check = validateProxyTemplate(source.proxyTemplate);
  return {
    proxyTemplate: check.valid ? check.template : "",
    retention: normalizeRetention(source.retention),
  };
}

/**
 * What the "Test" button learned about a Proxy template.
 * @typedef {object} ProxyTestResult
 * @property {boolean} ok A document that looks like a Feed came back.
 * @property {string | null} kind The fetcher's failure `kind`, or `not-a-feed`
 *   when a body came back that was not a Feed, or `direct` when the Feed was
 *   reachable without the relay so the relay was never exercised, or null.
 * @property {number | null} status HTTP status of the deciding attempt, if any.
 * @property {'direct' | 'proxy' | null} via Which attempt answered.
 * @property {number} bytes Characters of body read.
 * @property {string} template The template that was tested.
 */

/** Cheap sniff: does this body open like an RSS, Atom, RDF or JSON Feed? */
function looksLikeFeed(text) {
  const head = text.slice(0, 2048).trimStart().toLowerCase();
  if (head.startsWith("{")) return head.includes('"items"');
  return (
    head.includes("<rss") ||
    head.includes("<feed") ||
    head.includes("<rdf") ||
    head.includes("<?xml")
  );
}

/**
 * Fetch a known Feed through `template` and report what happened, exactly the
 * way a Sync would: direct first, then the relay (ADR-0001). A green Test is
 * therefore a promise about the next Sync and not a separate code path.
 *
 * The Feed is one that answers no CORS header of its own, so in a browser the
 * direct attempt fails and the relay is what decides the outcome; if the Feed
 * *is* directly reachable the result says so (`kind: "direct"`) instead of
 * crediting the relay for someone else's work. Failures are reported by the
 * fetcher's `kind`.
 *
 * Takes `fetch` as a parameter so the flow is testable without a network.
 * @param {string} template
 * @param {{ fetch?: typeof globalThis.fetch, feedUrl?: string, onLine?: () => boolean }} [deps]
 * @returns {Promise<ProxyTestResult>}
 */
export async function testProxyTemplate(template, deps = {}) {
  const {
    fetch: fetchImpl = (input, init) => globalThis.fetch(input, init),
    feedUrl = PROXY_TEST_FEED_URL,
    onLine = () => true,
  } = deps;
  const effective = effectiveProxyTemplate(template);
  /** @type {ProxyTestResult} */
  const base = {
    ok: false,
    kind: null,
    status: null,
    via: null,
    bytes: 0,
    template: effective,
  };
  const check = validateProxyTemplate(template);
  if (!check.valid) return { ...base, kind: "proxy-unconfigured" };
  const fetcher = createFetcher({
    fetch: fetchImpl,
    proxyTemplate: effective,
    onLine,
  });
  try {
    const result = await fetcher.fetchText(feedUrl);
    const text = result.text.slice(0, PROXY_TEST_MAX_BYTES);
    const isFeed = looksLikeFeed(text);
    return {
      ...base,
      ok: isFeed,
      kind: !isFeed ? "not-a-feed" : result.via === "direct" ? "direct" : null,
      status: result.status,
      via: result.via,
      bytes: text.length,
    };
  } catch (error) {
    const failure = /** @type {any} */ (error);
    return {
      ...base,
      kind: typeof failure?.kind === "string" ? failure.kind : "blocked",
      status: typeof failure?.status === "number" ? failure.status : null,
      via: failure?.via ?? null,
    };
  }
}

/**
 * The typed read/write layer over the `settings` table.
 * @typedef {object} SettingsStore
 * @property {() => Promise<Settings>} read
 *   Every setting, normalized; defaults for anything unset.
 * @property {(patch: Partial<Settings>) => Promise<Settings>} write
 *   Merge and store; resolves with the settings as they now read.
 * @property {() => Promise<string>} getProxyTemplate
 *   The stored override, "" when the default is in use.
 * @property {(template: string) => Promise<string>} setProxyTemplate
 * @property {() => Promise<RetentionLimits>} getRetention
 * @property {(limits: Partial<RetentionLimits>) => Promise<RetentionLimits>} setRetention
 * @property {() => Promise<void>} clear
 *   Drop every stored setting, so the defaults apply again.
 */

/**
 * A `SettingsStore` over a Dexie handle. The handle is a parameter, not an
 * import, so a test can pass a two-method fake (`settings.get`, `settings.put`).
 * @param {import('./db.js').EdicolaDb} db
 * @returns {SettingsStore}
 */
export function createSettingsStore(db) {
  /** @param {string} key */
  async function getValue(key) {
    const row = await db.settings.get(key);
    return row?.value;
  }
  /**
   * @param {string} key
   * @param {unknown} value
   */
  async function putValue(key, value) {
    await db.settings.put({ key, value });
  }

  /** @returns {Promise<Settings>} */
  async function read() {
    const [proxyTemplate, retention] = await Promise.all([
      getValue(SETTINGS_KEYS.proxyTemplate),
      getValue(SETTINGS_KEYS.retention),
    ]);
    return normalizeSettings({
      proxyTemplate: /** @type {any} */ (proxyTemplate),
      retention: /** @type {any} */ (retention),
    });
  }

  return {
    read,

    async write(patch) {
      if ("proxyTemplate" in patch) {
        const check = validateProxyTemplate(patch.proxyTemplate);
        await putValue(
          SETTINGS_KEYS.proxyTemplate,
          check.valid ? check.template : "",
        );
      }
      if ("retention" in patch) {
        await putValue(
          SETTINGS_KEYS.retention,
          normalizeRetention(patch.retention),
        );
      }
      return await read();
    },

    async getProxyTemplate() {
      return (await read()).proxyTemplate;
    },

    async setProxyTemplate(template) {
      return (await this.write({ proxyTemplate: template })).proxyTemplate;
    },

    async getRetention() {
      return (await read()).retention;
    },

    async setRetention(limits) {
      const next = normalizeRetention({
        ...(await read()).retention,
        ...limits,
      });
      return (await this.write({ retention: next })).retention;
    },

    async clear() {
      await db.settings.clear();
    },
  };
}

/** @type {SettingsStore | null} */
let shared = null;

/**
 * The app's one `SettingsStore`, over the app's one database handle. The
 * `db.js` import is dynamic so this module (and its pure half) stays importable
 * under Node, where the Dexie CDN URL does not resolve.
 * @returns {Promise<SettingsStore>}
 */
export async function getSettingsStore() {
  if (!shared) {
    const { getDatabase } = await import("./db.js");
    shared = createSettingsStore(getDatabase());
  }
  return shared;
}
