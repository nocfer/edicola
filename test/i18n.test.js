// i18n completeness: both Languages carry the same keys and the same {…}
// placeholders, `t()` falls back sanely, and the Intl helpers follow the
// current Language.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DICTIONARIES,
  en,
  it,
  t,
  setLang,
  getLang,
  formatDate,
  formatRelative,
} from "../src/i18n.js";

test("en and it are the dictionaries", () => {
  assert.deepEqual(Object.keys(DICTIONARIES).sort(), ["en", "it"]);
  assert.equal(DICTIONARIES.en, en);
  assert.equal(DICTIONARIES.it, it);
});

test("every key in en exists in it and vice versa", () => {
  const enKeys = Object.keys(en).sort();
  const itKeys = Object.keys(it).sort();
  assert.deepEqual(
    itKeys.filter((k) => !enKeys.includes(k)),
    [],
    "keys in it missing from en",
  );
  assert.deepEqual(
    enKeys.filter((k) => !itKeys.includes(k)),
    [],
    "keys in en missing from it",
  );
});

test("the {…} placeholders match across Languages", () => {
  const ph = (s) =>
    (String(s).match(/\{[a-zA-Z0-9]+\}/g) || []).sort().join(",");
  for (const k of Object.keys(en)) {
    assert.equal(ph(it[k]), ph(en[k]), `placeholders differ for "${k}"`);
  }
});

test("no dictionary value is empty", () => {
  for (const [lang, table] of Object.entries(DICTIONARIES)) {
    for (const [k, v] of Object.entries(table)) {
      assert.ok(String(v).trim().length > 0, `${lang}.${k} is empty`);
    }
  }
});

test("t() follows the Language, interpolates, and falls back", () => {
  setLang("it");
  assert.equal(getLang(), "it");
  assert.equal(t("nav.today"), "Oggi");
  assert.equal(
    t("reader.placeholder", { id: "42" }),
    it["reader.placeholder"].replace("{id}", "42"),
  );
  setLang("en");
  assert.equal(t("nav.today"), "Today");
  // missing key → the key itself
  assert.equal(t("no.such.key"), "no.such.key");
  // an unknown Language code falls back to English
  assert.equal(setLang("de"), "en");
});

test("formatDate and formatRelative use the current Language", () => {
  const date = new Date(2026, 8, 7, 12, 0, 0); // 7 September 2026, local time
  setLang("en");
  assert.match(formatDate(date), /Sep/);
  setLang("it");
  assert.match(formatDate(date), /set/i);

  const now = date.getTime();
  setLang("en");
  assert.equal(formatRelative(now - 86400 * 1000, now), "yesterday");
  assert.equal(formatRelative(now - 3 * 3600 * 1000, now), "3 hours ago");
  assert.equal(formatRelative(now - 10 * 1000, now), "now");
  setLang("it");
  assert.equal(formatRelative(now - 86400 * 1000, now), "ieri");
  assert.equal(formatRelative(now + 2 * 86400 * 1000, now), "dopodomani");
  setLang("en");
});
