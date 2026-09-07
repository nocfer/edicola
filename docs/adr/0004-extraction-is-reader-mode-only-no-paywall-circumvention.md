---
status: accepted
---
# Extraction is reader mode, not paywall circumvention

Extraction fetches the Original exactly as an anonymous browser would and runs
Readability plus DOMPurify on what the server returned. That removes adverts,
navigation and client-side overlays, and it recovers the full text of Items
from Truncated Feeds. It does not, and must not, try to obtain content the
publisher withheld: no user-agent spoofing, no cookie tricks, no archive or
cache lookups, no referrer games. When Extraction yields little or nothing, the
Item stays Summary-only and the UI says plainly that the publisher does not send
the full Article to non-subscribers, with a link to the Original.

## Consequences

- The Reader always shows the Publication name and a link to the Original.
- Edicola never presents itself as the publisher of the content.
- Feature requests for "unlock" behaviour are declined by reference to this
  decision.
