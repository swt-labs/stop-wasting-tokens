#!/usr/bin/env bash
#
# Bump all 7 workspace packages + root in lockstep.
#
# CLAUDE.md rule: do NOT run this script unless the user explicitly requests it.
# This is the documented escape hatch for manual versioning outside changesets.
#
# Usage:
#   scripts/bump-version.sh 0.1.0-alpha          # bump all to 0.1.0-alpha
#   scripts/bump-version.sh 0.1.0-alpha --dry-run  # preview only
#
set -euo pipefail

NEW_VERSION="${1:?usage: bump-version.sh <semver> [--dry-run]}"
DRY_RUN="${2:-}"

ROOT="$(git rev-parse --show-toplevel)"
PACKAGES=(core cli codex-driver methodology artifacts verification telemetry)

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "Would bump root + ${#PACKAGES[@]} packages to v${NEW_VERSION}"
  for p in "${PACKAGES[@]}"; do
    echo "  - packages/$p/package.json"
  done
  echo "  - package.json (root)"
  exit 0
fi

echo "Bumping all packages to v${NEW_VERSION}..."

for p in "${PACKAGES[@]}"; do
  manifest="$ROOT/packages/$p/package.json"
  node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('$manifest'));
    m.version = '$NEW_VERSION';
    fs.writeFileSync('$manifest', JSON.stringify(m, null, 2) + '\\n');
  "
  echo "  ✓ packages/$p/package.json"
done

# Bump root
node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('$ROOT/package.json'));
  m.version = '$NEW_VERSION';
  fs.writeFileSync('$ROOT/package.json', JSON.stringify(m, null, 2) + '\\n');
"
echo "  ✓ package.json (root)"

echo ""
echo "✓ All 8 manifests at v${NEW_VERSION}"
echo ""
echo "Next steps (user-driven):"
echo "  1. git diff                                 # review"
echo "  2. git add -A && git commit -m 'chore(release): v${NEW_VERSION}'"
echo "  3. git tag v${NEW_VERSION}"
echo "  4. git push origin main v${NEW_VERSION}    # triggers release.yml"
