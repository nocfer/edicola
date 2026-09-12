// Article images at render time: the blobs a Sync stored become object URLs,
// the Article's `img src` values are rewritten to point at them, and every URL
// created here is handed back so the Reader can revoke them when it unmounts.
// That is what makes an Article complete with no connection (spec story 25):
// nothing in the rendered markup reaches the network for an image we already
// hold.
//
// Every dependency is a parameter — the database handle, the image key
// function, the DOM factory and `URL.createObjectURL` — so this module imports
// nothing that needs a browser (only the pure `extract-core.js`) and the whole
// mapping is unit tested under Node against a fake `images` table.
//
// Two DOM passes, both on already-sanitized stored markup:
//   1. `markImages` tags every `img` and collects the network URLs it uses.
//   2. `rewriteImageSources` (the choke point from extract-core.js) swaps in a
//      `blob:` URL for each image we have. It deliberately does not
//      re-sanitize, which is why `blob:` survives — and why this module must
//      only ever be handed Article HTML that came out of DOMPurify.

import { rewriteImageSources } from "./extract-core.js";

/** @typedef {(html: string, url?: string) => { document: any }} WindowFor */

/**
 * An Article ready to render, plus the object URLs it depends on.
 * @typedef {object} PreparedArticle
 * @property {string} html Article markup with stored images pointing at `blob:` URLs.
 * @property {string[]} objectUrls Every URL created for it; revoke these on unmount.
 * @property {number} fromStorage Images served from the `images` table.
 * @property {number} fromNetwork Images with no stored blob, left on their original URL.
 */

/**
 * Prepare stored Article markup for rendering: point every image we hold at a
 * `blob:` URL and leave the rest on their original address, lazily loaded.
 *
 * @param {string} html Sanitized Article markup as stored in `articles.html`.
 * @param {object} deps
 * @param {any} deps.db Dexie handle (only `db.images.bulkGet` is used).
 * @param {(url: string) => Promise<string>} deps.imageKeyFor `imageKeyFor` from db.js.
 * @param {WindowFor} deps.windowFor A fresh inert document per HTML string.
 * @param {(blob: Blob) => string} deps.createObjectURL Usually `URL.createObjectURL`.
 * @returns {Promise<PreparedArticle>}
 */
export async function prepareArticle(
  html,
  { db, imageKeyFor, windowFor, createObjectURL },
) {
  const marked = markImages(String(html || ""), { windowFor });
  if (marked.urls.length === 0) {
    return {
      html: marked.html,
      objectUrls: [],
      fromStorage: 0,
      fromNetwork: 0,
    };
  }
  const blobs = await readStoredImages(marked.urls, { db, imageKeyFor });
  /** @type {Map<string, string>} */
  const objectUrlByImage = new Map();
  let fromNetwork = 0;
  const rewritten = rewriteImageSources(
    marked.html,
    (url) => {
      const known = objectUrlByImage.get(url);
      if (known) return known;
      const blob = blobs.get(url);
      if (!blob) {
        fromNetwork += 1;
        return undefined;
      }
      const objectUrl = createObjectURL(blob);
      objectUrlByImage.set(url, objectUrl);
      return objectUrl;
    },
    { windowFor },
  );
  return {
    html: rewritten,
    objectUrls: [...objectUrlByImage.values()],
    fromStorage: objectUrlByImage.size,
    fromNetwork,
  };
}

/**
 * Release the object URLs of a `PreparedArticle`. A Reader that skipped this
 * would hold every image of every Article opened this session in memory, so it
 * is called on unmount, on moving to another Item, and on `pagehide`.
 * @param {string[]} objectUrls
 * @param {{ revokeObjectURL: (url: string) => void }} deps
 * @returns {number} How many URLs were revoked.
 */
export function revokeObjectUrls(objectUrls, { revokeObjectURL }) {
  let revoked = 0;
  for (const url of objectUrls || []) {
    try {
      revokeObjectURL(url);
      revoked += 1;
    } catch {
      // A URL the browser has already forgotten is not a problem worth raising.
    }
  }
  return revoked;
}

/**
 * Tag every `img` in the Article and collect the http(s) sources it uses.
 *
 * `loading="lazy"` and `decoding="async"` keep a long Article cheap; an image
 * the reader never scrolls to is never decoded. `referrerpolicy="no-referrer"`
 * matters for the images we could *not* store: falling back to the network is
 * the honest thing to do, but the publisher learns nothing about the reader
 * from it (ADR-0009). Data-URI images (kept inline by Extraction when small)
 * are tagged too and collected nowhere: there is no blob to look up.
 *
 * @param {string} html
 * @param {{ windowFor: WindowFor }} deps
 * @returns {{ html: string, urls: string[] }}
 */
function markImages(html, { windowFor }) {
  const { document } = windowFor(
    `<!doctype html><html><body>${html}</body></html>`,
  );
  /** @type {string[]} */
  const urls = [];
  for (const img of document.body.querySelectorAll("img")) {
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    img.setAttribute("referrerpolicy", "no-referrer");
    const src = img.getAttribute("src") || "";
    if (/^https?:\/\//i.test(src) && !urls.includes(src)) urls.push(src);
  }
  return { html: document.body.innerHTML, urls };
}

/**
 * The stored blob for each URL that has one, keyed by the URL as it appears in
 * the markup. `images` is keyed by the sha-256 of the URL (`imageKeyFor`), so
 * one `bulkGet` answers for the whole Article and an image shared by two
 * Articles is found whichever of them stored it.
 *
 * Exported because `cover.js` asks the same table the same question for the
 * feed's thumbnails; the two had drifted into differently-shaped copies of one
 * `bulkGet`.
 *
 * A database that cannot be read is not a reason to show nothing: every image
 * falls back to its network URL and the Article still reads.
 *
 * @param {string[]} urls
 * @param {{ db: any, imageKeyFor: (url: string) => Promise<string> }} deps
 * @returns {Promise<Map<string, Blob>>}
 */
export async function readStoredImages(urls, { db, imageKeyFor }) {
  /** @type {Map<string, Blob>} */
  const blobs = new Map();
  try {
    const keys = await Promise.all(urls.map((url) => imageKeyFor(url)));
    /** @type {Array<{ blob?: Blob } | undefined>} */
    const rows = await db.images.bulkGet(keys);
    rows.forEach((row, i) => {
      if (row?.blob) blobs.set(urls[i], row.blob);
    });
  } catch (error) {
    console.warn("Stored images could not be read:", error);
  }
  return blobs;
}
