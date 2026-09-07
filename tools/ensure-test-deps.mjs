// Install the test-only DOM stack on demand, without committing anything.
//
// The app has no build and no committed node_modules (ADR-0002). Tests for Feed
// parsing and Extraction still need a real DOM (jsdom) plus the same Readability and
// DOMPurify the browser loads from esm.sh (ADR-0010). Node cannot import https
// URLs, so `npm test` runs this first: it installs the pinned packages into the
// gitignored ./node_modules with --no-save so package.json stays dependency-free.
// Bump versions here AND in the browser choke points together.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

export const TEST_DEPS = {
  jsdom: "26.1.0",
  "@mozilla/readability": "0.6.0",
  dompurify: "3.2.6",
};

const missing = Object.entries(TEST_DEPS).filter(
  ([name]) => !existsSync(resolve(ROOT, "node_modules", name, "package.json")),
);

if (missing.length) {
  const specs = missing.map(([n, v]) => `${n}@${v}`).join(" ");
  console.log(`› installing test deps (no-save): ${specs}`);
  execSync(
    `npm install --no-save --no-package-lock --no-audit --no-fund ${specs}`,
    {
      cwd: ROOT,
      stdio: "inherit",
    },
  );
} else {
  console.log("✔ test deps present.");
}
