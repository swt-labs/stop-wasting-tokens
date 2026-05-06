#!/usr/bin/env bash
#
# Post-publish smoke test: confirm a freshly-installed @swt-labs/cli works.
#
# Usage:
#   scripts/verify-install.sh <expected-version>
#
# Designed to run in CI after `npm install -g @swt-labs/cli` (or pnpm/bun
# equivalent). Returns 0 only when every check passes.
#
set -euo pipefail

EXPECTED_VERSION="${1:?usage: verify-install.sh <expected-version>}"
# Strip leading "v" if user passed a tag (v0.1.0-alpha → 0.1.0-alpha)
EXPECTED_VERSION="${EXPECTED_VERSION#v}"

echo "Verifying install for v${EXPECTED_VERSION}..."

# 1. Binary on PATH
if ! command -v swt >/dev/null 2>&1; then
  echo "✗ swt not on PATH after install" >&2
  exit 1
fi
echo "  ✓ swt is on PATH ($(command -v swt))"

# 2. Version match
INSTALLED=$(swt --version 2>/dev/null | head -1 | awk '{print $NF}')
if [ -z "$INSTALLED" ] || [ "$INSTALLED" != "$EXPECTED_VERSION" ]; then
  echo "✗ Version mismatch: expected ${EXPECTED_VERSION}, got '${INSTALLED}'" >&2
  exit 1
fi
echo "  ✓ swt --version reports ${INSTALLED}"

# 3. swt init scaffolds in a tmp dir
TMP_DIR=$(mktemp -d -t swt-verify-XXXXXX)
trap "rm -rf $TMP_DIR" EXIT
pushd "$TMP_DIR" >/dev/null

# Use --yes if supported; fall back to bare init otherwise
if ! swt init --yes 2>/dev/null && ! echo | swt init 2>/dev/null; then
  echo "✗ swt init failed in fresh directory" >&2
  popd >/dev/null
  exit 1
fi

if [ ! -f .swt-planning/PROJECT.md ]; then
  echo "✗ swt init did not scaffold .swt-planning/PROJECT.md" >&2
  popd >/dev/null
  exit 1
fi
echo "  ✓ swt init scaffolds .swt-planning/"
popd >/dev/null

# 4. detect-phase round-trips
NONEXISTENT_DIR="${TMP_DIR}-detect"
mkdir -p "$NONEXISTENT_DIR"
pushd "$NONEXISTENT_DIR" >/dev/null
RESULT=$(swt detect-phase --json 2>/dev/null || true)
popd >/dev/null
rm -rf "$NONEXISTENT_DIR"
if [ -z "$RESULT" ]; then
  echo "✗ swt detect-phase produced no output" >&2
  exit 1
fi
echo "  ✓ swt detect-phase returns JSON"

# 5. swt update --json (network-aware; --strict would fail offline so use default)
UPDATE_JSON=$(swt update --json 2>&1 || true)
if ! echo "$UPDATE_JSON" | grep -q '"status"'; then
  echo "✗ swt update --json did not return status field" >&2
  echo "Output was: $UPDATE_JSON" >&2
  exit 1
fi
echo "  ✓ swt update --json returns valid status payload"

echo ""
echo "✓ Install verification passed for v${EXPECTED_VERSION}"
