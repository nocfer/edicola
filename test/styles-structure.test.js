// Structural checks on styles.css that brace-balance alone cannot catch.
//
// A merge once spliced the whole `/* Settings */` block between the universal
// selector's opening brace and its declaration inside
// `@media (prefers-reduced-motion: reduce)`. The file stayed brace-balanced and
// every gate passed, but the Settings screen rendered almost unstyled because
// its rules only applied to readers who prefer reduced motion. These tests
// assert the shape a screen block must have, so the same class of damage fails
// loudly next time.

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
 * Selectors that appear at the start of a line, paired with the brace depth
 * they sit at. Depth 0 means "top level", i.e. not inside any at-rule.
 * @returns {Map<string, number[]>} selector -> the depths it is declared at
 */
function selectorDepths(css) {
  /** @type {Map<string, number[]>} */
  const found = new Map();
  let depth = 0;
  for (const raw of css.split("\n")) {
    const line = raw.trimEnd();
    const match = /^(\.[A-Za-z][\w-]*)[\s,{]/.exec(line);
    if (match && depth >= 0) {
      const list = found.get(match[1]) ?? [];
      list.push(depth);
      found.set(match[1], list);
    }
    depth += (line.match(/\{/g) || []).length;
    depth -= (line.match(/\}/g) || []).length;
  }
  return found;
}

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
];

test("every screen block has its rules at the top level, not inside an at-rule", () => {
  const depths = selectorDepths(CSS);
  for (const selector of SCREEN_ANCHORS) {
    const seen = depths.get(selector);
    assert.ok(seen, `${selector} has no rule at all in styles.css`);
    assert.ok(
      seen.includes(0),
      `${selector} is only declared inside an at-rule (depths ${seen.join(", ")}); a screen block nested in a media query applies to almost nobody`,
    );
  }
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
