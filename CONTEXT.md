# Edicola

An offline-first news reader. A reader picks Publications from a Catalog
organised by Nation, and the app fetches their full Articles so they can be read
with no connection. There is no account and no server of our own: the browser
talks to publishers directly.

## Language

Each entry's `_Avoid_` line lists what **not to call that term** — not words
banned from the codebase. "Story" is the wrong name for an Item and the right
name for a reel; "card" is the wrong name for a Frame and the right name for a
row in Feed mode; an Item is never "a headline", though the title a card sets
large is called the headline, as the design does. When two entries seem to
collide, this is why.

### Sources

**Publication**:
A news source that exposes a Feed: a newspaper, magazine, or blog.
_Avoid_: source, site, subscription, magazine, channel

**Catalog**:
The curated list of Publications shipped with the app, maintained by the
community.
_Avoid_: directory, registry, preset list

**Logo**:
The publisher's own icon. A Publication has a short list of places to find one,
best first: the URL a human put in its Catalog entry, then two conventional
paths at its site. A Publication shows its **monogram** when none of them
arrives, or when what arrives is too small to read.
_Avoid_: favicon, icon, brand, avatar

**Nation**:
The country a Publication belongs to. Readers choose which Nations appear in
their Catalog view.
_Avoid_: country, region, market, locale

**Category**:
The editorial section a Publication is filed under within a Nation, such as
news, politics, technology, culture, sport.
_Avoid_: topic, section, tag, genre

**Enabled Publication**:
A Publication the reader has switched on. Only Enabled Publications take part
in a Sync.
_Avoid_: subscribed, followed, active, selected

**Custom Publication**:
A Publication the reader added by URL that is not in the Catalog.
_Avoid_: manual feed, user feed

**Feed**:
The machine-readable document a Publication publishes (RSS, Atom, RDF or JSON
Feed) listing its recent Items.
_Avoid_: channel, stream, XML

**Truncated Feed**:
A Feed whose Items carry only a Summary, so an Article must be fetched from the
Original.
_Avoid_: partial feed, excerpt feed

### Content

**Item**:
One entry in a Feed: title, link to the Original, publication date, and usually
a Summary.
_Avoid_: post, entry, story, headline, article

**Summary**:
The short excerpt a Feed carries for an Item.
_Avoid_: description, excerpt, teaser, snippet

**Original**:
The publisher's own web page for an Item.
_Avoid_: source page, link, canonical

**Article**:
The full readable text and images of an Item, taken from the Original by
Extraction.
_Avoid_: full text, content, body, page

**Extraction**:
Turning an Original into an Article: keeping the readable text and images,
dropping navigation, adverts and overlays. Extraction never uses anything the
publisher did not send to an anonymous visitor.
_Avoid_: scraping, parsing, readability, cleaning

**Summary-only Item**:
An Item that has no Article, because Extraction has not run, failed, or
yielded too little. It is shown with its Summary and a link to the Original.
_Avoid_: failed item, stub, partial item

### Reading

**Today**:
The home screen: the Items of all Enabled Publications, newest first, in one of
two View Modes. It is one screen with two presentations, never two screens.
_Avoid_: feed, home, timeline, inbox

**View Mode**:
How Today presents its Items. **List** is the day-grouped timeline of compact
rows; **Feed** is a row of Story rings above one column of full-bleed post
cards. Both show the same Items inside the same Retention window and share the
same Unread counts.
_Avoid_: layout, density, style, skin

**Story**:
One Publication's tap-through reel of its Unread Items, newest first, opened
from its ring in Feed mode. It never advances by itself.
_Avoid_: reel, slideshow, carousel, stories

**Frame**:
One screen of a Story: one Item.
_Avoid_: slide, page, card

**Seen**:
A Frame showed this Item. Distinct from Read, which only the Reader sets: a
ring dims once its whole reel is Seen, while Unread counts move only on Read.
_Avoid_: viewed, looked at, opened

**Cover**:
The generated stand-in for an Item with no usable photo: one flat fill from a
fixed eight-colour ramp, the Publication's monogram, and the headline set
large. A Cover is deliberate, not a placeholder for a failure.
_Avoid_: placeholder, fallback image, thumbnail, gradient

**Monogram**:
One or two initials derived from a Publication's name, over its flat fill. It
fills the small circles — the ring, the card header, the Story header — for a
Publication whose **logo** the Catalog does not carry, and a Cover always.
_Avoid_: initials, avatar, badge

**Reader**:
The screen that shows one Article.
_Avoid_: article view, detail, viewer, page

**Read / Unread**:
Whether the reader has opened an Item in the Reader. Opening marks it Read;
scrolling past it does not.
_Avoid_: seen, viewed, consumed

**Saved**:
An Item the reader has marked to keep. A Saved Item and its Article are never
Evicted.
_Avoid_: starred, bookmarked, favourite, pinned, read later

**Reading Position**:
How far into an Article the reader had scrolled when they last left it.
_Avoid_: scroll offset, progress, bookmark

**Language**:
The language of the app's own interface, English or Italian. Independent of
which Nations are chosen.
_Avoid_: locale, region, nation

### Keeping content fresh and bounded

**Sync**:
One refresh pass: fetch every Enabled Publication's Feed, store new Items, then
Pre-fetch their Articles.
_Avoid_: refresh, update, poll, download, fetch all

**Pre-fetch**:
Extraction performed during a Sync, ahead of the reader opening the Item, so it
is available offline.
_Avoid_: caching, background download, prefetching images

**Proxy**:
A relay the app sends a request through when the browser cannot reach a Feed or
Original directly. The reader may supply their own.
_Avoid_: CORS proxy, backend, server, API

**Retention**:
The limits that decide how long Items and Articles are kept: an age, a total
size, and a per-Publication count.
_Avoid_: TTL, quota, limits, cache policy

**Eviction**:
Dropping Items and Articles that fall outside Retention. Saved Items are exempt.
_Avoid_: cleanup, purge, garbage collection, pruning

**Shell**:
The app's own files, cached so the app opens with no connection. Distinct from
content, which lives in the reader's database.
_Avoid_: bundle, assets, static files, app cache
