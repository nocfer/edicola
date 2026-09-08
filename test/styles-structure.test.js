// Structural checks on styles.css that brace-balance alone cannot catch.
//
// A merge once spliced the whole `/* Settings */` block between the universal
// selector's opening brace and its declaration inside
// `@media (prefers-reduced-motion: reduce)`. The file stayed brace-balanced and
// every gate passed, but the Settings screen rendered almost unstyled because
// its rules only applied to readers who prefer reduced motion. These tests
// assert the shape a screen block must have, so the same class of damage fails
// loudly next time.
//
// The second guard here is about a slower kind of damage. Ticket after ticket
// added its screen's rules to the end of the file, and a primitive that already
// had a block near the top would quietly acquire a second era hundreds of lines
// down. Both eras are valid CSS, both pass every gate, and the later one wins —
// so a reader who finds the first block and stops reading is looking at
// declarations that never apply. Redeclaring a property is allowed only in the
// rule immediately following, where both are visible at once.
//
// Both guards read the stylesheet through one `rulesOf()` walk, so they cannot
// disagree about where a rule sits. An earlier version walked the braces twice
// and only one walk ignored comments, which meant a `{` inside a comment would
// shift one guard's idea of nesting and not the other's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(
  resolve(fileURLToPath(import.meta.url), "../../src/styles.css"),
  "utf8",
);

/**
 * One rule in the stylesheet.
 * @typedef {object} Rule
 * @property {string} selector Whitespace-collapsed selector list.
 * @property {number} line 1-based line the selector starts on.
 * @property {string} body Everything between the braces.
 * @property {boolean} inAtRule The rule is nested inside an at-rule, so it
 *   applies only when that at-rule matches.
 */

/**
 * Blank every comment, keeping the newlines so reported line numbers hold. A
 * brace or a semicolon inside a comment is not code, and reading it as code
 * silently shifts everything after it.
 * @param {string} css
 * @returns {string}
 */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Every rule in the stylesheet, in source order. At-rules themselves are not
 * rules and are left out; the rules inside them come back flagged.
 * @param {string} css
 * @returns {Rule[]}
 */
function rulesOf(css) {
  const clean = blankComments(css);
  /** @type {Rule[]} */
  const rules = [];
  /** @type {{ prelude: string, line: number, start: number }[]} */
  const open = [];
  let prelude = "";
  let line = 1;
  let preludeLine = 1;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === "\n") line += 1;
    if (ch === "{") {
      open.push({
        prelude: prelude.trim().replace(/\s+/g, " "),
        line: preludeLine,
        start: i + 1,
      });
      prelude = "";
      preludeLine = line;
      continue;
    }
    if (ch === "}") {
      const done = open.pop();
      if (done && !done.prelude.startsWith("@")) {
        rules.push({
          selector: done.prelude,
          line: done.line,
          body: clean.slice(done.start, i),
          inAtRule: open.some((o) => o.prelude.startsWith("@")),
        });
      }
      prelude = "";
      preludeLine = line;
      continue;
    }
    if (prelude.trim() === "") preludeLine = line;
    prelude += ch;
  }
  // A rule is recorded when it closes, so a rule wrapping another would land
  // after it. Sort so "adjacent" below means adjacent in the source.
  return rules.sort((a, b) => a.line - b.line);
}

/**
 * The property names a rule body declares, lowercased. Nested blocks are
 * dropped first so a declaration inside one is not counted as the outer rule's
 * own.
 * @param {string} body
 * @returns {string[]}
 */
function declaredProperties(body) {
  return body
    .replace(/\{[^}]*\}/g, "")
    .split(";")
    .map((decl) => decl.split(":")[0].trim().toLowerCase())
    .filter((name) => /^[a-z-]+$/.test(name));
}

/**
 * Whether one of a selector list's parts leads with this exact class, so
 * `.card` matches `.card` and `.card__title p` but not `.card--read`.
 * @param {string} selector
 * @param {string} cls
 */
function leadsWith(selector, cls) {
  const leading = new RegExp(`^${cls}(?![\\w-])`);
  return selector.split(",").some((part) => leading.test(part.trim()));
}

const RULES = rulesOf(CSS);

// One representative class per screen block. If a block is ever nested inside
// an at-rule again, its representative loses its top-level rule and this fails.
const SCREEN_ANCHORS = [
  ".screen",
  ".tabbar",
  ".card",
  ".pubs__nation",
  ".today__card",
  ".reader__body",
  ".settings__subtitle",
  ".input",
  ".update",
  ".saved__card",
  ".unread__count",
  ".feed__card",
  ".ramp",
  ".story__frame",
];

test("the stylesheet parses to a plausible number of rules", () => {
  // Guards the two tests below: a walker that silently returned nothing, or
  // almost nothing, would make both of them vacuously pass.
  assert.ok(
    RULES.length > 150,
    `only ${RULES.length} rules parsed out of styles.css`,
  );
});

test("every screen block has its rules at the top level, not inside an at-rule", () => {
  for (const selector of SCREEN_ANCHORS) {
    const mentions = RULES.filter((rule) => leadsWith(rule.selector, selector));
    assert.ok(
      mentions.length > 0,
      `${selector} has no rule at all in styles.css`,
    );
    assert.ok(
      mentions.some((rule) => !rule.inAtRule),
      `${selector} is only declared inside an at-rule (lines ${mentions.map((r) => r.line).join(", ")}); a screen block nested in a media query applies to almost nobody`,
    );
  }
});

test("no primitive grows a second era that silently shadows the first", () => {
  // At-rules are skipped: a token block redefining the same custom properties
  // under `[data-theme]`, or a rule resized inside a media query, is the point
  // of an at-rule rather than a mistake.
  //
  // This keys on the literal selector string, so it catches only one shape of
  // the damage: the SAME selector declared twice. A more specific selector
  // shadowing a general one — `.today__chipwrap .chip` over `.chip--on` — is
  // invisible here, and CLAUDE.md gotcha 9 says so.
  const topLevel = RULES.filter((rule) => !rule.inAtRule);

  // selector -> the rules declaring it, as indices into `topLevel`
  /** @type {Map<string, number[]>} */
  const declaredBy = new Map();
  topLevel.forEach((rule, index) => {
    for (const selector of rule.selector.split(",").map((s) => s.trim())) {
      if (selector === "") continue;
      const list = declaredBy.get(selector) ?? [];
      list.push(index);
      declaredBy.set(selector, list);
    }
  });

  /** @type {string[]} */
  const shadowed = [];
  for (const [selector, indices] of declaredBy) {
    if (indices.length < 2) continue;
    // property -> the rule indices that declare it for this selector
    /** @type {Map<string, number[]>} */
    const byProperty = new Map();
    for (const index of indices) {
      for (const property of declaredProperties(topLevel[index].body)) {
        const list = byProperty.get(property) ?? [];
        if (!list.includes(index)) list.push(index);
        byProperty.set(property, list);
      }
    }
    for (const [property, where] of byProperty) {
      if (where.length < 2) continue;
      // Adjacent rules are the deliberate "all of these, then the small ones
      // differently" shape, and both are on screen together. Anything further
      // apart is a second era.
      const adjacent = where.every(
        (index, n) => n === 0 || index === where[n - 1] + 1,
      );
      if (adjacent) continue;
      const lines = where.map((index) => topLevel[index].line).join(", ");
      shadowed.push(`${selector} redeclares ${property} at lines ${lines}`);
    }
  }

  assert.deepEqual(
    shadowed,
    [],
    `a later rule silently overrides an earlier one for the same selector:\n  ${shadowed.join("\n  ")}\nMove the declarations together, or drop the one that never applies.`,
  );
});

test("styles.css is brace balanced", () => {
  let depth = 0;
  for (const ch of CSS) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    assert.ok(depth >= 0, "a closing brace appears before its opening brace");
  }
  assert.equal(depth, 0, "unclosed rule in styles.css");
});

test("the reduced-motion reset still carries its declaration", () => {
  // The splice replaced this rule's body, silently disabling the reset.
  const block =
    /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{([^}]*)\}/.exec(
      CSS,
    );
  assert.ok(block, "the universal reduced-motion reset is gone");
  assert.match(block[1], /transition-duration:\s*0s\s*!important/);
});
