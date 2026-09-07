#!/usr/bin/env node
// Install the local git pre-push hook. The hook itself is intentionally a thin
// shim that execs the committed, version-controlled tools/pre-push.sh — so the
// gate logic lives in the repo and this only needs to run once per clone.
import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const gitDir = execSync("git rev-parse --git-dir").toString().trim();
const hookDir = join(gitDir, "hooks");
const hookPath = join(hookDir, "pre-push");

const shim = `#!/bin/sh
# Auto-installed by \`npm run install:hooks\`. Delegates to the committed gate.
exec "$(git rev-parse --show-toplevel)/tools/pre-push.sh" "$@"
`;

mkdirSync(hookDir, { recursive: true });
writeFileSync(hookPath, shim);
chmodSync(hookPath, 0o755);
console.log(`✓ installed pre-push hook → ${hookPath}`);
