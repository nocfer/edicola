#!/bin/sh
# Pre-push gate — mirrors the CI workflow (.github/workflows) exactly so a red
# CI run is caught locally before the push, not after. Install once with:
#     npm run install:hooks
# (writes .git/hooks/pre-push; the repo's global tokensave chain hook already
# delegates to it). Bypass in a pinch with `git push --no-verify`.
#
# Gates, in the same order CI runs them. Any non-zero exit blocks the push.
set -e

root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "› pre-push: running CI gates locally…"

echo "  [1/4] tests (node --test)"
node --test >/dev/null

echo "  [2/4] service-worker cache stamp (stamp:check)"
npm run --silent stamp:check

echo "  [3/4] Biome lint + format (biome ci .)"
npx -y @biomejs/biome@2 ci .

echo "  [4/4] type-check (checkJs / tsc)"
npm run --silent typecheck

echo "✓ pre-push: all CI gates green."
