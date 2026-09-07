// Stamp the service-worker cache version with a content hash of the shell files.
//
// The old workflow required bumping `CACHE = 'edicola-vNN'` in sw.js by hand on
// every shell change — the #1 documented time-sink (a forgotten bump left
// returning visitors on stale code forever). This computes the version from the
// actual bytes of every SHELL entry, so it can never drift from the content.
//
// Usage:
//   node tools/stamp-sw.mjs          # rewrite the CACHE line in sw.js
//   node tools/stamp-sw.mjs --check  # exit 1 if the committed hash is stale (CI)

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SW_PATH = resolve(ROOT, "sw.js");

/** Extract the SHELL array entries from sw.js source. */
function shellEntries(src) {
  const block = src.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!block) throw new Error("Could not find the SHELL array in sw.js");
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Map a scope-relative shell path to a real file. `./` is the index document. */
function toFile(entry) {
  const rel = entry === "./" ? "./index.html" : entry;
  return resolve(ROOT, rel);
}

/** 8-char sha256 over each shell file's path + bytes (order-independent). */
function computeHash(src) {
  const entries = shellEntries(src);
  const hash = createHash("sha256");
  for (const entry of [...entries].sort()) {
    hash.update(entry);
    hash.update(readFileSync(toFile(entry)));
  }
  return hash.digest("hex").slice(0, 8);
}

const src = readFileSync(SW_PATH, "utf8");
// Quote-agnostic: the formatter (Biome) may rewrite single to double quotes.
const current = src.match(/const CACHE = ["']([^"']+)["'];/)?.[1];
if (!current) throw new Error("Could not find the CACHE constant in sw.js");
const next = `edicola-${computeHash(src)}`;
const check = process.argv.includes("--check");

if (current === next) {
  console.log(`✔ sw.js CACHE is up to date (${next}).`);
  process.exit(0);
}

if (check) {
  console.error(`✗ sw.js CACHE is stale: '${current}' should be '${next}'.`);
  console.error("  Run `npm run stamp` and commit the change.");
  process.exit(1);
}

writeFileSync(
  SW_PATH,
  src.replace(/const CACHE = ["'][^"']+["'];/, `const CACHE = "${next}";`),
);
console.log(`✔ Stamped sw.js CACHE: '${current}' → '${next}'.`);
