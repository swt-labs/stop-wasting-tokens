#!/usr/bin/env bash
#
# Bump all workspace packages + root in lockstep, OR verify they are already
# consistent (no mutation).
#
# CLAUDE.md rule: do NOT run this script in bump mode unless the user explicitly
# requests it. This is the documented escape hatch for manual versioning outside
# changesets. The --verify mode is safe — it never mutates files.
#
# Usage:
#   scripts/bump-version.sh 0.1.0-alpha            # bump all to 0.1.0-alpha
#   scripts/bump-version.sh 0.1.0-alpha --dry-run  # preview only
#   scripts/bump-version.sh --verify               # check workspace versions are
#                                                  # in lockstep (no mutation)
#
# The --verify mode exists for VBW's pre-push hook
# (~/.claude/plugins/cache/vbw-marketplace/vbw/{ver}/scripts/pre-push-hook.sh)
# which expects every `scripts/bump-version.sh` to support `--verify` as a no-
# mutation consistency check. Without this mode, the hook treats `--verify` as
# a new semver string and corrupts every package.json `version` field.
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

# --verify: read every workspace package.json `version` field, confirm they
# are all equal, exit 0 with summary. Exit 1 with "MISMATCH" output if any
# workspace package has drifted (VBW's pre-push hook greps for "MISMATCH"
# to surface the failure detail).
#
# The root `package.json` carries the published binary version
# (`stop-wasting-tokens` on npm) and is verified separately — it is allowed
# to be ahead of the workspace packages (which are all `"private": true`
# and never publish). The mutation path always keeps them in lockstep, but
# v2.x history has root at a real semver while workspace packages stayed at
# 0.0.0 — that intentional split is preserved here.
if [ "${1:-}" = "--verify" ]; then
  ROOT_VERSION=$(node -e "console.log(require('$ROOT/package.json').version || '')")
  if [ -z "$ROOT_VERSION" ]; then
    echo "MISMATCH: root package.json missing version field" >&2
    exit 1
  fi

  echo "Version sync check:"
  echo "  package.json (root, published binary): $ROOT_VERSION"
  echo ""
  echo "  Workspace packages:"

  WORKSPACE_VERSION=""
  MISMATCH_FOUND=0
  MISMATCH_LINES=""
  for manifest in "$ROOT"/packages/*/package.json; do
    [ -f "$manifest" ] || continue
    name=$(node -e "console.log(require('$manifest').name || '')")
    version=$(node -e "console.log(require('$manifest').version || '')")
    if [ -z "$version" ]; then
      MISMATCH_LINES+="    MISMATCH: $name has no version field"$'\n'
      MISMATCH_FOUND=1
      continue
    fi
    if [ -z "$WORKSPACE_VERSION" ]; then
      WORKSPACE_VERSION="$version"
    elif [ "$version" != "$WORKSPACE_VERSION" ]; then
      MISMATCH_LINES+="    MISMATCH: $name at $version (expected $WORKSPACE_VERSION)"$'\n'
      MISMATCH_FOUND=1
    fi
    printf "    %-40s %s\n" "$name" "$version"
  done

  if [ "$MISMATCH_FOUND" = "1" ]; then
    echo "" >&2
    echo "MISMATCH DETECTED — workspace packages have drifted:" >&2
    printf "%s" "$MISMATCH_LINES" >&2
    echo "" >&2
    echo "Fix: bash scripts/bump-version.sh <semver>   (bumps all in lockstep)" >&2
    exit 1
  fi

  echo ""
  echo "✓ All workspace packages in sync at ${WORKSPACE_VERSION:-(no packages)}."
  exit 0
fi

NEW_VERSION="${1:?usage: bump-version.sh <semver> [--dry-run] | --verify}"
DRY_RUN="${2:-}"

PACKAGES=(core cli codex-driver methodology artifacts verification telemetry claude-code-driver ollama-driver)

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "Would bump root + ${#PACKAGES[@]} packages to v${NEW_VERSION}"
  echo "(packages: ${PACKAGES[*]})"
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
echo "✓ All 10 manifests at v${NEW_VERSION}"
echo ""
echo "Next steps (user-driven):"
echo "  1. git diff                                 # review"
echo "  2. git add -A && git commit -m 'chore(release): v${NEW_VERSION}'"
echo "  3. git tag v${NEW_VERSION}"
echo "  4. git push origin main v${NEW_VERSION}    # triggers release.yml"
