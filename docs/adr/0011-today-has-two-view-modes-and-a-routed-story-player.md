---
status: accepted
---
# Today has two View Modes, and the Story player is a route that stays dark

Today presents the same Items in one of two View Modes — **List**, the
day-grouped timeline, and **Feed**, a row of Publication rings above a column
of full-bleed post cards. It is one screen with two presentations, not two
screens: one route, one `today-model.js` that computes both shapes from the
same card objects, and two templates that decide nothing. The alternative, a
second screen, would have given the two presentations independent Retention
windows, Unread counts and empty states, which is three chances for them to
disagree about what the reader has.

The **Story player** — one Publication's reel of its Unread Items — is a route,
`#/story/:publicationId`, not an overlay on Today. The back button decided it:
the player must close on the browser's own back gesture and land the reader
back at the same place in the feed, which history gives a route for free and an
overlay would have to fake with a pushed entry and a guess about what a
`popstate` meant. The Reader is the precedent, and both hide the tab bar
through `hidesTabBar`.

**Seen is not Read.** Showing a Frame marks its Item Seen; only the Reader marks
it Read. Rings dim on Seen, Unread counts fall only on Read, so a reader who
flicks through a reel has changed nothing they would have to undo. `seen` is a
plain non-indexed boolean, so under the additive-only rule of ADR-0008 it needed
no `db.version(n)` block and no migration: IndexedDB stores whole objects and
only a declared index constrains their shape.

**The player is dark in both themes, and that is a deliberate carve-out from
"themes change tokens, never rules."** Its scrim and the `--accent-ink` text
over it are the one place where a token refuses to vary: `--accent-ink` scores
14.6–15.6 over the dark scrim and 1.6 over a light one, so a light value there
does not complete the theme, it makes every Summary in the player unreadable.
The rules are identical in both themes — only `--scrim-ink` and `--scrim-flat`
are absent from the light block, with the reason commented on both sides. The
design has no light-theme Story artboard; this is the answer to that gap rather
than something to discover later.

Covers are the other half of the same bet. An Item with no usable photo gets a
generated Cover — one flat fill from a fixed eight-value ramp, the
Publication's monogram, the headline set large — rather than a grey box, because
half the Catalog carries no image and an offline feed is Cover-dominant by
design. Publications have no logos, favicons or flags: the monogram is the
identity, and the colour, shared by roughly four Publications each, never is.
