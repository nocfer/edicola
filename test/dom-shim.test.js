import { test } from "node:test";
import assert from "node:assert/strict";
import {
  windowFor,
  DOMParser,
  Readability,
  purifierFor,
} from "../tools/testing/dom.js";

test("DOMParser parses XML with namespaced elements", () => {
  const doc = new DOMParser().parseFromString(
    '<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Hi</title><content:encoded>&lt;p&gt;x&lt;/p&gt;</content:encoded></item></channel></rss>',
    "text/xml",
  );
  assert.equal(doc.querySelector("item > title").textContent, "Hi");
  assert.equal(doc.getElementsByTagName("content:encoded").length, 1);
});

test("Readability extracts an article from a jsdom document", () => {
  const body = Array.from(
    { length: 12 },
    (_, i) =>
      `<p>Paragraph ${i} of a reasonably long article body used only to exercise extraction in tests.</p>`,
  ).join("");
  const { document } = windowFor(
    `<!doctype html><html><head><title>T</title></head><body><nav>menu</nav><article><h1>Headline</h1>${body}</article></body></html>`,
  );
  const res = new Readability(document).parse();
  assert.ok(res);
  assert.match(res.textContent, /Paragraph 3/);
});

test("DOMPurify strips scripts and event handlers under jsdom", () => {
  const purify = purifierFor(windowFor());
  const out = purify.sanitize(
    '<p onclick="x()">ok<script>bad()</script><a href="javascript:z">l</a></p>',
  );
  assert.equal(out, "<p>ok<a>l</a></p>");
});
