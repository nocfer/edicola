Design a **Feed View Mode** for Edicola, an offline-first news reader PWA.

Edicola has no account, no backend and no server: the browser fetches Feeds and
Articles from publishers directly and stores them in IndexedDB, so everything
already fetched reads with no connection. Its home screen, **Today**, is
currently a single chronological list of headlines grouped under sticky day
headers. I want a second presentation of that same screen that borrows
Instagram's grammar — a row of story rings, full-bleed post cards, an action bar
— so that news feels approachable to someone who finds a wall of headlines
intimidating.

**The goal is approachability, not accessibility.** Do not add ARIA plumbing,
skip links or accessibility annotations to these artboards. Do design so nothing
regresses: no text over a photo without a scrim behind it, no timed
auto-advancing anything, no action that exists only as a hidden gesture, and
touch targets no smaller than 44px.

## Vocabulary — use these words in every label and annotation

These are Edicola's own terms. Do not substitute synonyms.

- **Publication** — a news source that exposes a Feed. Never "source", "site",
  "subscription", "channel", "account".
- **Enabled Publication** — one the reader has switched on. Never "followed",
  "subscribed".
- **Item** — one entry in a Feed: title, link, date, usually a Summary. Never
  "post", "story", "article", "headline".
- **Summary** — the short excerpt a Feed carries for an Item. Never "excerpt",
  "teaser", "snippet", "description".
- **Article** — the full readable text and images, extracted from the
  publisher's page. Never "full text", "body", "content".
- **Summary-only Item** — an Item with no Article, because extraction failed or
  yielded too little. Shown with its Summary and a link out.
- **Today** — the home screen. Never "feed", "home", "timeline", "inbox" *as a
  name for the screen*; "Feed" below is only the name of a View Mode.
- **Reader** — the full-screen screen that shows one Article.
- **Saved** — an Item the reader marked to keep. Never "starred", "bookmarked",
  "favourite", "liked".
- **Read / Unread** — whether the reader opened the Item in the **Reader**.
- **Retention** — the limits deciding how long Items are kept: an age, a size,
  a per-Publication count.

Four terms are new to this design:

- **View Mode** — how Today presents its Items. Two values: **List** (what
  exists today) and **Feed** (what you are designing). One toggle switches them.
- **Story** — one Publication's tap-through reel of its Unread Items, opened
  from its ring. Newest first.
- **Frame** — one screen of a Story: one Item.
- **Seen** — a Frame was shown. Distinct from **Read**, which only the Reader
  sets. Rings dim on Seen; Unread counts only fall on Read.
- **Cover** — the generated image stand-in for an Item with no usable photo:
  a flat colour from a fixed ramp, the Publication's monogram, and the headline
  set large.

## Design tokens — the only legal values

Edicola's stylesheet is token-only: no rule types a raw colour, space, radius or
font where a token exists. **Dark is the default theme.** Light is the single
theme-scoped block. Use these exact values and add nothing outside the system.

Dark (bare `:root`):
```
--bg #121110      page background
--surface #1a1816 header bars, tab bar
--card #1f1c1a    cards, list rows
--card-shadow none
--hairline rgba(255,255,255,.08)
--text #f3efe9    --muted #a39c93   --faint #7d766f
--accent #e0563a  newsstand red: primary action, active tab
--accent-ink #fff8f3   --link #ff8a6a   --focus #ffb59e
--chip-bg rgba(255,255,255,.06)  --chip-on-bg var(--text)  --chip-on-fg var(--bg)
--tabbar-bg rgba(26,24,22,.92)
```

Light (`:root[data-theme='light']`):
```
--bg #faf7f2  --surface #fffdf9  --card #ffffff
--card-shadow 0 2px 10px -6px rgba(60,40,20,.18)
--hairline rgba(28,25,23,.09)
--text #1c1917  --muted #6b645d  --faint #928a82
--accent #c8422a  --accent-ink #fff8f3  --link #a83a24  --focus #c8422a
--chip-bg rgba(28,25,23,.05)  --tabbar-bg rgba(255,253,249,.92)
```

Type — system stacks only, no webfonts:
```
--font-ui system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
--font-display ui-serif, Georgia, "Times New Roman", serif
--fs-caption .8125rem  --fs-body 1rem  --fs-lead 1.125rem  --fs-title 1.75rem
--lh-body 1.5  --lh-tight 1.15
```

Space (4px scale) `--s-1 4 · --s-2 8 · --s-3 12 · --s-4 16 · --s-5 20 · --s-6 24 · --s-8 32`
Radii `--r-pill 999px (chips, icon buttons) · --r-control 12px · --r-card 16px`
Layout `--measure 720px max content column · --tabbar-h 56px`
Motion `--dur-fast .12s · --dur .2s · --ease cubic-bezier(.2,.7,.2,1)`

**One addition you must design:** a `--cover-1` … `--cover-8` ramp for Covers,
in both themes. Eight flat fills, each legible under `--accent-ink` text at
`--fs-title`, each sitting comfortably beside the warm newsstand palette above.
A Publication picks its index by hashing its id, so thirty Publications share
eight colours — the monogram is what disambiguates them.

## What Feed mode is made of

**Header.** Today's existing header, plus a two-icon segmented control (list /
feed) beside the refresh control. Below it the existing status line — "Last
refreshed 4 minutes ago" — and the sync progress bar when a refresh runs.

**The rings row.** Replaces List mode's filter chip row; same vertical space,
one horizontal scroller. One ring per Enabled Publication, with the name beneath
it, truncated. Publications have no logos, so every ring is a **monogram**: one
or two initials from the name, in `--accent-ink`, on the Publication's Cover
colour. Three states, and they must be distinguishable at a glance without
relying on colour alone:

- **Unseen** — the Publication has Unread Items. Ring highlighted.
- **Seen** — every Item in the reel has been Seen. Ring dimmed.
- **No reel** — nothing Unread. Flattest state; tapping it filters the feed
  instead of opening a Story.

Long-press or a small ⋯ affordance opens a menu with "Show only this
Publication" and "Mark all read".

**Post cards.** One column, full-bleed within `--measure`, `--r-card`. Each card:

1. A header row — the Publication's monogram at ~32px, its name, and the Item's
   relative time ("2h", "yesterday"), plus an unread dot when Unread.
2. The image, 4:5 or 1:1. Three variants you must draw:
   - a real photo from the publisher;
   - a **Cover**: flat `--cover-n`, large monogram watermark, headline set in
     `--font-display` at `--fs-title` over it;
   - a photo with a Summary-only badge, because half of Edicola's Catalog gives
     Summaries only.
3. An action bar: **Save** (bookmark), **Share** (paper plane), **Original**
   (outbound link). Icon-only, `--r-pill` hit areas, Save filled when Saved.
4. The headline in `--font-display`, then the Summary in `--font-ui` at
   `--fs-body`, clamped to about three lines.

**No likes. No comments. No view counts, like counts or follower counts.** There
is no server to send them to and no one to show them to; a heart that only its
owner sees is a button whose function is to look like a button. Do not invent
engagement numbers anywhere on these artboards.

**No sticky day headers** in Feed mode — each card's relative time does that
work. The feed ends with a centred end card: "You're all caught up · showing the
last 30 days", which is honest, because the feed genuinely stops at the
Retention window rather than at the beginning of time.

**The Story player.** Full-screen, over everything, tab bar hidden.

- Position pips across the top — segments, one per Frame, filled up to the
  current one. **They are a position indicator, never a countdown.** Nothing
  advances by itself.
- The Publication's monogram, its name, the Item's relative time, and a close ×.
- The Frame body: the Item's image or its Cover, full-bleed with a scrim, the
  headline in `--font-display` at `--fs-title`, the Summary beneath it.
- A visible **"Read"** button at the foot — not only a swipe-up. Show the
  swipe-up chevron above it as the familiar hint, but the button is the real
  affordance.
- Advance by tapping the right or left third; close by swiping down or pressing ×.

## Artboards

Thirteen, at 390×844, in this order. Dark theme, English, unless the name says
otherwise.

1. **Feed — populated.** Rings row showing all three ring states, then three
   cards: a photo card, a Cover card, and a Summary-only card. Tab bar visible.
2. **Feed — offline.** Same feed with the offline indicator; most cards are now
   Covers, because un-stored photos cannot load. This artboard has to prove that
   a Cover-dominant feed looks deliberate rather than broken. This is the
   artboard that decides whether the whole design survives.
3. **Feed — end of feed.** The last two cards plus the "all caught up" end card.
4. **Feed — empty, no Enabled Publications.** Rings row absent, an invitation to
   choose Publications.
5. **Feed — refreshing.** Pull-to-refresh released, progress bar running,
   partially-filled feed.
6. **Story — first Frame.** Photo, pips at position 1 of 6, Read button.
7. **Story — Cover Frame.** Same player, Item with no photo, Summary-only badge.
8. **Story — last Frame.** Pips full, and whatever tells the reader the reel is
   finished and returns them to the feed.
9. **Rings row — component sheet.** Unseen, Seen, no-reel, long-press menu open,
   and the row mid-scroll. Annotate what each state means.
10. **Cover ramp — component sheet.** All eight `--cover-n` in dark and in
    light, each with a monogram and a headline over it, so the contrast is
    checkable at a glance.
11. **List mode, for comparison.** Today as it exists — day headers, compact
    rows, small right-hand thumbnails, filter chips — with the new segmented
    control in the header set to list. This is what Feed mode has to beat.
12. **Feed — populated, light theme.** Artboard 1 again with light tokens.
13. **Feed — populated, Italian.** Artboard 1 again in Italian. Italian copy
    runs 15–25% longer than English; if a label wraps or truncates here, fix the
    layout rather than the copy.

## Content — use these real Publications

Realistic mock content, no lorem ipsum, no "Publication One".

Italian: ANSA, la Repubblica, La Stampa, Il Sole 24 Ore, Wired Italia, Focus,
Corriere dello Sport, Rivista Studio.
British: BBC News, The Guardian, The Independent, Nature, London Review of
Books, TechRadar, Manchester Evening News, BBC Sport.

Monograms to check: **ANSA** and **la Repubblica** and **Il Sole 24 Ore** are
the hard cases — an all-caps acronym, a lowercase article, and a name with
digits. Whatever monogram rule you draw has to handle all three without looking
accidental.

Headlines should read like real news in the Publication's own register — ANSA
terse and wire-like, London Review of Books long and essayistic — because a
uniform headline length will hide exactly the layout problems I need to see.

## Constraints, restated because they are easy to lose

- Dark is the default, not an alternate. Design dark first.
- System fonts only. No webfont, no icon font — icons as inline SVG.
- Every colour, space and radius from the token list, plus the `--cover-n` ramp
  you are adding. Nothing else.
- No likes, comments, counts or invented engagement numbers.
- Nothing timed, nothing auto-advancing, no gesture without a visible twin.
- The Publication monogram is the identity everywhere. No logos, no favicons,
  no flags.
