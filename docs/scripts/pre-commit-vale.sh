#!/usr/bin/env bash
#
# Pre-commit hook: lint staged docs/**.{mdx,md} files with Vale.
# Install: ln -s ../../docs/scripts/pre-commit-vale.sh .git/hooks/pre-commit-vale
#
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
DOCS_DIR="$ROOT_DIR/docs"

if ! command -v vale >/dev/null 2>&1; then
  echo "vale not installed — skipping prose lint (install: https://vale.sh)" >&2
  exit 0
fi

CHANGED=$(git diff --cached --name-only --diff-filter=ACMR \
  | grep -E "^docs/.*\\.(mdx|md)$" || true)

if [ -z "$CHANGED" ]; then
  exit 0
fi

cd "$DOCS_DIR"

# Strip the docs/ prefix so vale resolves paths relative to .vale.ini
RELATIVE=$(echo "$CHANGED" | sed 's|^docs/||')

# shellcheck disable=SC2086
vale --output=line $RELATIVE
