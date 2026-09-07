# Running your own Proxy

Most publishers serve their Feeds with no CORS headers, so a browser is not
allowed to read them from a page it did not come from. Edicola tries the
publisher directly first and falls back to a relay for everything the browser
refuses ([ADR-0001](adr/0001-no-backend-direct-fetch-with-proxy-fallback.md)),
which in practice is most of the Catalog.

The relay a fresh install points at is a small public Cloudflare Worker,
`https://cors-get-proxy.sirjosh.workers.dev/?url={url}`. It works, and it is
somebody else's free side project: it sees every URL you fetch, it can
rate-limit you, and it can vanish. This page replaces it with one of your own.
The Worker below is the whole thing, it runs on Cloudflare's free plan, and it
answers only to your copy of Edicola.

## The Worker

Forward one GET, add the CORS headers the publisher omitted, keep the
publisher's `content-type`, and refuse everything else.

```js
// An Edicola relay. Forwards a single GET to the URL in ?url= and returns it
// with the CORS headers the publisher did not send. Answers only to the
// origins listed here.
const ALLOWED_ORIGINS = [
  "https://your-name.github.io", // wherever you serve Edicola from
  "http://localhost:8000", // npm start, for development
];

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = ALLOWED_ORIGINS.includes(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: corsHeaders(origin, allowed),
      });
    }
    if (request.method !== "GET") {
      return new Response("This relay only forwards GET.", { status: 405 });
    }
    if (!allowed) {
      return new Response("Origin not allowed.", { status: 403 });
    }

    const target = new URL(request.url).searchParams.get("url");
    let upstreamUrl;
    try {
      upstreamUrl = new URL(target ?? "");
    } catch {
      return new Response("Pass the address to fetch as ?url=", {
        status: 400,
        headers: corsHeaders(origin, true),
      });
    }
    if (upstreamUrl.protocol !== "https:" && upstreamUrl.protocol !== "http:") {
      return new Response("Only http and https can be fetched.", {
        status: 400,
        headers: corsHeaders(origin, true),
      });
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl.toString(), {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": "Edicola reader (personal relay)",
          accept: "*/*",
        },
      });
    } catch (error) {
      return new Response(`Upstream request failed: ${error}`, {
        status: 502,
        headers: corsHeaders(origin, true),
      });
    }

    const headers = new Headers(corsHeaders(origin, true));
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function corsHeaders(origin, allowed) {
  /** @type {Record<string, string>} */
  const headers = {
    "access-control-allow-methods": "GET, OPTIONS",
    vary: "Origin",
  };
  if (allowed) headers["access-control-allow-origin"] = origin;
  return headers;
}
```

Notes on what it deliberately does not do:

- **No timeout.** Edicola's own fetcher aborts each attempt after fifteen
  seconds, so a hanging publisher is already handled on the reader's side, and
  Cloudflare enforces its own limits on a subrequest.
- **No caching.** Feeds change, and a Sync is already rate-limited by the
  fifteen-minute staleness rule.
- **No response-size cap.** The reader's fetcher caps images at 5 MB per
  Article and aborts the body itself when a response runs over.
- **It streams the body through** (`upstream.body`) instead of buffering it,
  which keeps a large Article cheap.
- **It keeps the publisher's `content-type`.** The default relay rewrites every
  response to `text/plain`; Edicola copes with that because it sniffs the
  document, but your own relay has no reason to lie.

## Deploying it

The dashboard route needs nothing installed.

1. Sign in at <https://dash.cloudflare.com> and open **Workers & Pages**.
2. Create a Worker from the starter template (the "Hello World" one; the label
   moves around between dashboard redesigns), name it something like
   `edicola-relay`, and deploy it as it is.
3. **Edit code**, replace the template with the Worker above, and put your own
   origins in `ALLOWED_ORIGINS`. An origin is scheme, host and port with no
   path: `https://your-name.github.io`, not
   `https://your-name.github.io/edicola/`.
4. **Deploy** again. The Worker is now live at
   `https://edicola-relay.<your-subdomain>.workers.dev`.

If you would rather work from a file, save the Worker as `src/index.js` next to
a `wrangler.toml` naming the same Worker, then run `npx wrangler deploy`.
Wrangler's scaffolding commands change between major versions, so follow
Cloudflare's current getting-started page for the layout rather than this one.

Cloudflare's free plan is sized for exactly this kind of thing, but the numbers
move, so check their current limits if you plan to point a household at one
Worker. A single reader's Syncs are nowhere near them.

## Pointing Edicola at it

In the app: **Settings → Proxy → Your own relay**. Paste the template,
substituting your own subdomain:

```
https://edicola-relay.<your-subdomain>.workers.dev/?url={url}
```

`{url}` is where the address to fetch goes, and it is required: Edicola
percent-encodes the target URL and substitutes it there, which is why the
Worker reads it back with `searchParams.get("url")`. The scheme must be
`https` (plain `http` is accepted only on `localhost`, because a mixed-content
relay would be blocked by the browser anyway).

Press **Test**. It follows the same path a Sync does, direct first and then the
relay, against one known Feed, and reports the size of what came back. Save,
and the next Sync uses your relay. Nothing else changes, and you can return to
the default at any time with **Use the default**.

To check it from a terminal instead:

```
curl -i -H 'Origin: https://your-name.github.io' \
  'https://edicola-relay.<your-subdomain>.workers.dev/?url=https%3A%2F%2Ffeeds.bbci.co.uk%2Fnews%2Frss.xml' \
  | head -20
```

You should see `200`, `access-control-allow-origin` echoing your origin, and
the start of an RSS document. The same request without the `Origin` header
should come back `403`.

## What the Origin check does and does not buy you

An open relay is a liability: anyone who finds the URL can use your account's
quota to fetch anything, and the requests come from your Worker. The origin
allowlist means a web page on some other site cannot use it, because the
browser puts the calling page's origin in the request and refuses the response
when the relay does not name it back.

It stops there. `Origin` is a header, and any script outside a browser can send
whatever it likes, so the check is not authentication. If you need more than
that, put a shared secret in the query string and check it in the Worker, or
bind the Worker to a route on a domain only you use. For a personal reader the
allowlist is usually enough, and it is a large improvement on a relay open to
the whole web.

One consequence of how origins work is worth knowing before you pick a host: an
origin covers a whole host, so `https://your-name.github.io` in the allowlist
also covers every other project you publish on that github.io subdomain. If
that matters to you, serve Edicola from a domain of your own.

## When something does not work

- **Every Feed fails, direct and through the relay.** Check the Worker in
  Cloudflare's dashboard log with the `curl` above. A `403` means the origin in
  `ALLOWED_ORIGINS` does not match the one your browser sends; compare it with
  what the browser's network panel shows in the request's `Origin` header.
- **The Test button says the Feed was reachable without a relay.** That is not
  a failure. The test Feed answered directly, so the relay was not exercised;
  it will be as soon as a publisher blocks the direct request.
- **Some Publications still fail with your relay.** A few publishers answer
  403, 406 or 402 to anything that is not a browser, and no relay fixes that.
  `docs/catalog.md` lists the ones we know about and what each of them does.
