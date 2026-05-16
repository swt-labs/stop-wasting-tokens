#!/usr/bin/env bash
#
# Test seam for scripts/audit-upstream-prompts.sh.
#
# Exercises the audit script's diff logic OFFLINE by driving --dry-run
# with $SWT_AUDIT_FIXTURE_DIR. Three assertions:
#
#   1. Clean fixture path  — fixture bytes match current baselines →
#      --verify exits 0 with no stdout.
#   2. Drift fixture path  — fixture bytes mutated → --verify exits 0
#      with `DRIFT:` lines on stdout (one per artifact).
#   3. Missing sha256 binary — PATH cleared so neither sha256sum nor
#      shasum resolves → --verify exits 2 with the expected stderr
#      message.
#
# This is a bash test (not vitest) because the audit script is bash,
# lives outside the TypeScript workspace, and the integration we want
# to assert is the bash invocation itself. Mocking curl/npm from a
# vitest test would shell-out anyway.
#
# Usage:
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

# --- locate latest baseline + fetch the bytes that hash to it ----------------
#
# To synthesize a "clean" fixture, we need files whose sha256 matches the
# current pinned baseline. Two options: (a) reuse --update's tempdir (it
# deletes on exit, so we can't), (b) fetch the upstream bytes ourselves
# once for the test. Option (b) is what we do. If the network is offline,
# this test cannot run — that's by design; the test exercises the diff
# logic, which is only meaningful with bytes that match the baseline.

SNAPSHOTS_DIR="$REPO_ROOT/.vbw-planning/upstream-prompt-snapshots"
LATEST_BASELINE_DIR=$(find "$SNAPSHOTS_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' \
  | sort -r | head -1)
if [ -z "$LATEST_BASELINE_DIR" ]; then
  echo "✗ no baseline dir under $SNAPSHOTS_DIR (run --update first)" >&2
  exit 1
fi

CODEX_BASELINE_HEX=$(awk '{print $1; exit}' "$LATEST_BASELINE_DIR/codex-prompt.sha256")
SDK_BASELINE_HEX=$(awk '{print $1; exit}' "$LATEST_BASELINE_DIR/claude-agent-sdk.sha256")

# Tempdir that holds the clean fixture (bytes hash to the current baseline).
CLEAN_FIXTURE_DIR=$(mktemp -d -t swt-audit-test-clean-XXXXXX)
DRIFT_FIXTURE_DIR=$(mktemp -d -t swt-audit-test-drift-XXXXXX)
EMPTY_BIN_DIR=$(mktemp -d -t swt-audit-test-empty-bin-XXXXXX)

cleanup() {
  rm -rf "$CLEAN_FIXTURE_DIR" "$DRIFT_FIXTURE_DIR" "$EMPTY_BIN_DIR"
}
trap cleanup EXIT

# Fetch current upstream bytes into the clean fixture. Mirrors the audit
# script's fetch logic but for a fixed local target.
fetch_into_clean_fixture() {
  local codex_url="https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/gpt_5_codex_prompt.md"
  local sdk_pkg="@anthropic-ai/claude-agent-sdk"
  local sdk_file="package/sdk.d.ts"

  if ! curl -fSL "$codex_url" -o "$CLEAN_FIXTURE_DIR/codex-prompt.md" 2>"$CLEAN_FIXTURE_DIR/curl.err"; then
    echo "✗ test setup: failed to fetch Codex CLI prompt from $codex_url" >&2
    sed 's/^/  /' "$CLEAN_FIXTURE_DIR/curl.err" >&2 || true
    return 1
  fi

  local tarball_url
  tarball_url=$(npm view "$sdk_pkg" dist.tarball 2>/dev/null)
  if [ -z "$tarball_url" ]; then
    echo "✗ test setup: failed to resolve tarball URL for $sdk_pkg via npm view" >&2
    return 1
  fi

  if ! curl -fSL "$tarball_url" -o "$CLEAN_FIXTURE_DIR/sdk.tgz" 2>"$CLEAN_FIXTURE_DIR/curl.err"; then
    echo "✗ test setup: failed to fetch SDK tarball from $tarball_url" >&2
    sed 's/^/  /' "$CLEAN_FIXTURE_DIR/curl.err" >&2 || true
    return 1
  fi
  tar -xzOf "$CLEAN_FIXTURE_DIR/sdk.tgz" "$sdk_file" > "$CLEAN_FIXTURE_DIR/claude-agent-sdk.d.ts"
  rm -f "$CLEAN_FIXTURE_DIR/sdk.tgz" "$CLEAN_FIXTURE_DIR/curl.err"
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

# --- main --------------------------------------------------------------------

echo "Setup: fetching current upstream bytes into clean fixture..."
if ! fetch_into_clean_fixture; then
  echo "✗ test setup failed (network?) — cannot run diff tests offline" >&2
  exit 1
fi

# Sanity-check that the clean fixture's hashes actually match the baseline.
# If they don't, the test would FALSE-fail assertion 1. This is the same
# condition the real --verify would surface as drift.
CLEAN_CODEX_HEX=$(test_sha256 "$CLEAN_FIXTURE_DIR/codex-prompt.md")
CLEAN_SDK_HEX=$(test_sha256 "$CLEAN_FIXTURE_DIR/claude-agent-sdk.d.ts")
if [ "$CLEAN_CODEX_HEX" != "$CODEX_BASELINE_HEX" ] || [ "$CLEAN_SDK_HEX" != "$SDK_BASELINE_HEX" ]; then
  echo "✗ clean fixture does NOT match current baseline — upstream has drifted"
  echo "  codex baseline=$CODEX_BASELINE_HEX current=$CLEAN_CODEX_HEX"
  echo "  sdk   baseline=$SDK_BASELINE_HEX current=$CLEAN_SDK_HEX"
  echo "  This means the real audit would also report drift. Refresh the"
  echo "  baseline via 'bash scripts/audit-upstream-prompts.sh --update'"
  echo "  before re-running this test."
  exit 1
fi
echo "  fixture hashes match baseline."
echo ""

FAIL_COUNT=0

# Assertion 1: clean fixture → silent exit 0 ---------------------------------
echo "Assertion 1: clean fixture → exit 0, no stdout"
set +e
OUT_1=$(SWT_AUDIT_FIXTURE_DIR="$CLEAN_FIXTURE_DIR" bash "$SCRIPT" --verify --dry-run 2>&1)
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
echo "Assertion 2: drift fixture → exit 0, stdout contains both DRIFT lines"
cp "$CLEAN_FIXTURE_DIR/codex-prompt.md" "$DRIFT_FIXTURE_DIR/codex-prompt.md"
cp "$CLEAN_FIXTURE_DIR/claude-agent-sdk.d.ts" "$DRIFT_FIXTURE_DIR/claude-agent-sdk.d.ts"
# Append a single byte to each — guarantees a hash change.
printf '\nx\n' >> "$DRIFT_FIXTURE_DIR/codex-prompt.md"
printf '\nx\n' >> "$DRIFT_FIXTURE_DIR/claude-agent-sdk.d.ts"

set +e
OUT_2=$(SWT_AUDIT_FIXTURE_DIR="$DRIFT_FIXTURE_DIR" bash "$SCRIPT" --verify --dry-run 2>&1)
RC_2=$?
set -e
if [ "$RC_2" = "0" ] \
    && echo "$OUT_2" | grep -q '^DRIFT: codex-prompt ' \
    && echo "$OUT_2" | grep -q '^DRIFT: claude-agent-sdk '; then
  echo "  ✓ PASS"
else
  echo "  ✗ FAIL (rc=$RC_2, output='$OUT_2')"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Assertion 3: missing sha256 binary → exit 2 with expected stderr ------------
echo "Assertion 3: PATH with no sha256 → exit 2, stderr names both sha256sum + shasum"
# Strategy: build a minimal PATH dir that symlinks IN every coreutil the
# audit script needs (dirname, mktemp, awk, find, sort, head, cp, rm, date,
# mkdir, chmod, sed, cat, tar, npm, curl, etc.), but explicitly does NOT
# include sha256sum or shasum. The script's `command -v sha256sum` /
# `command -v shasum` will both miss; the script must exit 2 with the
# expected stderr message.
#
# This is more robust than PATH="" (script fails at dirname) or shadowing
# (`command -v` skips non-executable hits and falls through to the real
# binaries in /usr/bin).
ISOLATED_BIN_DIR=$(mktemp -d -t swt-audit-test-isolated-bin-XXXXXX)
for util in dirname mktemp awk find sort head cp rm date mkdir chmod sed cat tar npm curl bash env tr cut grep ls touch printf; do
  # Resolve via the parent shell's PATH, then link into the isolated dir.
  src=$(command -v "$util" 2>/dev/null || true)
  if [ -n "$src" ]; then
    ln -s "$src" "$ISOLATED_BIN_DIR/$util"
  fi
done
# Explicitly DO NOT link sha256sum or shasum. Confirm neither resolves in
# the isolated PATH (defensive — fail fast if a Linux distro keeps them
# somewhere unexpected that npm/curl/etc. happened to symlink to).
if [ -e "$ISOLATED_BIN_DIR/sha256sum" ] || [ -e "$ISOLATED_BIN_DIR/shasum" ]; then
  echo "  ✗ FAIL test setup: isolated bin dir contains sha256 binaries" >&2
  rm -rf "$ISOLATED_BIN_DIR"
  exit 1
fi

set +e
OUT_3=$(PATH="$ISOLATED_BIN_DIR" SWT_AUDIT_FIXTURE_DIR="$CLEAN_FIXTURE_DIR" \
  bash "$SCRIPT" --verify --dry-run 2>&1)
RC_3=$?
set -e
rm -rf "$ISOLATED_BIN_DIR"
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
