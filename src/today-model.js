// Today's data model: the pure half of the home screen, in both View Modes.
//
// Today has two presentations of one set of Items (spec: Feed View Mode), and
// both shapes are decided here: `sections` groups the cards by day for List
// mode, `cards` is the same card objects flat and newest first for Feed mode,
// and `rings` is one entry per Enabled Publication with its Story state. The
// cards are literally shared between the two arrangements rather than built
// twice, so the two modes can never disagree about what an Item says.
//
// `buildTodayModel` takes the stored Items, the Enabled Publications and the
// reader's filter, and returns exactly what the template needs — day sections
// with localized headers, cards, filter chips with Unread counts. No DOM, no
// database, no `Date.now()` unless the caller omits `now`, so every rule here
// (which day an Item lands in, how the list is bounded, what a chip counts) is
// unit tested in Node. `src/views/today.js` is the browser half: it queries
// Dexie, renders this model and writes read state.
//
// The day a card belongs to is decided in the **reader's own timezone**: an
// Item published at 23:59 local time is yesterday's news the moment the clock
// passes midnight, whatever UTC says. `startOfLocalDay` is the only place that
// knowledge lives, and the distance between two days is a rounded division so a
// daylight-saving change (a 23- or 25-hour day) cannot shift a label.
//
// The list is bounded by Retention, deliberately: the newest
// `keepPerPublication` Items per Publication published within `maxAgeDays`.
// That is the same window `retention.js` keeps on disk, so Today never promises
// a past it cannot show and there is nothing to scroll into (spec: "no infinite
// scroll into the past; older Items are reachable from the Publication's own
// list").

import { coverIndexFor, monogramFor } from "./cover.js";
import { DICTIONARIES, en, LOCALES } from "./i18n.js";
import {
  compareItemsNewestFirst,
  DEFAULT_RETENTION,
  timeOf,
} from "./retention.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// `retention.js` types `ItemRecord.saved` as a boolean while the stored `ItemRow`
// holds `0 | 1` (IndexedDB cannot index a boolean — see db.js), so the two row
// types are not mutually assignable even though the comparator reads neither
// field. Widening the comparator once here is cheaper and clearer than a
// field-by-field cast of every Item, the same call ticket 07 made in sync.js.
/** @type {(a: ItemRow, b: ItemRow) => number} */
const newestFirst = /** @type {any} */ (compareItemsNewestFirst);

/** Longest one-line Summary a card shows; longer text is cut on a word. */
export const SUMMARY_MAX_CHARS = 160;

/** @typedef {import('./db.js').ItemRow} ItemRow */
/** @typedef {import('./db.js').PublicationRow} PublicationRow */
/** @typedef {import('./i18n.js').Lang} Lang */
/** @typedef {import('./cover.js').CoverSource} CoverSource */

/**
 * How a Publication is handed to `buildTodayModel`: a Map keyed by id, or a
 * plain object. Only `name` is read; anything else is ignored.
 * @typedef {Map<string, PublicationRow> | Record<string, PublicationRow>} PublicationsById
 */

/**
 * One Item as a card. Everything is display-ready: `summary` is one collapsed
 * line of plain text and `publicationName` is resolved.
 *
 * @typedef {object} TodayCard
 * @property {string} id The Item id, `publicationId + ":" + feedItemId`.
 * @property {string} publicationId
 * @property {string} publicationName
 * @property {string} title
 * @property {string} summary One line of plain text, possibly elided.
 * @property {number} publishedAt Epoch ms.
 * @property {string | null} thumbnailUrl The Feed's thumbnail, never stored.
 * @property {boolean} read
 * @property {boolean} saved
 * @property {boolean} summaryOnly No Article: the Reader shows the Summary.
 * @property {string} monogram The Publication's initials (`src/cover.js`).
 * @property {number} coverIndex Which `--cover-n` fill this Publication takes.
 * @property {CoverSource} cover What fills the picture slot, already decided.
 */

/**
 * One Publication's ring in Feed mode. The three states are told apart by ring
 * weight before colour (board 09), so the row reads without relying on hue.
 *
 * A **reel** is the Publication's Unread Items inside Today's window. `state`
 * is `none` when there is no reel — a tap filters the feed instead of opening a
 * Story — `seen` when every Item in the reel has had a Frame shown, and
 * `unseen` otherwise. `unread` is the same number the chip shows and moves only
 * on Read, which is why a dimmed ring and a standing Unread count are not a
 * contradiction.
 *
 * @typedef {object} Ring
 * @property {string} publicationId
 * @property {string} name
 * @property {string} monogram
 * @property {number} coverIndex
 * @property {'unseen'|'seen'|'none'} state
 * @property {number} unread Unread Items inside the window.
 * @property {number} reelCount Frames the Story would have; 0 means no reel.
 * @property {boolean} active This Publication is the filter currently applied.
 */

/**
 * One day of the timeline, newest first.
 *
 * @typedef {object} DaySection
 * @property {string} key `YYYY-MM-DD` in the reader's timezone; a stable list key.
 * @property {number} startedAt Epoch ms of that day's local midnight.
 * @property {'today'|'yesterday'|'other'} kind Which label rule applied.
 * @property {string} label Localized header: "Today", "Yesterday", or weekday + date.
 * @property {TodayCard[]} cards Newest first, ties broken by id.
 */

/**
 * One filter chip. `publicationId` is null for the "All" chip.
 *
 * @typedef {object} FilterChip
 * @property {string | null} publicationId
 * @property {string} name Localized for "All", the Publication's own name otherwise.
 * @property {number} unread Unread Items inside the window.
 * @property {number} total Items inside the window.
 * @property {boolean} active The filter currently applied.
 */

/**
 * @typedef {object} TodayModel
 * @property {DaySection[]} sections Newest day first; empty when nothing matches.
 * @property {TodayCard[]} cards The same cards flat and newest first, for Feed
 *   mode. No day sections: each card carries its own `publishedAt`, which is
 *   the relative time the card prints.
 * @property {Ring[]} rings One per Enabled Publication, in the caller's order.
 * @property {FilterChip[]} chips "All" first, then one per Publication with Items.
 * @property {string | null} filterPublicationId Echo of the filter applied.
 * @property {string | null} filterName Name of the filtered Publication, or null.
 * @property {number} cardCount Cards in `cards`, and so in `sections` too
 *   (after the filter).
 * @property {number} itemCount Items inside the window (before the filter).
 * @property {number} unreadCount Unread Items inside the window (before the filter).
 * @property {number} windowDays The age bound applied, for the honest footer line.
 */

/**
 * Group and filter stored Items into the day sections Today renders.
 *
 * Pure: the same arguments always produce the same model. `now` and `lang` are
 * parameters rather than reads of `Date.now()` and the i18n module's current
 * Language, which is what makes the midnight and localization rules testable.
 *
 * @param {Iterable<ItemRow> | null | undefined} items Stored Items, any order.
 * @param {PublicationsById | null | undefined} publicationsById The Enabled
 *   Publications. An Item whose Publication is absent is dropped: Today is a
 *   timeline across Enabled Publications, and a Publication switched off keeps
 *   its rows until the next trim.
 * @param {object} [options]
 * @param {string | null} [options.filterPublicationId] Show only this
 *   Publication. Its chip stays visible even with no Items, so an active filter
 *   is never invisible.
 * @param {number | Date} [options.now] Defaults to `Date.now()`.
 * @param {Lang} [options.lang] Language of the day headers and the "All" chip.
 * @param {{ maxAgeDays?: number, keepPerPublication?: number }} [options.limits]
 *   Retention bounds; defaults to `DEFAULT_RETENTION`.
 * @param {Map<string, CoverSource> | null} [options.coverSources] What fills
 *   each Item's picture slot, from `resolveCoverSources` (`src/cover.js`). An
 *   Item the map does not mention gets a generated Cover, which is the honest
 *   answer with no connection and the right one for List mode, which asks for
 *   no sources at all.
 * @returns {TodayModel}
 */
export function buildTodayModel(items, publicationsById, options = {}) {
  const {
    filterPublicationId = null,
    now = Date.now(),
    lang = "en",
    limits = {},
    coverSources = null,
  } = options;
  const {
    maxAgeDays = DEFAULT_RETENTION.maxAgeDays,
    keepPerPublication = DEFAULT_RETENTION.keepPerPublication,
  } = limits;

  const nowMs = timeOf(now);
  const nowStart = startOfLocalDay(nowMs);
  const cutoff = nowMs - maxAgeDays * MS_PER_DAY;
  const keep = Math.max(0, Math.floor(keepPerPublication));
  const publications = publicationLookup(publicationsById);
  const filterId = filterPublicationId ? String(filterPublicationId) : null;

  // 1. The Retention window: an Enabled Publication, published inside the age
  //    bound, and among that Publication's newest `keep` Items.
  /** @type {ItemRow[]} */
  const fresh = [];
  for (const item of items || []) {
    if (!item) continue;
    if (!publications.has(String(item.publicationId))) continue;
    if (timeOf(item.publishedAt) < cutoff) continue;
    fresh.push(item);
  }
  fresh.sort(newestFirst);

  /** @type {Map<string, number>} */
  const perPublication = new Map();
  /** @type {ItemRow[]} */
  const bounded = [];
  for (const item of fresh) {
    const key = String(item.publicationId);
    const rank = (perPublication.get(key) || 0) + 1;
    perPublication.set(key, rank);
    if (rank <= keep) bounded.push(item);
  }

  // 2. Counts per Publication, always over the whole window: a chip's Unread
  //    count must not change when the reader filters to another Publication.
  //    `reel` and `reelSeen` are counted in the same pass: a reel is the
  //    Publication's Unread Items in the window, and a ring dims once every
  //    one of them has had a Frame shown.
  /** @type {Map<string, { total: number, unread: number, reelSeen: number }>} */
  const counts = new Map();
  let unreadCount = 0;
  for (const item of bounded) {
    const key = String(item.publicationId);
    const tally = counts.get(key) || { total: 0, unread: 0, reelSeen: 0 };
    tally.total += 1;
    if (!item.read) {
      tally.unread += 1;
      unreadCount += 1;
      if (item.seen) tally.reelSeen += 1;
    }
    counts.set(key, tally);
  }

  // 3. Chips: "All" plus every Publication with Items in the window, in the
  //    order the caller listed them.
  /** @type {FilterChip[]} */
  const chips = [
    {
      publicationId: null,
      name: phrase(lang, "today.all"),
      unread: unreadCount,
      total: bounded.length,
      active: filterId === null,
    },
  ];
  for (const [id, publication] of publications) {
    const tally = counts.get(id);
    if (!tally && id !== filterId) continue;
    chips.push({
      publicationId: id,
      name: publicationName(publication, id),
      unread: tally ? tally.unread : 0,
      total: tally ? tally.total : 0,
      active: id === filterId,
    });
  }

  // 4. Rings: one per Enabled Publication, whether or not it has Items in the
  //    window — board 09 is "one ring per Enabled Publication", and a
  //    Publication with nothing to show is the flattest state rather than a
  //    gap in the row.
  /** @type {Ring[]} */
  const rings = [];
  for (const [id, publication] of publications) {
    const tally = counts.get(id);
    const unread = tally ? tally.unread : 0;
    const reelSeen = tally ? tally.reelSeen : 0;
    rings.push({
      publicationId: id,
      name: publicationName(publication, id),
      monogram: monogramFor(publicationName(publication, id)),
      coverIndex: coverIndexFor(id),
      state: unread === 0 ? "none" : reelSeen === unread ? "seen" : "unseen",
      unread,
      reelCount: unread,
      active: id === filterId,
    });
  }

  // 5. The cards, once, newest first. Feed mode renders them as one column;
  //    List mode groups the very same objects into day sections below, so the
  //    two presentations cannot drift apart.
  /** @type {TodayCard[]} */
  const cards = [];
  for (const item of bounded) {
    if (filterId !== null && String(item.publicationId) !== filterId) continue;
    cards.push(
      toCard(
        item,
        publications.get(String(item.publicationId)),
        coverSources?.get(String(item.id)),
      ),
    );
  }

  // 6. Sections, newest day first. `cards` is already newest first, so each
  //    section's cards inherit that order and the sections come out in order.
  /** @type {DaySection[]} */
  const sections = [];
  /** @type {Map<string, DaySection>} */
  const byDay = new Map();
  for (const card of cards) {
    const startedAt = startOfLocalDay(card.publishedAt);
    const key = localDayKey(startedAt);
    let section = byDay.get(key);
    if (!section) {
      const { kind, label } = describeDay(startedAt, nowStart, lang);
      section = { key, startedAt, kind, label, cards: [] };
      byDay.set(key, section);
      sections.push(section);
    }
    section.cards.push(card);
  }

  const filtered = filterId === null ? null : publications.get(filterId);
  return {
    sections,
    cards,
    rings,
    chips,
    filterPublicationId: filterId,
    filterName: filterId === null ? null : publicationName(filtered, filterId),
    cardCount: cards.length,
    itemCount: bounded.length,
    unreadCount,
    windowDays: maxAgeDays,
  };
}

/**
 * Epoch ms of local midnight on the day a date-like value falls in. This is the
 * one place the app decides what "a day" means, and it means the reader's own
 * day: `new Date(y, m, d)` is midnight in the runtime's timezone.
 * @param {number | string | Date} value
 * @returns {number}
 */
export function startOfLocalDay(value) {
  const date = new Date(timeOf(value));
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/**
 * `YYYY-MM-DD` of the local day, used as the section's list key. Built from the
 * local components rather than `toISOString()`, which would name the UTC day.
 * @param {number | string | Date} value
 * @returns {string}
 */
export function localDayKey(value) {
  const date = new Date(timeOf(value));
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Collapse HTML-free text to one line and elide it on a word boundary.
 * @param {string | null | undefined} text
 * @param {number} [max]
 * @returns {string}
 */
export function oneLine(text, max = SUMMARY_MAX_CHARS) {
  const line = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const head = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * Which header a day gets: "Today", "Yesterday", or the weekday and date. The
 * distance is a **rounded** division of the two local midnights, so a 23- or
 * 25-hour day across a daylight-saving change still reads as one day.
 * @param {number} startedAt Local midnight of the day.
 * @param {number} nowStart Local midnight of today.
 * @param {Lang} lang
 * @returns {{ kind: 'today'|'yesterday'|'other', label: string }}
 */
function describeDay(startedAt, nowStart, lang) {
  const days = Math.round((nowStart - startedAt) / MS_PER_DAY);
  if (days === 0) return { kind: "today", label: phrase(lang, "today.today") };
  if (days === 1)
    return { kind: "yesterday", label: phrase(lang, "today.yesterday") };
  return { kind: "other", label: formatDayHeading(startedAt, nowStart, lang) };
}

/**
 * "Monday 5 January" / "lunedì 5 gennaio", with the year when the day falls in
 * another one (a 30-day window crosses New Year).
 * @param {number} startedAt
 * @param {number} nowStart
 * @param {Lang} lang
 * @returns {string}
 */
function formatDayHeading(startedAt, nowStart, lang) {
  const date = new Date(startedAt);
  /** @type {Intl.DateTimeFormatOptions} */
  const options = { weekday: "long", day: "numeric", month: "long" };
  if (date.getFullYear() !== new Date(nowStart).getFullYear()) {
    options.year = "numeric";
  }
  try {
    return new Intl.DateTimeFormat(LOCALES[lang] || LOCALES.en, options).format(
      date,
    );
  } catch {
    return localDayKey(startedAt);
  }
}

/**
 * Look a key up in a dictionary chosen by argument, not by the i18n module's
 * current Language: this file must stay pure. Falls back to English, then to
 * the key, exactly like `t()`.
 * @param {Lang} lang
 * @param {string} key
 * @returns {string}
 */
function phrase(lang, key) {
  const table = DICTIONARIES[lang] || en;
  if (key in table) return table[key];
  return key in en ? en[key] : key;
}

/**
 * Normalize the Publications argument to a Map, keeping the caller's order.
 * @param {PublicationsById | null | undefined} publicationsById
 * @returns {Map<string, PublicationRow>}
 */
function publicationLookup(publicationsById) {
  if (publicationsById instanceof Map) return publicationsById;
  /** @type {Map<string, PublicationRow>} */
  const map = new Map();
  if (!publicationsById) return map;
  for (const key of Object.keys(publicationsById)) {
    map.set(key, publicationsById[key]);
  }
  return map;
}

/**
 * A Publication's display name, falling back to its id: a Publication that has
 * left the Catalog but is still Enabled must still label its cards.
 * @param {PublicationRow | undefined} publication
 * @param {string} id
 * @returns {string}
 */
function publicationName(publication, id) {
  const name = publication?.name;
  return typeof name === "string" && name.trim() ? name : id;
}

/**
 * @param {ItemRow} item
 * @param {PublicationRow | undefined} publication
 * @param {CoverSource} [cover] From `resolveCoverSources`; a generated Cover
 *   when the caller resolved nothing for this Item.
 * @returns {TodayCard}
 */
function toCard(item, publication, cover) {
  const publicationId = String(item.publicationId);
  const name = publicationName(publication, publicationId);
  return {
    id: String(item.id),
    publicationId,
    publicationName: name,
    title: oneLine(item.title, 200),
    summary: oneLine(item.summaryText),
    publishedAt: timeOf(item.publishedAt),
    thumbnailUrl: item.thumbnailUrl || null,
    read: Boolean(item.read),
    saved: Boolean(item.saved),
    summaryOnly: Boolean(item.summaryOnly),
    monogram: monogramFor(name),
    coverIndex: coverIndexFor(publicationId),
    cover: cover ?? { kind: "cover", url: null },
  };
}
