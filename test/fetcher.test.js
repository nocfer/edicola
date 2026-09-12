import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProxyUrl,
  createFetcher,
  DEFAULT_PROXY_TEMPLATE,
  FetchFailure,
} from "../src/fetcher.js";

const FEED = "https://example.test/feed.xml?a=1&b=two words";
const PROXY = "https://proxy.test/?url={url}";
const RSS =
  '<?xml version="1.0"?><rss><channel><title>T</title></channel></rss>';

/**
 * A `fetch` whose answers are scripted per URL. Each script entry is either a
 * `Response`, a function `(url, init) => Response | Promise<Response>`, or an
 * `Error` to throw. Every call is recorded so tests can assert the order and
 * the request options.
 */
function scriptedFetch(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const entry = script[url];
    if (entry === undefined) throw new Error(`unscripted url: ${url}`);
    if (entry instanceof Error) throw entry;
    return typeof entry === "function" ? entry(url, init) : entry;
  };
  return { fetchImpl, calls };
}

/** A fetch that mimics the browser: it settles only when the signal aborts. */
function hangingFetch() {
  const calls = [];
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => {
      calls.push({ url, init });
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    });
  return { fetchImpl, calls };
}

const corsError = () => new TypeError("Failed to fetch"); // what browsers throw on a CORS block

const rss = (headers = {}) =>
  new Response(RSS, {
    status: 200,
    headers: { "content-type": "application/rss+xml", ...headers },
  });

const opaque = () =>
  /** @type {Response} */ ({
    type: "opaque",
    status: 0,
    ok: false,
    url: "",
    headers: new Headers(),
  });

/** @param {() => Promise<unknown>} run */
async function failure(run) {
  try {
    await run();
  } catch (error) {
    assert.ok(
      error instanceof FetchFailure,
      `expected FetchFailure, got ${error}`,
    );
    return error;
  }
  assert.fail("expected a FetchFailure");
}

test("buildProxyUrl percent-encodes the target into every {url}", () => {
  assert.equal(
    buildProxyUrl(PROXY, FEED),
    `https://proxy.test/?url=${encodeURIComponent(FEED)}`,
  );
  assert.equal(
    buildProxyUrl("https://p.test/{url}/x/{url}", "https://a.test/?q=1"),
    "https://p.test/https%3A%2F%2Fa.test%2F%3Fq%3D1/x/https%3A%2F%2Fa.test%2F%3Fq%3D1",
  );
});

test("buildProxyUrl rejects an empty template or one without {url}", () => {
  for (const template of ["", "https://p.test/?url=", undefined, null]) {
    assert.throws(
      () => buildProxyUrl(template, FEED),
      (e) => e instanceof FetchFailure && e.kind === "proxy-unconfigured",
    );
  }
});

test("DEFAULT_PROXY_TEMPLATE is an https template containing {url}", () => {
  assert.match(DEFAULT_PROXY_TEMPLATE, /^https:\/\/.+\{url\}/);
  assert.equal(
    buildProxyUrl(DEFAULT_PROXY_TEMPLATE, "https://a.test/f?x=1"),
    DEFAULT_PROXY_TEMPLATE.replace(
      "{url}",
      encodeURIComponent("https://a.test/f?x=1"),
    ),
  );
});

test("direct success returns the text and is not proxied", async () => {
  const { fetchImpl, calls } = scriptedFetch({ [FEED]: rss() });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchText(FEED);
  assert.equal(result.text, RSS);
  assert.equal(result.via, "direct");
  assert.equal(result.status, 200);
  assert.equal(result.contentType, "application/rss+xml");
  assert.equal(result.finalUrl, FEED);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.mode, "cors");
  assert.equal(calls[0].init.redirect, "follow");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("finalUrl follows redirects on a direct fetch", async () => {
  const moved = "https://example.test/moved.xml";
  const response = rss();
  Object.defineProperty(response, "url", { value: moved });
  const { fetchImpl } = scriptedFetch({ [FEED]: response });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchText(FEED);
  assert.equal(result.finalUrl, moved);
});

test("a TypeError on the direct attempt falls through to the Proxy with the encoded URL", async () => {
  const proxied = buildProxyUrl(PROXY, FEED);
  const { fetchImpl, calls } = scriptedFetch({
    [FEED]: corsError(),
    [proxied]: rss(),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchText(FEED);
  assert.equal(result.text, RSS);
  assert.equal(result.via, "proxy");
  assert.equal(result.finalUrl, FEED);
  assert.deepEqual(
    calls.map((c) => c.url),
    [FEED, proxied],
  );
  assert.ok(calls[1].url.includes(encodeURIComponent(FEED)));
  assert.notEqual(calls[0].init.signal, calls[1].init.signal);
});

test("an opaque direct response falls through to the Proxy", async () => {
  const proxied = buildProxyUrl(PROXY, FEED);
  const { fetchImpl } = scriptedFetch({ [FEED]: opaque(), [proxied]: rss() });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchText(FEED);
  assert.equal(result.via, "proxy");
});

for (const status of [401, 403, 429, 500, 503]) {
  test(`a direct ${status} falls through to the Proxy`, async () => {
    const proxied = buildProxyUrl(PROXY, FEED);
    const { fetchImpl, calls } = scriptedFetch({
      [FEED]: new Response("no", { status }),
      [proxied]: rss(),
    });
    const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
    const result = await fetcher.fetchText(FEED);
    assert.equal(result.via, "proxy");
    assert.equal(calls.length, 2);
  });
}

test("a direct 404 is not retried and yields not-found", async () => {
  const { fetchImpl, calls } = scriptedFetch({
    [FEED]: new Response("gone", { status: 404 }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "not-found");
  assert.equal(error.status, 404);
  assert.equal(error.via, "direct");
  assert.equal(error.url, FEED);
  assert.equal(calls.length, 1);
});

test("a 404 through the Proxy yields not-found", async () => {
  const proxied = buildProxyUrl(PROXY, FEED);
  const { fetchImpl } = scriptedFetch({
    [FEED]: corsError(),
    [proxied]: new Response("gone", { status: 404 }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "not-found");
  assert.equal(error.via, "proxy");
});

test("a 403 direct then a 403 through the Proxy yields blocked, not offline", async () => {
  const proxied = buildProxyUrl(PROXY, FEED);
  const { fetchImpl } = scriptedFetch({
    [FEED]: new Response("no", { status: 403 }),
    [proxied]: new Response("no", { status: 403 }),
  });
  const fetcher = createFetcher({
    fetch: fetchImpl,
    proxyTemplate: PROXY,
    onLine: () => false,
  });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "blocked");
  assert.equal(error.status, 403);
  assert.equal(error.via, "proxy");
});

test("both attempts throwing while onLine() is false yields offline", async () => {
  const proxied = buildProxyUrl(PROXY, FEED);
  const { fetchImpl, calls } = scriptedFetch({
    [FEED]: corsError(),
    [proxied]: corsError(),
  });
  const fetcher = createFetcher({
    fetch: fetchImpl,
    proxyTemplate: PROXY,
    onLine: () => false,
  });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "offline");
  assert.equal(calls.length, 2);
});

test("both attempts throwing while onLine() is true yields blocked, not offline", async () => {
  // The direct attempt on a cross-origin Feed always throws (CORS), so the
  // throw carries no connectivity information at all. When the Proxy throws
  // too and the browser says we are online, the honest answer is blocked:
  // something between us and the content refused, and telling the reader to
  // reconnect would send them to fix the wrong thing. A rate-limited Proxy
  // reaches here, which is how a dead default Proxy stayed invisible.
  const proxied = buildProxyUrl(PROXY, FEED);
  const { fetchImpl } = scriptedFetch({
    [FEED]: corsError(),
    [proxied]: corsError(),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "blocked");
});

test("a direct 403 then a Proxy that throws yields blocked while online", async () => {
  const proxied = buildProxyUrl(PROXY, FEED);
  const { fetchImpl } = scriptedFetch({
    [FEED]: new Response("no", { status: 403 }),
    [proxied]: corsError(),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "blocked");
  assert.equal(error.status, 403);
});

test("an empty Proxy template yields proxy-unconfigured only after direct fails", async () => {
  const ok = scriptedFetch({ [FEED]: rss() });
  const okFetcher = createFetcher({ fetch: ok.fetchImpl, proxyTemplate: "" });
  const result = await okFetcher.fetchText(FEED);
  assert.equal(result.via, "direct");
  assert.equal(ok.calls.length, 1);

  const blocked = scriptedFetch({ [FEED]: corsError() });
  const fetcher = createFetcher({
    fetch: blocked.fetchImpl,
    proxyTemplate: "",
  });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "proxy-unconfigured");
  assert.equal(blocked.calls.length, 1);
});

test("with no Proxy configured, a direct throw while onLine() is false yields offline", async () => {
  const { fetchImpl } = scriptedFetch({ [FEED]: corsError() });
  const fetcher = createFetcher({
    fetch: fetchImpl,
    proxyTemplate: "",
    onLine: () => false,
  });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "offline");
});

test("a direct timeout yields timeout and aborts the request", async () => {
  const { fetchImpl, calls } = hangingFetch();
  const fetcher = createFetcher({
    fetch: fetchImpl,
    proxyTemplate: PROXY,
    timeoutMs: 20,
  });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "timeout");
  assert.equal(error.via, "direct");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.signal.aborted, true);
});

test("each attempt has its own timeout: a Proxy timeout after a direct CORS error", async () => {
  const hanging = hangingFetch();
  const fetchImpl = (url, init) => {
    if (url === FEED) return Promise.reject(corsError());
    return hanging.fetchImpl(url, init);
  };
  const fetcher = createFetcher({
    fetch: fetchImpl,
    proxyTemplate: PROXY,
    timeoutMs: 20,
  });
  const error = await failure(() => fetcher.fetchText(FEED));
  assert.equal(error.kind, "timeout");
  assert.equal(error.via, "proxy");
  assert.equal(hanging.calls.length, 1);
  assert.equal(hanging.calls[0].init.signal.aborted, true);
});

test("fetchBlob returns the bytes and content type", async () => {
  const image = "https://example.test/pic.jpg";
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const { fetchImpl } = scriptedFetch({
    [image]: new Response(bytes, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchBlob(image, { maxBytes: 1024 });
  assert.equal(result.via, "direct");
  assert.equal(result.blob.size, 5);
  assert.equal(result.blob.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
});

test("fetchBlob streams and aborts once maxBytes is exceeded", async () => {
  const image = "https://example.test/huge.jpg";
  let pulled = 0;
  let cancelled = false;
  const chunk = new Uint8Array(1024);
  // An endless body: without the streaming cap this would never finish.
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const { fetchImpl, calls } = scriptedFetch({
    [image]: new Response(body, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const error = await failure(() =>
    fetcher.fetchBlob(image, { maxBytes: 4 * 1024 }),
  );
  assert.equal(error.kind, "too-large");
  assert.ok(pulled <= 8, `read ${pulled} chunks before giving up`);
  assert.equal(cancelled, true);
  assert.equal(calls[0].init.signal.aborted, true);
});

test("fetchBlob trusts content-length before reading any body", async () => {
  const image = "https://example.test/declared.jpg";
  let pulled = 0;
  // highWaterMark 0: the stream must not pre-fill, so `pulled` counts only
  // what a reader asked for.
  const body = new ReadableStream(
    {
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    },
    { highWaterMark: 0 },
  );
  const { fetchImpl } = scriptedFetch({
    [image]: new Response(body, {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "40000000" },
    }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const error = await failure(() => fetcher.fetchBlob(image, { maxBytes: 1 }));
  assert.equal(error.kind, "too-large");
  assert.equal(pulled, 0);
});

test("fetchBlob without a streaming body checks content-length then blob size", async () => {
  const image = "https://example.test/nostream.jpg";
  const noStream = (bytes, headers) =>
    /** @type {Response} */ ({
      type: "basic",
      status: 200,
      ok: true,
      url: image,
      headers: new Headers(headers),
      body: null,
      blob: async () => new Blob([bytes], { type: "image/jpeg" }),
    });
  const declared = createFetcher({
    fetch: scriptedFetch({
      [image]: noStream(new Uint8Array(10), { "content-length": "5000" }),
    }).fetchImpl,
    proxyTemplate: PROXY,
  });
  assert.equal(
    (await failure(() => declared.fetchBlob(image, { maxBytes: 100 }))).kind,
    "too-large",
  );

  const undeclared = createFetcher({
    fetch: scriptedFetch({ [image]: noStream(new Uint8Array(200), {}) })
      .fetchImpl,
    proxyTemplate: PROXY,
  });
  assert.equal(
    (await failure(() => undeclared.fetchBlob(image, { maxBytes: 100 }))).kind,
    "too-large",
  );

  const small = createFetcher({
    fetch: scriptedFetch({ [image]: noStream(new Uint8Array(50), {}) })
      .fetchImpl,
    proxyTemplate: PROXY,
  });
  const result = await small.fetchBlob(image, { maxBytes: 100 });
  assert.equal(result.blob.size, 50);
});

test("fetchBlob sniffs the real type when the Proxy mislabels it text/plain", async () => {
  // cors-get-proxy (the default Proxy) rewrites every content-type to
  // text/plain, so a Blob built from the header cannot be decoded as an image
  // once the Reader points an <img> at its object URL: every Publication
  // without CORS on its image CDN goes through the Proxy and breaks this way.
  const image = "https://example.test/photo.jpg";
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const { fetchImpl } = scriptedFetch({
    [image]: new Response(jpegBytes, {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchBlob(image, { maxBytes: 1024 });
  assert.equal(result.blob.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), jpegBytes);
});

test("fetchBlob sniffs WEBP (a RIFF container) mislabeled text/plain", async () => {
  const image = "https://example.test/photo.jpg.webp";
  // RIFF <size> WEBP ...
  const webpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2,
  ]);
  const { fetchImpl } = scriptedFetch({
    [image]: new Response(webpBytes, {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchBlob(image, { maxBytes: 1024 });
  assert.equal(result.blob.type, "image/webp");
});

test("fetchBlob rejects a Proxy body with no recognizable image signature instead of storing garbage", async () => {
  // cors-get-proxy sometimes runs binary bodies through a text decode/reencode,
  // replacing every non-ASCII byte with U+FFFD — unrecoverable, not just
  // mistyped. Declared text/plain (the Proxy's own rewrite) plus no signature
  // is the signal; fetchImages already treats a failed fetch as "skip and let
  // the Reader fall back to the network URL", which beats caching corruption.
  const image = "https://example.test/mangled.jpg";
  const proxied = buildProxyUrl(PROXY, image);
  const mangled = new Uint8Array([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd, 1, 2]);
  const { fetchImpl } = scriptedFetch({
    [image]: opaque(),
    [proxied]: new Response(mangled, {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const error = await failure(() =>
    fetcher.fetchBlob(image, { maxBytes: 1024 }),
  );
  assert.equal(error.kind, "blocked");
  assert.equal(error.via, "proxy");
});

test("fetchBlob keeps the declared type when the bytes match no known signature", async () => {
  const image = "https://example.test/mystery";
  const { fetchImpl } = scriptedFetch({
    [image]: new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "image/avif" },
    }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchBlob(image, { maxBytes: 1024 });
  assert.equal(result.blob.type, "image/avif");
});

test("fetchBlob falls through to the Proxy like fetchText", async () => {
  const image = "https://example.test/pic.png";
  const proxied = buildProxyUrl(PROXY, image);
  const { fetchImpl } = scriptedFetch({
    [image]: opaque(),
    [proxied]: new Response(new Uint8Array(3), {
      status: 200,
      headers: { "content-type": "image/png" },
    }),
  });
  const fetcher = createFetcher({ fetch: fetchImpl, proxyTemplate: PROXY });
  const result = await fetcher.fetchBlob(image, { maxBytes: 10 });
  assert.equal(result.via, "proxy");
  assert.equal(result.blob.size, 3);
  assert.equal(result.contentType, "image/png");
});

test("FetchFailure is an Error with kind, url, status and via", () => {
  const error = new FetchFailure("blocked", FEED, {
    status: 403,
    via: "proxy",
  });
  assert.ok(error instanceof Error);
  assert.equal(error.name, "FetchFailure");
  assert.equal(error.kind, "blocked");
  assert.equal(error.url, FEED);
  assert.equal(error.status, 403);
  assert.equal(error.via, "proxy");
  assert.match(error.message, /blocked/);
});
