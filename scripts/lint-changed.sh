#!/usr/bin/env bash
# Lint only the TypeScript source files changed against a base ref.
# Usage: bun run lint:changed [base-ref]
set -euo pipefail

BASE_SHA="${1:-${BASE_SHA:-}}"

if [ -z "$BASE_SHA" ] || [ "$BASE_SHA" = "0000000000000000000000000000000000000000" ]; then
  BASE_SHA="HEAD^"
fi

CHANGED="$(git diff --name-only --diff-filter=ACMR "$BASE_SHA" HEAD -- '*.ts' '*.tsx' \
  | grep '^src/' \
  | grep -v '^src/routeTree.gen.ts$' || true)"

if [ -z "$CHANGED" ]; then
  echo "No changed TypeScript source files to lint."
  exit 0
fi

echo "Linting changed source files:"
echo "$CHANGED"
echo "$CHANGED" | xargs bunx eslint
