# Feed View Mode

Today gains a second presentation — **Feed** — alongside the list it has now.
Same Items, same Retention window, same Unread counts; a different shape,
borrowed from Instagram: a row of Story rings, full-bleed post cards, an action
bar. The goal is **approachability**: news that does not read as a wall of
headlines to someone who finds a wall of headlines off-putting.

The goal is not WCAG accessibility. Nothing here may *regress* it — no text on
a photo without a scrim, nothing timed, no gesture without a visible twin,
44px targets — but "more accessible" in this feature means "less intimidating".

## Sources of truth

- **Design bundle:** `docs/designs/photo-treatment-and-cover-ramp/` — thirteen
  artboards at 390×844 in `project/Feed View Mode.dc.html`. Read it in full.
  Values are hardcoded hexes there because the prototype medium has no tokens;
  in the implementation they become tokens.
- **Design brief:** `docs/feed-view-mode-design-prompt.md` — the vocabulary,
  the token list, and the rejected alternatives, written before the design.

## Vocabulary (add to CONTEXT.md when this lands)

- **View Mode** — how Today presents its Items. `list` or `feed`.
- **Story** — one Publication's tap-through reel of its Unread Items, newest
  first, opened from its ring.
- **Frame** — one screen of a Story: one Item.
- **Seen** — a Frame was shown. Distinct from **Read**, which only the Reader
  sets. Rings dim on Seen; Unread counts only fall on Read.
- **Cover** — the generated stand-in for an Item with no usable photo: a flat
  `--cover-n` fill, the Publication's monogram, the headline set large.

**CONTEXT.md conflict to resolve:** Today is currently defined as "a single
timeline of Items from all Enabled Publications, newest first, grouped by day".
After this feature that is one of two shapes. Amend the definition in the same
commit as ticket 02, and grep `CONTRIBUTING.md` for anything that repeats it.

## Decisions already settled (do not relitigate)

1. Two View Modes of one Today screen — one route, one `today-model.js`, two
   templates. Not a second screen, not a density option.
2. The toggle is a segmented control in Today's header beside refresh.
   Persisted in `localStorage` as `edicola.viewmode`. **Today only** — Saved
   and Reader are untouched. Saved-as-grid is a possible follow-up, not this.
3. Rings **replace** the filter chip row in Feed mode. Tap opens the Story;
   long-press / ⋯ opens the menu that exists now (filter, mark all read).
4. A reel is that Publication's **Unread** Items inside Today's window,
   newest first.
5. A Frame marks **Seen**, never Read. Only the Reader marks Read.
6. Manual advance only. Pips show position, never a countdown. Nothing
   auto-advances.
7. A Frame carries cover + headline + Summary + a visible Read button (the
   swipe-up chevron is a hint beside it, not the only affordance).
8. Cover image source, in order: **stored blob → publisher URL → generated
   Cover**. No new Sync phase, no new stored bytes, no ADR change.
9. Publication identity is a **monogram** + a `--cover-n` fill chosen by
   hashing the id. No logos, no favicons, no flags.
10. Action bar is Save / Share / Original — the Reader's three existing
    actions. **No likes, no comments, no counts, no invented numbers.**
11. No sticky day headers in Feed mode; each card carries its relative time.
    The Retention bound survives as an "all caught up · last N days" end card.

## Contrast, verified against the design's own values

Computed for `--accent-ink` (`#fff8f3`) over every ramp value, both themes:

- **Cover headline** (1.75rem bold serif = large text, needs 3.0): passes AAA
  everywhere. Worst case 5.28, light `--cover-2`.
- **Avatar monogram** (12px bold = small text, needs 4.5): passes. Worst case
  5.28 light, 7.53 dark.
- **Story Frame headline and Summary** over the scrim: 13.9–15.6. The scrim
  does the work.
- **Fails, but does not ship:** the 11px `--cover-n` caption on board 10 at
  `opacity:.75` scores 3.75–4.39 over light covers 1–4. It is the token name
  printed on a documentation swatch. Do not reproduce it in the product.

**The finding that matters.** The Story player's scrim is `#121110` — the *dark*
`--bg`, hardcoded. Tokenise it as `--bg` and a reader on the light theme gets
Summaries at **1.56–1.69**: unreadable. So the player is **dark in both
themes**, by decision, and its scrim is its own token that the light block does
not redefine. This is legal under "themes change tokens, never rules" — the
rule is identical, the token simply does not vary — but it must be commented
where it is defined, or a future agent will helpfully add a light value and
break it. The design has no light-theme Story artboard; this is the answer to
that gap, recorded here rather than discovered later.

## Tickets

- `issues/01-cover-ramp-monogram-seen-and-viewmode.md` — foundations, no UI.
- `issues/02-feed-view-mode.md` — the toggle, the rings row, the cards.
- `issues/03-story-player.md` — the full-screen Frame player.
