---
status: accepted
---
# A pre-seeded Catalog by Nation, not a subscription list; no OPML

Edicola is a newsstand, not an RSS client. Readers toggle Publications in a
Catalog that ships with the app, grouped by Nation then Category, and the
Catalog grows through pull requests. Custom Publications by URL are supported
but secondary. We deliberately do not import or export OPML: there is no
account and no subscription concept to port, and OPML would pull the product
toward the power-user reader we chose not to build. The seed Catalog covers
Italy and the United Kingdom; adding a Nation is a data change.

## Consequences

- Catalog entries carry `country`, `language`, `category`, `name`, `feedUrl`,
  `siteUrl` and a `truncated` flag.
- Only publicly advertised Feeds are listed. A weekly CI job parses every
  Catalog Feed and opens an issue for any that fail.
- Clearing site data loses Enabled Publications and read state. That is
  accepted; there is nothing to sync it to.
