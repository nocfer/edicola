// Browser choke point for Readability and DOMPurify (ADR-0002). The only file
// that imports them from the CDN; versions match tools/ensure-test-deps.mjs.
// Needs a window with DOMParser, so it runs on the page, not in a Worker.
// @ts-expect-error CDN URL imports have no type declarations under checkJs.
import { Readability } from "https://esm.sh/@mozilla/readability@0.6.0";
// @ts-expect-error
import { default as createDOMPurify } from "https://esm.sh/dompurify@3.2.6";
import { extractArticle, sanitizeSummary } from "./extract-core.js";

const purify = createDOMPurify(window);

/**
 * A parsed, inert document for one HTML string, with `url` as its base.
 * @param {string} html
 * @param {string} [url]
 * @returns {{ document: Document }}
 */
export function windowFor(html, url) {
  const document = new DOMParser().parseFromString(html, "text/html");
  if (url) {
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head.prepend(base);
  }
  return { document };
}

/** @param {string} html @param {string} url */
export function extractArticleInBrowser(html, url) {
  return extractArticle(html, { url, windowFor, Readability, purify });
}

/** @param {string} html */
export function sanitizeSummaryInBrowser(html) {
  return sanitizeSummary(html, purify);
}
