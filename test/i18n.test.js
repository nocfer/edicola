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
  tCount,
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

// Counted copy: a key that inflects carries one entry per plural category
// (`.one`, `.other` — both Languages use those two) and is read with tCount().
// A bare stem left alongside the forms would be dead, and a lone form would
// print the wrong noun for half the counts, so both are checked.
test("every plural form has its sibling, and no dead stem beside it", () => {
  for (const [lang, table] of Object.entries(DICTIONARIES)) {
    for (const key of Object.keys(table)) {
      const match = /^(.*)\.(one|other)$/.exec(key);
      if (!match) continue;
      const [, stem, category] = match;
      const sibling = category === "one" ? `${stem}.other` : `${stem}.one`;
      assert.ok(sibling in table, `${lang}.${key} has no ${sibling}`);
      assert.ok(
        !(stem in table),
        `${lang}.${stem} is dead: the plural forms beside it always win`,
      );
    }
  }
});

test("tCount picks the form the Language asks for", () => {
  setLang("en");
  assert.equal(tCount("settings.storage.rows", 1), "1 row");
  assert.equal(tCount("settings.storage.rows", 0), "0 rows");
  assert.equal(tCount("settings.storage.rows", 12), "12 rows");
  assert.equal(tCount("reader.words", 1), "1 word");
  assert.equal(tCount("sync.failed", 1), "1 Feed could not be reached");
  assert.equal(tCount("sync.failed", 3), "3 Feeds could not be reached");

  setLang("it");
  assert.equal(tCount("settings.storage.rows", 1), "1 riga");
  assert.equal(tCount("settings.storage.rows", 4), "4 righe");
  assert.equal(tCount("pubs.add.items", 1), "1 titolo");
  assert.equal(tCount("pubs.add.items", 9), "9 titoli");
  setLang("en");
});

test("tCount carries the other placeholders through", () => {
  setLang("en");
  assert.equal(
    tCount("pubs.groupAria", 1, { category: "Daily" }),
    "Daily, 1 Publication",
  );
  assert.equal(
    tCount("pubs.groupAria", 5, { category: "Daily" }),
    "Daily, 5 Publications",
  );
});

test("tCount degrades instead of printing the key", () => {
  setLang("en");
  // A key with no forms at all: the stem is used as it stands.
  assert.equal(tCount("today.unreadCount", 2), "2 unread");
  // A key with neither forms nor an entry: the key itself, as t() does.
  assert.equal(tCount("no.such.counted.key", 2), "no.such.counted.key");
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
