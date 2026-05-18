#!/usr/bin/env bash
#
# Test seam for scripts/audit-upstream-prompts.sh.
#
# Exercises the audit script's diff logic OFFLINE by driving --dry-run
# with $SWT_AUDIT_FIXTURE_DIR + $SWT_AUDIT_SOURCES_FIXTURE. Phase 5
# refactor: the script consumes JSON sources from `swt provider-tuning-
# sources` (or the SWT_AUDIT_SOURCES_FIXTURE env override). This test
# captures the live envelope once, derives a synthetic clean fixture
# (one `<slug>.body` per source), and runs three assertions:
#
#   1. Clean fixture path  — fixture bytes match current baselines →
#      --verify exits 0 with no stdout.
#   2. Drift fixture path  — fixture bytes mutated → --verify exits 0
#      with `DRIFT:` lines on stdout (one per source).
#   3. Missing sha256 binary — PATH cleared so neither sha256sum nor
#      shasum resolves → --verify exits 2 with the expected stderr
#      message.
#
# This is a bash test (not vitest) because the audit script is bash,
# lives outside the TypeScript workspace, and the integration we want
# to assert is the bash invocation itself.
#
# Usage:
#   # Requires `swt` (or the local `dist/cli.mjs`) on PATH. From the
#   # repo root after `pnpm build`:
#   bash scripts/test-audit-upstream-prompts.sh
#
# Exits 0 on success, non-zero on any FAIL.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/audit-upstream-prompts.sh"

if [ ! -x "$SCRIPT" ]; then
  echo "✗ $SCRIPT is not executable (or does not exist)" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "✗ jq is required" >&2
  exit 1
fi

# --- locate latest baseline + resolve sources --------------------------------

SNAPSHOTS_DIR="$REPO_ROOT/.vbw-planning/upstream-prompt-snapshots"
LATEST_BASELINE_DIR=$(find "$SNAPSHOTS_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' \
  | sort -r | head -1)
if [ -z "$LATEST_BASELINE_DIR" ]; then
  echo "✗ no baseline dir under $SNAPSHOTS_DIR (run --update first)" >&2
  exit 1
fi

# Capture the source envelope once. If `swt` is not on PATH, fall back
# to the local dist binary.
SOURCES_JSON=""
if command -v swt >/dev/null 2>&1 && swt help 2>/dev/null | grep -q provider-tuning-sources; then
  SOURCES_JSON=$(swt provider-tuning-sources)
elif [ -f "$REPO_ROOT/dist/cli.mjs" ]; then
  SOURCES_JSON=$(node "$REPO_ROOT/dist/cli.mjs" provider-tuning-sources)
else
  echo "✗ neither \`swt\` nor \`dist/cli.mjs\` has the provider-tuning-sources verb." >&2
  echo "  Run \`pnpm build\` in the repo root first." >&2
  exit 1
fi

# Tempdirs for fixtures + sources JSON.
CLEAN_FIXTURE_DIR=$(mktemp -d -t swt-audit-test-clean-XXXXXX)
DRIFT_FIXTURE_DIR=$(mktemp -d -t swt-audit-test-drift-XXXXXX)
ISOLATED_BIN_DIR=""
SOURCES_FIXTURE_FILE=$(mktemp -t swt-audit-test-sources-XXXXXX.json)

cleanup() {
  rm -rf "$CLEAN_FIXTURE_DIR" "$DRIFT_FIXTURE_DIR" "$SOURCES_FIXTURE_FILE"
  if [ -n "$ISOLATED_BIN_DIR" ]; then
    rm -rf "$ISOLATED_BIN_DIR"
  fi
}
trap cleanup EXIT

printf '%s' "$SOURCES_JSON" > "$SOURCES_FIXTURE_FILE"

# --- slug helper -------------------------------------------------------------
# Mirrors the audit script's slug_for() byte-for-byte so fixture filenames
# line up with what the script computes from each source's description.
slug_for() {
  printf '%s' "$1" | tr -c '[:alnum:]' '-' | tr -s '-' | sed 's/^-//;s/-$//' | tr '[:upper:]' '[:lower:]'
}

# --- compute_sha256 helper for the test itself -------------------------------
test_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

# --- fetch every source into the clean fixture -------------------------------

fetch_source() {
  # $1 = url, $2 = destination path
  local url="$1" dest="$2"
  if [[ "$url" == npm:* ]]; then
    local rest pkg file tarball_url tmp
    rest="${url#npm:}"
    pkg="${rest%%#*}"
    file="${rest#*#}"
    tarball_url=$(npm view "$pkg" dist.tarball 2>/dev/null)
    if [ -z "$tarball_url" ]; then
      echo "✗ test setup: npm view returned empty tarball for $pkg" >&2
      return 1
    fi
    tmp="$(mktemp -t swt-audit-test-tarball-XXXXXX.tgz)"
    if ! curl -fSL "$tarball_url" -o "$tmp" 2>/dev/null; then
      rm -f "$tmp"
      echo "✗ test setup: failed to fetch tarball for $pkg from $tarball_url" >&2
      return 1
    fi
    if ! tar -xzOf "$tmp" "$file" > "$dest" 2>/dev/null; then
      rm -f "$tmp"
      echo "✗ test setup: failed to extract $file from $pkg tarball" >&2
      return 1
    fi
    rm -f "$tmp"
  else
    if ! curl -fSL "$url" -o "$dest" 2>/dev/null; then
      echo "✗ test setup: failed to fetch $url" >&2
      return 1
    fi
  fi
}

echo "Setup: fetching upstream bytes for every source into clean fixture..."
SOURCE_COUNT=$(printf '%s' "$SOURCES_JSON" | jq -r '.sources | length')
i=0
ALL_SLUGS=()
while [ "$i" -lt "$SOURCE_COUNT" ]; do
  desc=$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].description")
  url=$(printf '%s' "$SOURCES_JSON" | jq -r ".sources[$i].url")
  slug=$(slug_for "$desc")
  ALL_SLUGS+=("$slug")
  if ! fetch_source "$url" "$CLEAN_FIXTURE_DIR/$slug.body"; then
    echo "✗ test setup failed (network?) — cannot run diff tests offline" >&2
    exit 1
  fi
  baseline_path="$LATEST_BASELINE_DIR/$slug.sha256"
  if [ ! -f "$baseline_path" ]; then
    echo "✗ baseline file missing for slug '$slug' — refresh with --update" >&2
    exit 1
  fi
  baseline_hex=$(awk '{print $1; exit}' "$baseline_path")
  actual_hex=$(test_sha256 "$CLEAN_FIXTURE_DIR/$slug.body")
  if [ "$baseline_hex" != "$actual_hex" ]; then
    echo "✗ clean fixture does NOT match current baseline — upstream has drifted"
    echo "  slug=$slug baseline=$baseline_hex current=$actual_hex"
    echo "  Refresh the baseline via 'bash scripts/audit-upstream-prompts.sh --update'"
    echo "  before re-running this test."
    exit 1
  fi
  i=$((i + 1))
done
echo "  fixture hashes match baseline for all $SOURCE_COUNT source(s)."
echo ""

FAIL_COUNT=0

# Assertion 1: clean fixture → silent exit 0 ---------------------------------
echo "Assertion 1: clean fixture → exit 0, no stdout"
set +e
OUT_1=$(SWT_AUDIT_FIXTURE_DIR="$CLEAN_FIXTURE_DIR" \
        SWT_AUDIT_SOURCES_FIXTURE="$SOURCES_FIXTURE_FILE" \
        bash "$SCRIPT" --verify --dry-run 2>&1)
RC_1=$?
set -e
if [ "$RC_1" = "0" ] && [ -z "$OUT_1" ]; then
  echo "  ✓ PASS"
else
  echo "  ✗ FAIL (rc=$RC_1, output='$OUT_1')"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Assertion 2: drift fixture → exit 0 with DRIFT lines -----------------------
echo "Assertion 2: drift fixture → exit 0, stdout has one DRIFT line per source"
for slug in "${ALL_SLUGS[@]}"; do
  cp "$CLEAN_FIXTURE_DIR/$slug.body" "$DRIFT_FIXTURE_DIR/$slug.body"
  printf '\nx\n' >> "$DRIFT_FIXTURE_DIR/$slug.body"
done

set +e
OUT_2=$(SWT_AUDIT_FIXTURE_DIR="$DRIFT_FIXTURE_DIR" \
        SWT_AUDIT_SOURCES_FIXTURE="$SOURCES_FIXTURE_FILE" \
        bash "$SCRIPT" --verify --dry-run 2>&1)
RC_2=$?
set -e
DRIFT_LINES=$(echo "$OUT_2" | grep -c '^DRIFT: ' || true)
if [ "$RC_2" = "0" ] && [ "$DRIFT_LINES" = "$SOURCE_COUNT" ] && echo "$OUT_2" | grep -q 'method=upstreamSources'; then
  echo "  ✓ PASS ($DRIFT_LINES DRIFT line(s) for $SOURCE_COUNT source(s))"
else
  echo "  ✗ FAIL (rc=$RC_2, DRIFT_LINES=$DRIFT_LINES, expected $SOURCE_COUNT)"
  echo "  output:"
  printf '%s\n' "$OUT_2" | sed 's/^/    /'
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Assertion 3: missing sha256 binary → exit 2 with expected stderr ------------
echo "Assertion 3: PATH with no sha256 → exit 2, stderr names both sha256sum + shasum"
# Strategy: build a minimal PATH dir that symlinks IN every coreutil the
# audit script needs (dirname, mktemp, awk, find, sort, head, cp, rm, date,
# mkdir, chmod, sed, cat, tar, npm, curl, jq, etc.), but explicitly does
# NOT include sha256sum or shasum. The script's `command -v sha256sum` /
# `command -v shasum` will both miss; the script must exit 2 with the
# expected stderr message. NOTE: with $SWT_AUDIT_SOURCES_FIXTURE set, the
# script never invokes `swt`, so we don't need to link it.
ISOLATED_BIN_DIR=$(mktemp -d -t swt-audit-test-isolated-bin-XXXXXX)
for util in dirname mktemp awk find sort head cp rm date mkdir chmod sed cat tar npm curl bash env tr cut grep ls touch printf jq node uniq wc; do
  src=$(command -v "$util" 2>/dev/null || true)
  if [ -n "$src" ]; then
    ln -s "$src" "$ISOLATED_BIN_DIR/$util"
  fi
done
if [ -e "$ISOLATED_BIN_DIR/sha256sum" ] || [ -e "$ISOLATED_BIN_DIR/shasum" ]; then
  echo "  ✗ FAIL test setup: isolated bin dir contains sha256 binaries" >&2
  exit 1
fi

set +e
OUT_3=$(PATH="$ISOLATED_BIN_DIR" \
        SWT_AUDIT_FIXTURE_DIR="$CLEAN_FIXTURE_DIR" \
        SWT_AUDIT_SOURCES_FIXTURE="$SOURCES_FIXTURE_FILE" \
        bash "$SCRIPT" --verify --dry-run 2>&1)
RC_3=$?
set -e
if [ "$RC_3" = "2" ] && echo "$OUT_3" | grep -q 'neither sha256sum nor shasum'; then
  echo "  ✓ PASS"
else
  echo "  ✗ FAIL (rc=$RC_3, output='$OUT_3')"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "✗ $FAIL_COUNT assertion(s) failed"
  exit 1
fi
echo "✓ All 3 assertions passed"
exit 0
