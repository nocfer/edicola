# 04 — Fetcher: one way to reach a Feed or Original, direct first then through the Proxy

**What to build:** The single module every content request goes through
(ADR-0001). It tries a direct fetch, and on a CORS-shaped or network failure
retries through a configurable Proxy. It has a timeout, a byte cap for blobs,
and distinguishes "offline" from "blocked" so the UI can say the right thing.
No UI.

**Blocked by:** None — can start immediately.

**Status:** done

**Owns:** `src/fetcher.js`, `test/fetcher.test.js`.

- [x] `createFetcher({ fetch, proxyTemplate, timeoutMs = 15000, onLine = () => true })` returns `{ fetchText(url), fetchBlob(url, { maxBytes }) , probe(url) }`.
- [x] `proxyTemplate` is a string containing `{url}`, replaced with the percent-encoded target. Export `DEFAULT_PROXY_TEMPLATE` pointing at a public CORS proxy you have verified works with `curl` for a real feed today, with a comment naming the service and the date verified. Export `buildProxyUrl(template, url)`.
- [x] Order: direct `fetch(url, { mode: 'cors', redirect: 'follow', signal })`. If it throws (the browser surfaces CORS as a `TypeError`), or returns an opaque response, or a 401/403/429/5xx, retry once through the Proxy. A 404 is not retried. Return `{ text | blob, finalUrl, via: 'direct' | 'proxy', status, contentType }`.
- [x] Failure is a `FetchFailure` error with `kind` in `'offline' | 'blocked' | 'not-found' | 'too-large' | 'timeout' | 'proxy-unconfigured'`. `offline` when `onLine()` is false or both attempts throw without any response.
- [x] `fetchBlob` streams and aborts once `maxBytes` is exceeded (`too-large`), so a 40 MB image cannot fill storage. When streaming is unavailable, fall back to checking `content-length` then the resulting blob size.
- [x] Timeout via `AbortController` on each attempt independently.
- [x] Tests inject a fake `fetch` that scripts responses per URL and assert: direct success is not proxied; a TypeError falls through to the Proxy with the correctly encoded URL; 403 falls through, 404 does not; both failing while `onLine()` is false yields `offline`; oversized blob yields `too-large`; timeout yields `timeout`; an empty proxy template yields `proxy-unconfigured` only after direct fails.
- [x] Gates green.

## Notes

### Exported interface (`src/fetcher.js`, named exports only)

```js
createFetcher({
  fetch = (input, init) => globalThis.fetch(input, init),
  proxyTemplate = DEFAULT_PROXY_TEMPLATE, // "" disables the Proxy
  timeoutMs = 15000,
  onLine = () => true,
} = {}): Fetcher

Fetcher = {
  fetchText(url): Promise<FetchTextResult>,
  fetchBlob(url, { maxBytes = DEFAULT_MAX_BLOB_BYTES } = {}): Promise<FetchBlobResult>,
  probe(url): Promise<FetchResultMeta>,
}

buildProxyUrl(template, url): string   // throws FetchFailure("proxy-unconfigured") if template lacks "{url}"

class FetchFailure extends Error {
  kind: "offline" | "blocked" | "not-found" | "too-large" | "timeout" | "proxy-unconfigured";
  url: string;            // the URL the caller asked for, never the Proxy URL
  status?: number;        // HTTP status of the attempt that decided the failure, if any
  via?: "direct" | "proxy";
  cause?: unknown;        // the underlying thrown error, if any
}

DEFAULT_PROXY_TEMPLATE = "https://cors-get-proxy.sirjosh.workers.dev/?url={url}"
DEFAULT_PROXY_SERVICE  = "cors-get-proxy (Cloudflare Worker)"  // for Settings (ticket 12)
DEFAULT_MAX_BLOB_BYTES = 5 * 1024 * 1024
```

Result shapes (JSDoc typedefs in the module):

```js
FetchResultMeta = { finalUrl: string, via: "direct" | "proxy", status: number, contentType: string }
FetchTextResult = FetchResultMeta & { text: string }
FetchBlobResult = FetchResultMeta & { blob: Blob }   // blob.type is the response content-type
```

`finalUrl` is `response.url` (after redirects) for a direct fetch; through the
Proxy the upstream URL is not observable, so it is the requested URL.
`contentType` is the raw header, `""` when absent.

### Default Proxy, verified 2026-09-07

`https://cors-get-proxy.sirjosh.workers.dev/?url={url}`, a public Cloudflare
Worker (source: https://github.com/SirJosh3917/cors-get-proxy). Curl returned
HTTP 200, `access-control-allow-origin: *` and the real RSS document for both
`https://feeds.bbci.co.uk/news/rss.xml` and
`https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml`, with and without
an `Origin` header. Caveat: it rewrites `content-type` to `text/plain`.

This is the weak spot of the ticket and the integrator should know why. Every
service the ticket suggested was unusable on the verification day:
`corsproxy.io` now requires an API key (401 / 403 "keyless legacy URLs no
longer supported"); `api.allorigins.win` and `api.codetabs.com` answered
Cloudflare 522 for twenty minutes; `api.cors.lol` (keyless, free tier) answered
429 "Rate limit exceeded" to every request, including the very first one;
`cors.redoc.ly` did return the feed with CORS headers and the original
`content-type`, but it is Redocly's product relay, not a service offered to the
public, so it was not chosen. The default is one constant; swapping it is a
one-line change. The README self-hosting section (ticket 13) matters more than
the spec assumed.

### Decisions the ticket left open

- 410 is treated like 404 (`not-found`, no retry). Any other non-2xx status
  not in the retry set (400, 405, 451, ...) is `blocked` without a Proxy retry.
- A 404 (or 410) returned by the Proxy is `not-found`; any other non-2xx from
  the Proxy is `blocked` with that status.
- `timeout` and `too-large` are final: a direct timeout does not fall through
  to the Proxy. The per-attempt timer keeps running while the body is read, so
  a stalled body is also a `timeout`.
- A network error while reading the body (after headers) is `offline` when
  `onLine()` is false, otherwise `blocked`.
- `onLine()` is a tiebreaker, not a short-circuit: the direct attempt is always
  made. With both attempts throwing, the result is `offline` regardless of
  `onLine()`. With the Proxy unconfigured and the direct attempt throwing while
  `onLine()` is false, the result is `offline` rather than
  `proxy-unconfigured`.
- `proxyTemplate` omitted means `DEFAULT_PROXY_TEMPLATE`; `""` (or a string
  without `{url}`) means unconfigured.
- `probe(url)` performs a GET through the same direct-then-Proxy flow and aborts
  the body after the headers; HEAD is not used because relays and many
  publishers do not support it.
- `fetchBlob` checks `content-length` before reading, then streams and cancels
  the reader and aborts the request the moment the running total exceeds
  `maxBytes`; without a readable body it falls back to `content-length` then
  `blob.size`.
- The `fetch` init is exactly `{ mode: "cors", redirect: "follow", signal }`.

### Not verified

- Behaviour in a real browser (only Node's `fetch`/`Response`/`ReadableStream`
  via scripted fakes; no real network in tests).
- Whether the default relay preserves the publisher's HTTP status codes on
  failure; it did preserve 200.
