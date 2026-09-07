// Static import/export resolver — catches the class of bug that took the whole
// deployed app down: a committed module imported a named export that no shipped
// module actually provided (`moonIllumination`), so ES module linking threw at
// load and nothing ran. `node --check` can't see this (it checks one file in
// isolation); a bundler would, but this is a no-build project. So we cross-check
// every relative named import against the target file's named exports.
//
// The codebase uses only named imports + named exports (no default/namespace/
// re-exports), which is exactly what makes this static pass sound. If that ever
// changes, extend the parser below.
//
// Usage:
//   node tools/check-imports.mjs            # scans src/ and test/, exits 1 on a gap
//   import { checkImports } from './tools/check-imports.mjs'  # returns problems[]

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

/** All `.js` files under a directory, recursively. */
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

/**
 * Named exports of one module. Anchored to line starts so commented-out or
 * in-string occurrences (e.g. a `https://` URL) can't produce phantom matches.
 */
export function namedExports(src) {
  const names = new Set();
  // export [async] function NAME / export class NAME
  for (const m of src.matchAll(
    /^[ \t]*export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
  ))
    names.add(m[1]);
  for (const m of src.matchAll(/^[ \t]*export\s+class\s+([A-Za-z0-9_$]+)/gm))
    names.add(m[1]);
  // export const|let|var A, B = ...  (take every identifier before the first `=`)
  for (const m of src.matchAll(
    /^[ \t]*export\s+(?:const|let|var)\s+([^=;\n]+)/gm,
  )) {
    for (const id of m[1].split(",")) {
      const name = id.trim().match(/^[A-Za-z0-9_$]+/)?.[0];
      if (name) names.add(name);
    }
  }
  // export { a, b as c }  (NOT a re-export `... } from '...'`) → exported name is after `as`
  for (const m of src.matchAll(/^[ \t]*export\s*\{([\s\S]*?)\}(?!\s*from)/gm)) {
    for (const part of m[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  // re-export `export { a, b as c } from '...'` (e.g. src/render.js re-exporting
  // lit-html from a CDN). The exported name is after `as`; the source is a CDN
  // URL we don't resolve, so we trust the re-exported name exists.
  for (const m of src.matchAll(
    /^[ \t]*export\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]/gm,
  )) {
    for (const part of m[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  if (/^[ \t]*export\s+default\b/m.test(src)) names.add("default");
  return names;
}

/**
 * Relative named imports of one module: `[{ names, spec, line }]`. Only imports
 * from a relative specifier (`./` or `../`) are returned — bare/CDN specifiers
 * aren't ours to resolve. The imported (source-side) name is taken before `as`.
 */
export function relativeImports(src) {
  const imports = [];
  for (const m of src.matchAll(
    /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/gm,
  )) {
    const spec = m[2];
    if (!spec.startsWith(".")) continue;
    const names = m[1]
      .split(",")
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter(Boolean);
    const line = src.slice(0, m.index).split("\n").length;
    imports.push({ names, spec, line });
  }
  return imports;
}

/** Cross-check every relative import against its target's exports. */
export function checkImports(dirs = ["src", "test"]) {
  const files = dirs.flatMap((d) => jsFiles(resolve(ROOT, d)));
  // Exports are read lazily and cached by resolved path, so a target in any
  // directory or with any extension (e.g. tools/*.mjs) resolves correctly — the
  // import specifiers already carry the explicit extension.
  const exportsCache = new Map();
  const exportsOf = (absPath) => {
    if (!exportsCache.has(absPath))
      exportsCache.set(absPath, namedExports(readFileSync(absPath, "utf8")));
    return exportsCache.get(absPath);
  };
  const problems = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const { names, spec, line } of relativeImports(src)) {
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) {
        problems.push({
          file,
          line,
          spec,
          name: null,
          reason: `imported file does not exist: ${spec}`,
        });
        continue;
      }
      const exp = exportsOf(target);
      for (const name of names) {
        if (!exp.has(name))
          problems.push({
            file,
            line,
            spec,
            name,
            reason: `'${spec}' has no export named '${name}'`,
          });
      }
    }
  }
  return problems;
}

// CLI entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkImports();
  if (problems.length) {
    for (const p of problems)
      console.error(`✗ ${relative(ROOT, p.file)}:${p.line} — ${p.reason}`);
    console.error(`\n${problems.length} unresolved import(s).`);
    process.exit(1);
  }
  console.log("✔ All relative imports resolve to a real export.");
}
