// Guards against the class of bug that can take a no-build app down: a
// committed module importing a named export that no shipped module provides, so
// ES module linking throws at load and nothing runs. `node --check` cannot
// catch it (single file, no cross-module linking); this does. Runs as part of
// the normal `node --test` suite, so CI enforces it on every push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkImports } from "../tools/check-imports.mjs";

test("every relative import resolves to a real export", () => {
  const problems = checkImports();
  assert.deepEqual(
    problems,
    [],
    "Unresolved imports:\n" +
      problems.map((p) => `  ${p.file}:${p.line} — ${p.reason}`).join("\n"),
  );
});
