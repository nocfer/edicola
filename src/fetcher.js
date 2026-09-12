// The one way to reach a Feed or an Original (ADR-0001). Every content request
// in the app goes through a fetcher built here: it tries the URL directly and,
// when the browser cannot get a usable answer (CORS surfaces as a TypeError, an
// opaque response, or a 401/403/429/5xx), retries once through the configured
// Proxy. A 404 is final and never retried. Failures are `FetchFailure` errors
// whose `kind` lets the UI say the right thing: offline is not the same as
// blocked by the publisher.
//
// This module has no DOM and no globals of its own: `fetch` and `onLine` are
// injected so it runs unchanged in the page, the Sync worker and Node tests.
// Named exports only (tools/check-imports.mjs relies on it).

/**
 * Public CORS relay used when the reader has not configured their own Proxy.
 * Service: cors-get-proxy, a public Cloudflare Worker at
 * cors-get-proxy.sirjosh.workers.dev (source:
 * https://github.com/SirJosh3917/cors-get-proxy) that relays GET requests and
 * answers with `access-control-allow-origin: *`. Verified with curl on 2026-09-07 against
 * https://feeds.bbci.co.uk/news/rss.xml and
 * https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml: HTTP 200 and the
 * real RSS document as body, both with and without an `Origin` header. Caveat:
 * it rewrites `content-type` to `text/plain`, so `contentType` on a proxied
 * result is not the publisher's; Feed parsing and image decoding do not rely
 * on it.
 * Other relays checked the same day and rejected: corsproxy.io now requires an
 * API key (401); api.allorigins.win and api.codetabs.com answered Cloudflare
 * 522; api.cors.lol answered 429 "Rate limit exceeded" to every request over
 * twenty minutes; cors.redoc.ly returned the feed with CORS headers but is
 * Redocly's product relay, not a service offered to the public.
 * Settings (ticket 12) shows this template and service name next to the input
 * for a custom template. Swapping the default is a one-line change here.
 */
export const DEFAULT_PROXY_TEMPLATE =
  "https://cors-get-proxy.sirjosh.workers.dev/?url={url}";

/** Human-readable name of the service behind `DEFAULT_PROXY_TEMPLATE`. */
export const DEFAULT_PROXY_SERVICE = "cors-get-proxy (Cloudflare Worker)";

/** Default cap for `fetchBlob`: the spec's per-Article image budget (5 MiB). */
const DEFAULT_MAX_BLOB_BYTES = 5 * 1024 * 1024;

/** Placeholder a Proxy template must contain; replaced by the encoded target. */
const URL_PLACEHOLDER = "{url}";

/**
 * @typedef {'offline' | 'blocked' | 'not-found' | 'too-large' | 'timeout' | 'proxy-unconfigured'} FetchFailureKind
 */

/** @typedef {'direct' | 'proxy'} FetchVia */

/**
 * What every successful request reports besides its payload.
 * `finalUrl` is the URL after redirects for a direct fetch; through the Proxy
 * the upstream URL is not observable, so it is the requested URL.
 * @typedef {object} FetchResultMeta
 * @property {string} finalUrl
 * @property {FetchVia} via
 * @property {number} status
 * @property {string} contentType Raw `content-type` header, `""` when absent.
 */

/** @typedef {FetchResultMeta & { text: string }} FetchTextResult */

/** @typedef {FetchResultMeta & { blob: Blob }} FetchBlobResult */

/**
 * @typedef {object} Fetcher
 * @property {(url: string) => Promise<FetchTextResult>} fetchText
 * @property {(url: string, options?: { maxBytes?: number }) => Promise<FetchBlobResult>} fetchBlob
 * @property {(url: string) => Promise<FetchResultMeta>} probe
 */

/**
 * @typedef {object} FetcherOptions
 * @property {typeof globalThis.fetch} [fetch] Injected `fetch`; defaults to the global one.
 * @property {string} [proxyTemplate] Template containing `{url}`; `""` disables the Proxy.
 * @property {number} [timeoutMs] Per-attempt timeout, direct and Proxy independently.
 * @property {() => boolean} [onLine] Connectivity hint, typically `() => navigator.onLine`.
 */

/**
 * The error every fetcher method rejects with. `kind` is the only field the UI
 * needs; `status`, `via` and `cause` are there for logs and tests.
 */
export class FetchFailure extends Error {
  /**
   * @param {FetchFailureKind} kind
   * @param {string} url The URL the caller asked for (never the Proxy URL).
   * @param {{ status?: number, via?: FetchVia, cause?: unknown }} [details]
   */
  constructor(kind, url, details = {}) {
    super(`Fetch failed (${kind}): ${url}`, { cause: details.cause });
    this.name = "FetchFailure";
    /** @type {FetchFailureKind} */
    this.kind = kind;
    /** @type {string} */
    this.url = url;
    /** @type {number | undefined} */
    this.status = details.status;
    /** @type {FetchVia | undefined} */
    this.via = details.via;
  }
}

/**
 * Whether a Proxy template can be used at all.
 * @param {unknown} template
 * @returns {template is string}
 */
function isProxyConfigured(template) {
  return typeof template === "string" && template.includes(URL_PLACEHOLDER);
}

/**
 * Build the Proxy URL for a target: every `{url}` in the template is replaced
 * with the percent-encoded target. Throws `FetchFailure('proxy-unconfigured')`
 * when the template is empty or lacks the placeholder.
 * @param {string} template
 * @param {string} url
 * @returns {string}
 */
export function buildProxyUrl(template, url) {
  if (!isProxyConfigured(template)) {
    throw new FetchFailure("proxy-unconfigured", url);
  }
  return template.split(URL_PLACEHOLDER).join(encodeURIComponent(url));
}

/**
 * What to do with a response from one attempt.
 * @param {Response} response
 * @returns {'ok' | 'retry' | 'not-found' | 'blocked'}
 */
function classify(response) {
  if (response.type === "opaque") return "retry";
  const status = response.status;
  if (status === 404 || status === 410) return "not-found";
  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return "retry";
  }
  if (status >= 200 && status < 300) return "ok";
  return "blocked";
}

/**
 * @param {Response} response
 * @param {string} url
 * @param {FetchVia} via
 * @returns {FetchResultMeta}
 */
function metaOf(response, url, via) {
  const headerType =
    typeof response.headers?.get === "function"
      ? response.headers.get("content-type")
      : null;
  return {
    finalUrl: via === "direct" && response.url ? response.url : url,
    via,
    status: response.status,
    contentType: headerType ?? "",
  };
}

/**
 * One attempt: its own `AbortController`, its own timer. The timer keeps
 * running while the body is read and is cleared by `release()`, so a stalled
 * body is a timeout too.
 * @typedef {object} Attempt
 * @property {FetchVia} via
 * @property {Response | null} response `null` when the fetch threw.
 * @property {unknown} error What the fetch threw, if it did.
 * @property {() => boolean} timedOut
 * @property {() => void} release Clears the timer; call once the body is consumed.
 * @property {() => void} abort Aborts the request (used to drop an unwanted body).
 */

/**
 * @param {typeof globalThis.fetch} fetchImpl
 * @param {string} requestUrl
 * @param {FetchVia} via
 * @param {number} timeoutMs
 * @returns {Promise<Attempt>}
 */
async function attempt(fetchImpl, requestUrl, via, timeoutMs) {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);
  const attemptState = {
    via,
    response: /** @type {Response | null} */ (null),
    error: /** @type {unknown} */ (undefined),
    timedOut: () => expired,
    release: () => clearTimeout(timer),
    abort: () => controller.abort(),
  };
  try {
    attemptState.response = await fetchImpl(requestUrl, {
      mode: "cors",
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    attemptState.error = error;
  }
  return attemptState;
}

/**
 * Read a body as text, mapping a mid-body abort to the right failure.
 * @param {Attempt} att
 * @param {string} url
 * @param {() => boolean} onLine
 * @returns {Promise<string>}
 */
async function readText(att, url, onLine) {
  try {
    return await att.response.text();
  } catch (error) {
    throw bodyFailure(att, url, onLine, error);
  } finally {
    att.release();
  }
}

/**
 * Magic numbers for the image formats Publications actually serve, checked in
 * order against the leading bytes of the body.
 */
const IMAGE_SIGNATURES = [
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  {
    type: "image/png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { type: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: "image/bmp", bytes: [0x42, 0x4d] },
];

/**
 * The real MIME type of an image, read from its own bytes rather than trusted
 * from a header. `fetchBlob` is images only, and `DEFAULT_PROXY_TEMPLATE`'s own
 * doc comment already admits it "rewrites `content-type` to `text/plain`" —
 * every image behind a Publication whose CDN skips CORS (nearly all of them)
 * goes through the Proxy, so a Blob built from that header decodes as nothing
 * once the Reader points an `<img>` at its object URL: `naturalWidth` stays 0
 * and the reader gets the broken-image icon for every image on the page.
 *
 * A signature match wins over the header; an unrecognized one (a format not
 * listed here, or a genuinely correct direct-fetch header) falls back to it
 * unchanged, so this can only fix a wrong type, never invent one.
 *
 * ponytail: sniffs the four formats actually seen in the Catalog. Add a
 * signature if a Publication turns up serving something else broken this way.
 *
 * @param {Uint8Array} head First bytes of the body.
 * @param {string} declaredType
 * @returns {string}
 */
function sniffImageType(head, declaredType) {
  for (const { type, bytes } of IMAGE_SIGNATURES) {
    if (head.length >= bytes.length && bytes.every((b, i) => head[i] === b))
      return type;
  }
  // WEBP: a RIFF container, "WEBP" at byte 8.
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return "image/webp";
  }
  return declaredType;
}

/** @param {string} type */
function isImageType(type) {
  return /^image\//i.test(type);
}

/**
 * Read a body as a Blob, aborting as soon as `maxBytes` is exceeded. Streams
 * when the response exposes a readable body; otherwise trusts `content-length`
 * first and the resulting Blob's size second. The Blob's `type` is sniffed
 * from its own bytes (see `sniffImageType`), not trusted from the response.
 *
 * `cors-get-proxy` does more than mislabel the header: measured against real
 * Catalog images, it sometimes runs the body through a text decode-and-reencode
 * that turns every byte outside plain ASCII into `�`, which is not
 * recoverable — the original bytes are gone, not just mistyped. Sniffing finds
 * no signature in bytes that far corrupted, and the declared type is the
 * Proxy's own `text/plain` rewrite, so that combination is treated as a failed
 * fetch rather than a storable Blob: `fetchImages` (fetch-one.js, sync.js)
 * already skips a failed image and leaves the Reader on the live network URL,
 * which is the honest outcome here, not a corrupt Blob cached forever.
 * @param {Attempt} att
 * @param {string} url
 * @param {number} maxBytes
 * @param {() => boolean} onLine
 * @returns {Promise<Blob>}
 */
async function readBlob(att, url, maxBytes, onLine) {
  const response = att.response;
  const contentType = metaOf(response, url, att.via).contentType;
  const declared = Number(
    typeof response.headers?.get === "function"
      ? response.headers.get("content-length")
      : null,
  );
  const tooLarge = () => {
    att.abort();
    return new FetchFailure("too-large", url, {
      status: response.status,
      via: att.via,
    });
  };
  const notAnImage = () =>
    new FetchFailure("blocked", url, {
      status: response.status,
      via: att.via,
    });
  /**
   * @param {Uint8Array} head
   * @returns {string}
   */
  const typeOf = (head) => {
    const type = sniffImageType(head, contentType);
    if (!isImageType(type) && att.via === "proxy") throw notAnImage();
    return type;
  };
  try {
    if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
    const body = response.body;
    if (body && typeof body.getReader === "function") {
      const reader = body.getReader();
      /** @type {BlobPart[]} */
      const chunks = [];
      let received = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          throw tooLarge();
        }
        chunks.push(value);
      }
      const firstChunk = /** @type {Uint8Array | undefined} */ (chunks[0]);
      const type = typeOf(firstChunk || new Uint8Array(0));
      return new Blob(chunks, { type });
    }
    const blob = await response.blob();
    if (blob.size > maxBytes) throw tooLarge();
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const type = typeOf(head);
    return type === blob.type ? blob : blob.slice(0, blob.size, type);
  } catch (error) {
    if (error instanceof FetchFailure) throw error;
    throw bodyFailure(att, url, onLine, error);
  } finally {
    att.release();
  }
}

/**
 * A body that could not be read to the end: the attempt's timer fired, or the
 * connection dropped underneath us.
 * @param {Attempt} att
 * @param {string} url
 * @param {() => boolean} onLine
 * @param {unknown} cause
 */
function bodyFailure(att, url, onLine, cause) {
  const details = { status: att.response?.status, via: att.via, cause };
  if (att.timedOut()) return new FetchFailure("timeout", url, details);
  return new FetchFailure(onLine() ? "blocked" : "offline", url, details);
}

/**
 * Build a fetcher. All options are optional so the page can call
 * `createFetcher({ fetch: (u, i) => fetch(u, i), proxyTemplate: settings.proxy,
 * onLine: () => navigator.onLine })` and tests can script every response.
 * @param {FetcherOptions} [options]
 * @returns {Fetcher}
 */
export function createFetcher({
  fetch: fetchImpl = (input, init) => globalThis.fetch(input, init),
  proxyTemplate = DEFAULT_PROXY_TEMPLATE,
  timeoutMs = 15000,
  onLine = () => true,
} = {}) {
  /**
   * Direct first, then the Proxy. Resolves with the attempt whose response is
   * usable and still unread; rejects with a `FetchFailure` otherwise.
   * @param {string} url
   * @returns {Promise<Attempt>}
   */
  async function reach(url) {
    const direct = await attempt(fetchImpl, url, "direct", timeoutMs);
    const directThrew = direct.response === null;
    if (directThrew) {
      if (direct.timedOut()) {
        throw new FetchFailure("timeout", url, {
          via: "direct",
          cause: direct.error,
        });
      }
    } else {
      const verdict = classify(direct.response);
      if (verdict === "ok") return direct;
      direct.release();
      direct.abort();
      if (verdict === "not-found" || verdict === "blocked") {
        throw new FetchFailure(verdict, url, {
          status: direct.response.status,
          via: "direct",
        });
      }
    }

    if (!isProxyConfigured(proxyTemplate)) {
      if (directThrew && !onLine()) {
        throw new FetchFailure("offline", url, {
          via: "direct",
          cause: direct.error,
        });
      }
      throw new FetchFailure("proxy-unconfigured", url, {
        status: direct.response?.status,
        via: "direct",
      });
    }

    const proxy = await attempt(
      fetchImpl,
      buildProxyUrl(proxyTemplate, url),
      "proxy",
      timeoutMs,
    );
    if (proxy.response === null) {
      if (proxy.timedOut()) {
        throw new FetchFailure("timeout", url, {
          via: "proxy",
          cause: proxy.error,
        });
      }
      // `directThrew` is NOT evidence of being offline: a cross-origin Feed
      // ALWAYS throws on the direct attempt (CORS surfaces as a TypeError),
      // which is the ordinary case this whole Proxy fallback exists for.
      // Treating it as offline told an online reader whose Proxy was merely
      // rate-limited "You are offline. Connect and try again.", sending them
      // to fix their connection instead of their Proxy. `onLine()` is the
      // offline tiebreaker and the only one, exactly as `bodyFailure` above
      // already has it.
      const kind = onLine() ? "blocked" : "offline";
      throw new FetchFailure(kind, url, {
        status: direct.response?.status,
        via: "proxy",
        cause: proxy.error,
      });
    }
    const verdict = classify(proxy.response);
    if (verdict === "ok") return proxy;
    proxy.release();
    proxy.abort();
    throw new FetchFailure(
      verdict === "not-found" ? "not-found" : "blocked",
      url,
      {
        status: proxy.response.status,
        via: "proxy",
      },
    );
  }

  return {
    async fetchText(url) {
      const att = await reach(url);
      const text = await readText(att, url, onLine);
      return { ...metaOf(att.response, url, att.via), text };
    },

    async fetchBlob(url, { maxBytes = DEFAULT_MAX_BLOB_BYTES } = {}) {
      const att = await reach(url);
      const blob = await readBlob(att, url, maxBytes, onLine);
      return { ...metaOf(att.response, url, att.via), blob };
    },

    async probe(url) {
      const att = await reach(url);
      att.release();
      att.abort();
      return metaOf(att.response, url, att.via);
    },
  };
}
