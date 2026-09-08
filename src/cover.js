// Publication identity for Feed mode, and the answer to "what fills this
// Item's picture" (ticket 01).
//
// Publications have no logos, no favicons and no flags (ADR-0009 has nothing
// to say about them because Edicola never fetches them), so a Publication's
// visible identity is two things: a **monogram** derived from its name, and one
// of eight `--cover-n` fills picked by hashing its id. Thirty Publications
// share eight colours on purpose — the colour is never the identity, the
// monogram is.
//
// The first two functions are pure and dependency-free: no `document`, no
// `window`, no `Date.now()`, so the monogram rule and the ramp index are unit
// tested in Node. `resolveCoverSources` takes its database handle, its key
// function and `URL.createObjectURL` as parameters, the way
// `article-render.js` does, for the same reason: the mapping from stored blobs
// to what a template renders is the seam "the feed is complete offline" rests
// on, and it is proved against a fake `images` table rather than a browser.

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

/**
 * The stored blob for each URL that has one, keyed by the URL as it appears on
 * the Item. `images` is keyed by the sha-256 of the URL (`imageKeyFor`), so one
 * `bulkGet` answers for the whole feed.
 *
 * A database that cannot be read is not a reason to show nothing: every Item
 * falls back to its publisher URL or its Cover, and the feed still renders.
 * @param {string[]} urls
 * @param {{ db: any, imageKeyFor: (url: string) => Promise<string> }} deps
 * @returns {Promise<Map<string, Blob>>}
 */
async function readStoredImages(urls, { db, imageKeyFor }) {
  /** @type {Map<string, Blob>} */
  const blobs = new Map();
  try {
    const keys = await Promise.all(urls.map((url) => imageKeyFor(url)));
    const rows = await db.images.bulkGet(keys);
    rows.forEach((/** @type {{ blob?: Blob } | undefined} */ row, i) => {
      if (row?.blob) blobs.set(urls[i], row.blob);
    });
  } catch (error) {
    console.warn("Stored thumbnails could not be read:", error);
  }
  return blobs;
}
