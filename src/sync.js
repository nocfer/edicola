// The Sync pipeline: one refresh pass over the Enabled Publications.
//
// Every dependency is a parameter — the store, the fetcher, the Feed parser,
// Extraction, the sanitizer, `DOMParser`, the clock, the progress callback and
// the yield — so this module touches no global and runs unchanged in the page
// and under `node --test` with jsdom (ADR-0010). That is the seam the spec
// calls the highest one in the app: given these Publications, this fake
// fetcher and these fixtures, these Items and Articles come out, in this order.
//
// It runs on the page thread, not in a Worker: `DOMParser` and DOMPurify do not
// exist there and both Feed parsing and Extraction need them (ADR-0007). So the
// pipeline awaits `yieldToUi()` between Feeds and between Articles and keeps
// concurrency at 4, and the interface stays responsive while it works.

import { runEviction } from "./evict.js";
import { toPlainText } from "./extract-core.js";
import { DEFAULT_RETENTION, timeOf } from "./retention.js";
import { planArticleFetches, planFeedFetches } from "./sync-plan.js";

/** Feeds and Articles fetched at once (spec: concurrency 4). */
export const DEFAULT_CONCURRENCY = 4;

/** Failure kinds that a second attempt cannot improve on. */
const FINAL_FAILURES = new Set([
  "not-found",
  "too-large",
  "proxy-unconfigured",
]);

/** @typedef {import('./store.js').SyncStore} SyncStore */
/** @typedef {import('./db.js').ItemRow} ItemRow */
/** @typedef {import('./fetcher.js').Fetcher} Fetcher */

/**
 * What one Sync did. `itemsStored` counts Item rows written (new and
 * refreshed); `bytesStored` is Article HTML plus image bytes written this run.
 *
 * @typedef {object} SyncSummary
 * @property {number} feedsOk
 * @property {number} feedsFailed
 * @property {number} itemsStored
 * @property {number} articlesOk
 * @property {number} articlesSummaryOnly
 * @property {number} imagesStored
 * @property {number} bytesStored
 */

/**
 * @typedef {object} SyncProgress
 * @property {'feeds' | 'articles'} phase
 * @property {number} done
 * @property {number} total
 * @property {string | null} publicationName Name of the Publication this unit
 *   belonged to, or null for the opening event of a phase.
 */

/**
 * @typedef {object} RunSyncOptions
 * @property {SyncStore} store
 * @property {Fetcher} fetcher
 * @property {(text: string, deps: { url: string, DOMParser: any }) => any} parseFeed
 * @property {(html: string, url: string) => any} extractArticle Returns an
 *   `Article` (see extract-core.js): `{ ok, title, byline, html, wordCount,
 *   imageUrls, reason }`.
 * @property {(html: string) => string} sanitizeSummary
 * @property {any} DOMParser The constructor: the browser global, or the export
 *   from tools/testing/dom.js.
 * @property {() => number} [now] Epoch ms; defaults to `Date.now`.
 * @property {Partial<import('./retention.js').RetentionLimits>} [limits]
 * @property {(progress: SyncProgress) => void} [onProgress]
 * @property {() => Promise<void> | void} [yieldToUi] Awaited between units.
 * @property {string[] | null} [publicationIds] Restrict the run to these
 *   Publications; null (the default) means every Enabled one.
 * @property {number} [concurrency]
 */

/**
 * Hand back the event loop between units of work. `scheduler.yield()` where the
 * browser has it, a macrotask otherwise.
 * @returns {Promise<void>}
 */
function defaultYield() {
  const scheduler = /** @type {any} */ (globalThis).scheduler;
  if (scheduler && typeof scheduler.yield === "function") {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    setTimeout(resolve);
  });
}

/**
 * A short, stable token for why something failed, stored in `lastError` and
 * `summaryOnlyReason`: the fetcher's `kind`, the Feed parser's `reason`, the
 * Article's `reason`, or the error name as a last resort.
 * @param {any} error
 * @returns {string}
 */
function reasonOf(error) {
  return error?.kind || error?.reason || error?.name || "error";
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Workers pull
 * from a shared cursor, so the first `concurrency` units start in list order
 * and a slow unit never blocks the others.
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<void>} worker
 * @returns {Promise<void>}
 */
async function pool(items, concurrency, worker) {
  let cursor = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  const runners = [];
  for (let lane = 0; lane < lanes; lane++) {
    runners.push(
      (async () => {
        while (cursor < items.length) {
          const index = cursor;
          cursor += 1;
          await worker(items[index]);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/**
 * One refresh pass: fetch every Enabled Publication's Feed, store its Items,
 * then Pre-fetch Articles and their images within the caps.
 *
 * A Feed that fails is recorded on its Publication (`lastError`) and the run
 * continues; an Original that fails, or extracts to too little text, leaves the
 * Item Summary-only with the reason. Each fetch gets one retry unless the
 * failure is final (404, too large, no Proxy).
 *
 * @param {RunSyncOptions} options
 * @returns {Promise<SyncSummary>}
 */
export async function runSync({
  store,
  fetcher,
  parseFeed,
  extractArticle,
  sanitizeSummary,
  DOMParser,
  now = Date.now,
  limits = {},
  onProgress = () => {},
  yieldToUi = defaultYield,
  publicationIds = null,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const {
    keepPerPublication = DEFAULT_RETENTION.keepPerPublication,
    prefetchPerPublication = DEFAULT_RETENTION.prefetchPerPublication,
    maxImageBytesPerArticle = DEFAULT_RETENTION.maxImageBytesPerArticle,
  } = limits;

  /** A fresh inert document for one HTML string, built from the injected DOM. */
  const windowFor = (/** @type {string} */ html) => ({
    document: new DOMParser().parseFromString(html, "text/html"),
  });

  /**
   * Fetch text with one retry on a non-final failure.
   * @param {string} url
   * @returns {Promise<import('./fetcher.js').FetchTextResult>}
   */
  async function fetchTextTwice(url) {
    try {
      return await fetcher.fetchText(url);
    } catch (error) {
      if (FINAL_FAILURES.has(reasonOf(error))) throw error;
      return await fetcher.fetchText(url);
    }
  }

  /** @type {SyncSummary} */
  const summary = {
    feedsOk: 0,
    feedsFailed: 0,
    itemsStored: 0,
    articlesOk: 0,
    articlesSummaryOnly: 0,
    imagesStored: 0,
    bytesStored: 0,
  };

  const enabled = await store.getEnabledPublications();
  const wanted = publicationIds
    ? enabled.filter((p) => publicationIds.includes(p.id))
    : enabled;
  // The planners in sync-plan.js / retention.js describe the minimum shape they
  // need (`PublicationRecord`, `ItemRecord`) and carry every other field
  // through untouched, and `ItemRecord.saved` is a boolean where the stored row
  // holds 0 or 1 (IndexedDB cannot index a boolean — see db.js). The rows that
  // come back are the full `PublicationRow`/`ItemRow`, so the queues are typed
  // loosely here rather than cast field by field.
  /** @type {any[]} */
  const queue = planFeedFetches(wanted);

  // --- Feeds ---------------------------------------------------------------
  let feedsDone = 0;
  onProgress({
    phase: "feeds",
    done: 0,
    total: queue.length,
    publicationName: null,
  });
  await pool(queue, concurrency, async (publication) => {
    try {
      const { text } = await fetchTextTwice(publication.feedUrl);
      const feed = parseFeed(text, {
        url: publication.feedUrl,
        DOMParser,
      });
      const fetchedAt = now();
      const rows = feed.items.map((item) =>
        itemRowFor(item, publication.id, fetchedAt, sanitizeSummary, windowFor),
      );
      summary.itemsStored += await store.upsertItems(rows);
      await store.trimItems(publication.id, { keepPerPublication });
      await store.setPublicationSynced(publication.id, {
        at: fetchedAt,
        error: null,
      });
      summary.feedsOk += 1;
    } catch (error) {
      await store.setPublicationSynced(publication.id, {
        at: now(),
        error: reasonOf(error),
      });
      summary.feedsFailed += 1;
    }
    feedsDone += 1;
    onProgress({
      phase: "feeds",
      done: feedsDone,
      total: queue.length,
      publicationName: publication.name,
    });
    await yieldToUi();
  });

  // --- Articles ------------------------------------------------------------
  const nameById = new Map(queue.map((p) => [p.id, p.name]));
  /** @type {any} */
  const byPublication = await store.itemsNeedingArticles(
    queue.map((p) => p.id),
  );
  /** @type {any[]} */
  const articleQueue = planArticleFetches(byPublication, {
    prefetchPerPublication,
  });
  let articlesDone = 0;
  onProgress({
    phase: "articles",
    done: 0,
    total: articleQueue.length,
    publicationName: null,
  });
  await pool(articleQueue, concurrency, async (item) => {
    await prefetchArticle(item);
    articlesDone += 1;
    onProgress({
      phase: "articles",
      done: articlesDone,
      total: articleQueue.length,
      publicationName: nameById.get(item.publicationId) ?? null,
    });
    await yieldToUi();
  });

  // Only a run that actually had something to fetch may claim a Sync time. A
  // first boot with no Enabled Publications would otherwise stamp `lastSyncAt`
  // and leave Settings reading "Last synced: now, 0 Items" — a Sync that never
  // happened. Found by ticket 08.
  if (queue.length > 0) {
    await store.setLastSyncAt(now());
    // Eviction closes every run (spec story 34). It applies the same planners
    // `trimItems` used above plus the global age and size passes, and it never
    // touches a Saved Item. It is deliberately not reported in `SyncSummary`:
    // the Settings storage line re-measures the tables after a Sync, which is
    // the honest number, and the pipeline's summary shape is asserted whole by
    // a test this ticket does not own. A run with nothing to fetch has nothing
    // to Evict either, hence the same guard as the Sync stamp.
    try {
      await runEviction({ store, limits, now: now() });
    } catch (error) {
      // A failed Eviction is not a failed Sync: the Items are still stored and
      // the next run tries again.
      console.warn("Eviction after the Sync failed:", error);
    }
  }
  return summary;

  /**
   * Fetch one Original, extract it, store the Article and its images. Any
   * failure leaves the Item Summary-only with a reason instead of throwing.
   * @param {ItemRow} item
   * @returns {Promise<void>}
   */
  async function prefetchArticle(item) {
    if (!item.link) {
      await store.markSummaryOnly(item.id, "no-link");
      summary.articlesSummaryOnly += 1;
      return;
    }
    /** @type {import('./fetcher.js').FetchTextResult} */
    let page;
    try {
      page = await fetchTextTwice(item.link);
    } catch (error) {
      await store.markSummaryOnly(item.id, reasonOf(error));
      summary.articlesSummaryOnly += 1;
      return;
    }
    const article = extractArticle(page.text, page.finalUrl || item.link);
    if (!article.ok) {
      await store.markSummaryOnly(item.id, article.reason || "no-content");
      summary.articlesSummaryOnly += 1;
      return;
    }
    const images = await fetchImages(article.imageUrls);
    const bytes = byteLength(article.html);
    await store.putArticle({
      itemId: item.id,
      title: article.title,
      byline: article.byline,
      html: article.html,
      wordCount: article.wordCount,
      bytes,
      extractedAt: now(),
    });
    const imageBytes = await store.putImages(item.id, images);
    summary.articlesOk += 1;
    summary.imagesStored += images.length;
    summary.bytesStored += bytes + imageBytes;
  }

  /**
   * Fetch an Article's images within the per-Article budget, in document
   * order. An image that fails, or would take the Article over the budget, is
   * skipped; the Article is stored either way, and the Reader falls back to
   * the network for an image it cannot find (ticket 10).
   * @param {string[]} urls
   * @returns {Promise<import('./store.js').ImageInput[]>}
   */
  async function fetchImages(urls) {
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
        // Skip this image; an Article with one missing picture still reads.
      }
    }
    return stored;
  }
}

/**
 * Turn one parsed Feed Item into the row the `items` table holds. The id is
 * `publicationId + ":" + feedItemId` because Feed ids are unique only within
 * their own Feed (ticket 02's notes). Summary markup is sanitized here, before
 * it ever reaches storage, and `summaryText` is derived from the sanitized
 * markup so the two can never disagree.
 *
 * @param {any} item One `Item` from `parseFeed`.
 * @param {string} publicationId
 * @param {number} fetchedAt Epoch ms; also the `publishedAt` of an undated Item.
 * @param {(html: string) => string} sanitizeSummary
 * @param {(html: string) => { document: any }} windowFor
 * @returns {ItemRow}
 */
function itemRowFor(
  item,
  publicationId,
  fetchedAt,
  sanitizeSummary,
  windowFor,
) {
  const summaryHtml = sanitizeSummary(
    item.summaryHtml || item.contentHtml || "",
  );
  const published = timeOf(item.publishedAt);
  return {
    id: `${publicationId}:${item.id}`,
    publicationId,
    feedItemId: item.id,
    title: item.title || "",
    link: item.link ?? null,
    publishedAt: Number.isFinite(published) ? published : fetchedAt,
    summaryHtml,
    summaryText: toPlainText(summaryHtml, windowFor),
    thumbnailUrl: item.thumbnailUrl ?? null,
    read: false,
    saved: 0,
    readingPosition: 0,
    summaryOnly: false,
    summaryOnlyReason: null,
    hasArticle: false,
    fetchedAt,
  };
}

/**
 * UTF-8 byte length of a string, for the Retention size accounting.
 * @param {string} text
 * @returns {number}
 */
function byteLength(text) {
  return new TextEncoder().encode(text).length;
}
