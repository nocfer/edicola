import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateCatalog,
  feedKind,
  renderTable,
} from "../tools/check-catalog.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const catalog = JSON.parse(
  readFileSync(resolve(ROOT, "data/catalog.json"), "utf8"),
);

test("the shipped Catalog validates with no problems", () => {
  assert.deepEqual(validateCatalog(catalog), []);
});

test("both seed Nations have at least 10 Publications", () => {
  const byCountry = new Map();
  for (const p of catalog.publications)
    byCountry.set(p.country, (byCountry.get(p.country) ?? 0) + 1);
  assert.ok(byCountry.get("IT") >= 10, `IT has ${byCountry.get("IT")}`);
  assert.ok(byCountry.get("GB") >= 10, `GB has ${byCountry.get("GB")}`);
});

test("validateCatalog reports one problem per violation, keyed by id", () => {
  const broken = {
    version: 1,
    categories: ["news"],
    publications: [
      {
        id: "Bad Id",
        name: "",
        country: "it",
        language: "IT",
        category: "gossip",
        feedUrl: "http://example.com/feed",
        siteUrl: "example.com",
        truncated: "yes",
        extra: 1,
      },
      {
        id: "dup",
        name: "A",
        country: "IT",
        language: "it",
        category: "news",
        feedUrl: "https://example.com/a",
        siteUrl: "https://example.com",
        truncated: true,
      },
      {
        id: "dup",
        name: "B",
        country: "ZZ",
        language: "zz",
        category: "news",
        feedUrl: "https://example.com/a",
        siteUrl: "https://example.com",
        truncated: false,
        note: "",
      },
    ],
  };
  const problems = validateCatalog(broken);
  const messages = problems.map((p) => `${p.where}: ${p.message}`);
  const expect = (where, fragment) =>
    assert.ok(
      problems.some((p) => p.where === where && p.message.includes(fragment)),
      `expected '${where}' problem containing '${fragment}' in\n${messages.join("\n")}`,
    );
  expect("Bad Id", "slug");
  expect("Bad Id", "name");
  expect("Bad Id", "country");
  expect("Bad Id", "language");
  expect("Bad Id", "category");
  expect("Bad Id", "feedUrl");
  expect("Bad Id", "siteUrl");
  expect("Bad Id", "truncated");
  expect("Bad Id", "unknown key 'extra'");
  expect("dup", "duplicate id");
  expect("dup", "country");
  expect("dup", "language");
  expect("dup", "feedUrl already used");
  expect("dup", "note");
});

test("validateCatalog rejects a wrong version and unknown categories", () => {
  const problems = validateCatalog({
    version: 2,
    categories: ["news", "gossip", "news"],
    publications: [],
  });
  const messages = problems.map((p) => p.message);
  assert.ok(messages.some((m) => m.includes("version")));
  assert.ok(messages.some((m) => m.includes("unknown category 'gossip'")));
  assert.ok(messages.some((m) => m.includes("duplicate category 'news'")));
});

test("feedKind recognises RSS, Atom, RDF and JSON Feed, and rejects HTML", () => {
  assert.equal(
    feedKind(
      '<?xml version="1.0"?>\n<!-- c --><rss version="2.0"><channel/></rss>',
    ),
    "rss",
  );
  assert.equal(
    feedKind('\uFEFF<feed xmlns="http://www.w3.org/2005/Atom"></feed>'),
    "atom",
  );
  assert.equal(
    feedKind(
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>',
    ),
    "rdf",
  );
  assert.equal(
    feedKind('{"version":"https://jsonfeed.org/version/1.1","items":[]}'),
    "json",
  );
  assert.equal(
    feedKind("<!DOCTYPE html><html><body>blocked</body></html>"),
    null,
  );
  assert.equal(feedKind('{"error":"nope"}'), null);
  assert.equal(feedKind("not xml at all"), null);
});

test("renderTable lists failures first and escapes pipes", () => {
  const table = renderTable([
    { id: "a", feedUrl: "https://a/x", ok: true, status: "200", detail: "rss" },
    {
      id: "b",
      feedUrl: "https://b/y",
      ok: false,
      status: "403",
      detail: "a|b",
    },
  ]);
  const lines = table.split("\n");
  assert.match(lines[0], /^\| Result \|/);
  assert.match(lines[2], /^\| FAIL \| b \| 403 \| a\\\|b \|/);
  assert.match(lines[3], /^\| ok \| a \| 200 \| rss \|/);
});
