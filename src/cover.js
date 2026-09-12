// Publication identity for Feed mode, and the answer to "what fills this
// Item's picture" (ticket 01).
//
// A Publication's visible identity is a **monogram** derived from its name over
// one of eight `--cover-n` fills picked by hashing its id. Thirty Publications
// share eight colours on purpose — the colour is never the identity, the
// monogram is.
//
// `logoCandidates` below lists where to look for the publisher's own logo, and
// `publicationTile` in `views/layout.js` shows that in the small circles
// instead. The monogram is not decoration underneath it: it is the last rung of
// that ladder, what a Publication with nothing to try gets, and what a chain
// that has run out falls back to.
//
// The first two functions are pure and dependency-free: no `document`, no
// `window`, no `Date.now()`, so the monogram rule and the ramp index are unit
// tested in Node. `resolveCoverSources` takes its database handle, its key
// function and `URL.createObjectURL` as parameters, the way
// `article-render.js` does, for the same reason: the mapping from stored blobs
// to what a template renders is the seam "the feed is complete offline" rests
// on, and it is proved against a fake `images` table rather than a browser.

// `readStoredImages` is shared with `article-render.js` rather than copied: a
// thumbnail and an Article image are the same row of the same `images` table,
// looked up by the same key, and the two copies had already drifted apart in
// how they handled a database that will not open.
import { readStoredImages } from "./article-render.js";

/** How many fills the `--cover-1 … --cover-8` ramp has (styles.css §1). */
export const COVER_RAMP_SIZE = 8;

/**
 * What a name gives when it holds no usable character at all. Not a Cover
 * fallback — CONTEXT.md is clear that a Cover is deliberate rather than a
 * stand-in for a failure. This is only the glyph a nameless Publication's
 * monogram becomes.
 */
const NO_MONOGRAM = "?";

/**
 * Words a monogram skips. Articles and particles carry no identity: `la
 * Repubblica` is Repubblica and `London Review of Books` is London Review.
 * Matched case-insensitively, so `la` and `La` both go. Italian and English
 * only, which are the two Languages the app has (ADR-0006).
 */
const PARTICLES = new Set([
  // English
  "a",
  "an",
  "and",
  "for",
  "of",
  "the",
  // Italian articles and prepositions, plain and articulated
  "da",
  "dal",
  "dalla",
  "dei",
  "del",
  "della",
  "delle",
  "dello",
  "degli",
  "di",
  "e",
  "gli",
  "i",
  "il",
  "in",
  "l",
  "la",
  "le",
  "lo",
  "per",
  "su",
  "un",
  "una",
  "uno",
]);

/**
 * The Publication's monogram: one or two initials, uppercased. The rule is
 * board 09's, verbatim:
 *
 * > Initials of the first two significant words, uppercased. Articles and
 * > particles are dropped (la, il, the, of, dello), digits are skipped, an
 * > internal capital splits a compound. One significant word left gives its
 * > first two letters.
 *
 * The rule can run out of material, and a Custom Publication the reader named
 * "The" must still get a ring, so it degrades in two steps rather than
 * throwing: a name of nothing but particles keeps its particles (`The` → `TH`),
 * and a name with no letters at all falls back to its own first two characters
 * (`24` → `24`). Only a name with no usable character at all gives `?`.
 *
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function monogramFor(name) {
  const text = String(name ?? "");
  const words = splitWords(text);
  const significant = words.filter(
    (word) => !PARTICLES.has(word.toLowerCase()),
  );
  const chosen = significant.length > 0 ? significant : words;
  if (chosen.length >= 2) {
    return (chosen[0][0] + chosen[1][0]).toUpperCase();
  }
  if (chosen.length === 1) {
    return chosen[0].slice(0, 2).toUpperCase();
  }
  const bare = text.replace(/[^\p{L}\p{N}]+/gu, "");
  return bare === "" ? NO_MONOGRAM : bare.slice(0, 2).toUpperCase();
}

/**
 * A name split into the words a monogram can use: letters only (digits are
 * skipped, so `Il Sole 24 Ore` is Sole and Ore), with an internal capital
 * splitting a compound (`TechRadar` is Tech and Radar). An all-caps acronym has
 * no lower-to-upper boundary, which is why `ANSA` stays one word and gives
 * `AN` rather than `AN` by accident.
 * @param {string} text
 * @returns {string[]}
 */
function splitWords(text) {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((token) => token.replace(/\p{N}+/gu, " ").split(" "))
    .flatMap((token) => token.split(/(?<=\p{Ll})(?=\p{Lu})/u))
    .filter((token) => token !== "");
}

/**
 * Where to look for a Publication's logo, best first: the URL a human put in
 * the Catalog entry, then the two paths worth guessing at its site's origin.
 * `publicationTile` walks this list, and a candidate that 404s, fails to
 * decode or arrives too small is struck off and the next one tried, with the
 * monogram at the end.
 *
 * **Both guesses are conventions, not standards.** The two standard routes to
 * an icon — `<link rel="icon">` and the Web App Manifest's `icons[]` — need the
 * page first, and the manifest has no fixed path of its own, so neither can be
 * guessed without a fetch through the Proxy for a decoration. That leaves
 * these, and they are in this order because of what they hold rather than how
 * often they answer. Across the thirty Catalog origins `/favicon.ico` answers
 * 26 times and only 4 of those are 64px or more, while `/apple-touch-icon.png`
 * answers 12 times and 8 of those are (180px, usually). So the icon is the
 * better picture and the favicon is the wider net, which is why the favicon is
 * behind it and behind the size floor in `views/layout.js`: without that floor
 * chaining it would swap a sharp monogram for a 16px smudge on most sites.
 *
 * Only https. Over an https app an http image is blocked before it is sent, so
 * a candidate that cannot succeed is not one.
 *
 * @param {{ logoUrl?: string | null, siteUrl?: string | null } | null | undefined} publication
 * @returns {string[]}
 */
export function logoCandidates(publication) {
  const candidates = [];
  const stated = publication?.logoUrl;
  if (typeof stated === "string" && stated.startsWith("https://")) {
    candidates.push(stated);
  }
  for (const path of ["/apple-touch-icon.png", "/favicon.ico"]) {
    try {
      const url = new URL(path, String(publication?.siteUrl ?? ""));
      if (url.protocol === "https:" && !candidates.includes(url.href)) {
        candidates.push(url.href);
      }
    } catch {
      // No site URL, or not one that parses: there is nothing to guess from.
    }
  }
  return candidates;
}

/**
 * Which `--cover-n` fill a Publication uses, 1…`COVER_RAMP_SIZE`.
 *
 * FNV-1a over the id's UTF-16 code units: a few lines, no dependency, and the
 * same answer on every device and after every reload, which is the whole
 * requirement — a Publication whose colour moved under the reader would read
 * as a bug. Collisions are intended and deliberately not avoided.
 *
 * @param {string} publicationId
 * @returns {number}
 */
export function coverIndexFor(publicationId) {
  const id = String(publicationId ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    // FNV prime, 32-bit, via Math.imul so the multiply stays exact.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % COVER_RAMP_SIZE) + 1;
}

/**
 * What fills one Item's picture slot, with nothing left for the view to decide.
 * @typedef {object} CoverSource
 * @property {'blob'|'network'|'cover'} kind Stored bytes, the publisher's URL,
 *   or a generated Cover.
 * @property {string | null} url The `src` to render, `null` for a Cover.
 */

/**
 * Resolve the picture slot for a batch of Items: the stored blob's object URL
 * if we hold the bytes, else the publisher's URL, else a generated Cover
 * (ticket 01's settled source order — no new Sync phase, no new stored bytes).
 *
 * A batch rather than one Item at a time so the whole feed costs one
 * `bulkGet`, and one object URL per distinct URL however many Items share it.
 * Every URL created comes back in `objectUrls` for the caller to revoke, the
 * way the Reader revokes an Article's images: a screen that skipped that would
 * hold every picture of every feed it rendered this session in memory.
 *
 * @param {Iterable<{ id: string, thumbnailUrl?: string | null }>} items
 * @param {object} deps
 * @param {any} deps.db Dexie handle (only `db.images.bulkGet` is used).
 * @param {(url: string) => Promise<string>} deps.imageKeyFor `imageKeyFor` from db.js.
 * @param {(blob: Blob) => string} deps.createObjectURL Usually `URL.createObjectURL`.
 * @returns {Promise<{ sources: Map<string, CoverSource>, objectUrls: string[] }>}
 */
export async function resolveCoverSources(
  items,
  { db, imageKeyFor, createObjectURL },
) {
  const rows = [...(items || [])].filter(Boolean);
  /** @type {Map<string, CoverSource>} */
  const sources = new Map();
  /** @type {string[]} */
  const urls = [];
  for (const item of rows) {
    const url = usableImageUrl(item.thumbnailUrl);
    if (url && !urls.includes(url)) urls.push(url);
  }
  const blobs =
    urls.length === 0
      ? new Map()
      : await readStoredImages(urls, { db, imageKeyFor });

  /** @type {Map<string, string>} */
  const objectUrlByImage = new Map();
  for (const item of rows) {
    const url = usableImageUrl(item.thumbnailUrl);
    if (!url) {
      sources.set(String(item.id), { kind: "cover", url: null });
      continue;
    }
    const blob = blobs.get(url);
    if (!blob) {
      sources.set(String(item.id), { kind: "network", url });
      continue;
    }
    let objectUrl = objectUrlByImage.get(url);
    if (!objectUrl) {
      objectUrl = createObjectURL(blob);
      objectUrlByImage.set(url, objectUrl);
    }
    sources.set(String(item.id), { kind: "blob", url: objectUrl });
  }
  return { sources, objectUrls: [...objectUrlByImage.values()] };
}

/**
 * The thumbnail URL if it is one we are willing to put in a `src`. Anything
 * that is not http(s) — a `javascript:` URL a Feed put in an enclosure, say —
 * is treated as no picture at all and gets a Cover, which is both safer and
 * more honest than an image that will never load.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function usableImageUrl(value) {
  const url = String(value ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}
