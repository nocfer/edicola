# 04 — Fetcher: one way to reach a Feed or Original, direct first then through the Proxy

**What to build:** The single module every content request goes through
(ADR-0001). It tries a direct fetch, and on a CORS-shaped or network failure
retries through a configurable Proxy. It has a timeout, a byte cap for blobs,
and distinguishes "offline" from "blocked" so the UI can say the right thing.
No UI.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Owns:** `src/fetcher.js`, `test/fetcher.test.js`.

- [ ] `createFetcher({ fetch, proxyTemplate, timeoutMs = 15000, onLine = () => true })` returns `{ fetchText(url), fetchBlob(url, { maxBytes }) , probe(url) }`.
- [ ] `proxyTemplate` is a string containing `{url}`, replaced with the percent-encoded target. Export `DEFAULT_PROXY_TEMPLATE` pointing at a public CORS proxy you have verified works with `curl` for a real feed today, with a comment naming the service and the date verified. Export `buildProxyUrl(template, url)`.
- [ ] Order: direct `fetch(url, { mode: 'cors', redirect: 'follow', signal })`. If it throws (the browser surfaces CORS as a `TypeError`), or returns an opaque response, or a 401/403/429/5xx, retry once through the Proxy. A 404 is not retried. Return `{ text | blob, finalUrl, via: 'direct' | 'proxy', status, contentType }`.
- [ ] Failure is a `FetchFailure` error with `kind` in `'offline' | 'blocked' | 'not-found' | 'too-large' | 'timeout' | 'proxy-unconfigured'`. `offline` when `onLine()` is false or both attempts throw without any response.
- [ ] `fetchBlob` streams and aborts once `maxBytes` is exceeded (`too-large`), so a 40 MB image cannot fill storage. When streaming is unavailable, fall back to checking `content-length` then the resulting blob size.
- [ ] Timeout via `AbortController` on each attempt independently.
- [ ] Tests inject a fake `fetch` that scripts responses per URL and assert: direct success is not proxied; a TypeError falls through to the Proxy with the correctly encoded URL; 403 falls through, 404 does not; both failing while `onLine()` is false yields `offline`; oversized blob yields `too-large`; timeout yields `timeout`; an empty proxy template yields `proxy-unconfigured` only after direct fails.
- [ ] Gates green.
