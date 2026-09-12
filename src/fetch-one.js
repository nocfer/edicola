// On-demand Extraction for a single Item: the Article step of the Sync
// pipeline, run for the one Item the reader is looking at right now (spec
// story 18). A Summary-only Item opened while online goes through here behind
// a spinner, and on success the Reader swaps the Article in place.
//
// It is the same contract as `prefetchArticle` in sync.js — fetch the Original
// through the fetcher, extract, store the Article and its images within the
// per-Article image budget, and on any failure leave the Item Summary-only
// with a short reason token instead of throwing. Sharing the *store* rather
// than the code keeps this reusable in one place: `putArticle` is what clears
// an earlier Summary-only mark and sets `hasArticle`.
//
// Every dependency is a parameter, as in sync.js, so this module has no DOM,
// no globals and no Dexie import, and runs under `node --test`.

import { fetchTextTwice, reasonOf } from "./fetcher.js";
import { byteLength, DEFAULT_RETENTION } from "./retention.js";

/** @typedef {import('./db.js').ItemRow} ItemRow */
/** @typedef {import('./db.js').ArticleRow} ArticleRow */
/** @typedef {import('./store.js').SyncStore} SyncStore */
/** @typedef {import('./fetcher.js').Fetcher} Fetcher */

/**
 * What one on-demand Extraction did. `article` is the row that was stored, so
 * the Reader can render it without reading the database again; `reason` is the
 * token written to `items.summaryOnlyReason` when there is no Article.
 *
 * @typedef {object} FetchOneResult
 * @property {boolean} ok An Article was extracted and stored.
 * @property {ArticleRow | null} article
 * @property {number} images Image blobs stored for it.
 * @property {number} bytes Article HTML plus image bytes written.
 * @property {string | null} reason Why it stayed Summary-only, or null.
 */

/**
 * @typedef {object} FetchArticleOptions
 * @property {SyncStore} store
 * @property {Fetcher} fetcher
 * @property {(html: string, url: string) => any} extractArticle Returns an
 *   `Article` (see extract-core.js).
 * @property {() => number} [now] Epoch ms; defaults to `Date.now`.
 * @property {Partial<import('./retention.js').RetentionLimits>} [limits]
 */

/**
 * Fetch and extract one Item's Original now.
 *
 * Resolves rather than rejects for every expected failure — no link, the
 * publisher refusing the request, no article text on the page — because each
 * of those is a state the Reader has honest copy for (ADR-0004). The Item is
 * marked Summary-only with the reason before it resolves, so a later open
 * shows the same answer without another request.
 *
 * @param {ItemRow} item
 * @param {FetchArticleOptions} options
 * @returns {Promise<FetchOneResult>}
 */
export async function fetchArticleNow(
  item,
  { store, fetcher, extractArticle, now = Date.now, limits = {} },
) {
  const {
    maxImageBytesPerArticle = DEFAULT_RETENTION.maxImageBytesPerArticle,
  } = limits;

  if (!item?.link) {
    await store.markSummaryOnly(item.id, "no-link");
    return summaryOnly("no-link");
  }

  /** @type {import('./fetcher.js').FetchTextResult} */
  let page;
  try {
    page = await fetchTextTwice(fetcher, item.link);
  } catch (error) {
    const reason = reasonOf(error);
    await store.markSummaryOnly(item.id, reason);
    return summaryOnly(reason);
  }

  const article = extractArticle(page.text, page.finalUrl || item.link);
  if (!article.ok) {
    const reason = article.reason || "no-content";
    await store.markSummaryOnly(item.id, reason);
    return summaryOnly(reason);
  }

  const images = await fetchImages(fetcher, article.imageUrls, {
    maxImageBytesPerArticle,
  });
  const bytes = byteLength(article.html);
  /** @type {ArticleRow} */
  const row = {
    itemId: item.id,
    title: article.title,
    byline: article.byline,
    html: article.html,
    wordCount: article.wordCount,
    bytes,
    extractedAt: now(),
  };
  await store.putArticle(row);
  const imageBytes = await store.putImages(item.id, images);
  return {
    ok: true,
    article: row,
    images: images.length,
    bytes: bytes + imageBytes,
    reason: null,
  };
}

/**
 * @param {string} reason
 * @returns {FetchOneResult}
 */
function summaryOnly(reason) {
  return { ok: false, article: null, images: 0, bytes: 0, reason };
}

/**
 * The Article's images, in document order, within the per-Article budget. An
 * image that fails or would overrun the budget is skipped: an Article with one
 * missing picture still reads, and the Reader falls back to the network URL
 * for it.
 * @param {Fetcher} fetcher
 * @param {string[]} urls
 * @param {{ maxImageBytesPerArticle: number }} limits
 * @returns {Promise<import('./store.js').ImageInput[]>}
 */
async function fetchImages(fetcher, urls, { maxImageBytesPerArticle }) {
  /** @type {import('./store.js').ImageInput[]} */
  const stored = [];
  let used = 0;
  for (const url of urls) {
    const remaining = maxImageBytesPerArticle - used;
    if (remaining <= 0) break;
    try {
      const { blob } = await fetcher.fetchBlob(url, { maxBytes: remaining });
      stored.push({ url, blob, bytes: blob.size });
      used += blob.size;
    } catch {
      // Skip it.
    }
  }
  return stored;
}
