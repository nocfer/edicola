---
status: accepted
---
# No backend: the browser fetches Feeds and Originals directly, with a Proxy fallback

Edicola ships no server of its own. The browser requests each Feed and Original
directly; when CORS blocks that (most publishers), it retries through a
configurable Proxy. A public proxy is the default so first run works, and the
reader can replace it with their own endpoint from Settings. We accepted the
dependency on a third-party relay rather than run infrastructure, because the
product promise is "nothing to sign up for, nothing to host, nothing to pay."

## Considered options

- Host our own proxy: cleanest privacy story, but it is a backend with uptime,
  cost and abuse concerns, and it makes the project unforkable without ops.
- Direct fetch only: honest, but the majority of Feeds fail and the app feels
  broken.

## Consequences

- Every network request goes through one fetcher that tries direct first, then
  the Proxy. Nothing else in the codebase calls `fetch` for content.
- The default public proxy sees the reader's requests. Settings must make the
  override discoverable, and the README documents a one-click self-hosted
  worker.
- Rate limits on the shared proxy shape the Sync caps (see the spec).
