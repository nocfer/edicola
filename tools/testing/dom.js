// Node-side DOM for tests (ADR-0010). The browser passes the real `DOMParser`,
// `document`, Readability and DOMPurify into the pure modules; tests pass these
// instead. Lives under tools/ (not test/) so `node --test` does not run it as a
// test file. Packages come from the on-demand install in ensure-test-deps.mjs.
//
// jsdom rather than linkedom: DOMPurify silently returns its input UNSANITIZED
// on a DOM it does not support (linkedom is one), which would make every
// sanitizer test pass vacuously. purifierFor() asserts support to fail loudly.
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import createDOMPurify from "dompurify";

/** A fresh jsdom window for one HTML string; pass `url` so relative links resolve. */
export function windowFor(
  html = "<!doctype html><html><body></body></html>",
  url = "https://example.test/",
) {
  return new JSDOM(html, { url }).window;
}

/** DOMParser class (XML with namespaces, and HTML) matching the browser API. */
export const DOMParser = new JSDOM("").window.DOMParser;

export { Readability };

/** DOMPurify bound to a window; throws if DOMPurify would no-op on this DOM. */
export function purifierFor(window) {
  const purify = createDOMPurify(window);
  if (!purify.isSupported) {
    throw new Error(
      "DOMPurify does not support this DOM; sanitizing would be a no-op",
    );
  }
  return purify;
}
