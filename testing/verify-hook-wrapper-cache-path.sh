#!/usr/bin/env bash
set -uo pipefail

# verify-hook-wrapper-cache-path.sh — Regression guard for Phase 2 plan 02-04.
#
# Locks in the CC marketplace cache-path removal and the stub shapes:
#   - hook-wrapper.sh, install-hooks.sh, cache-nuke.sh, post-archive-hook.sh,
#     and pre-push-hook.sh must not reference plugins/cache/swt-marketplace or
#     plugins/cache/vbw-marketplace anywhere (executable code or comments).
#   - hook-wrapper.sh must resolve via SWT_INSTALL_ROOT (>= 2 mentions).
#   - ensure-plugin-root-link.sh, compaction-instructions.sh, post-compact.sh
#     must remain stub-shaped (LOC budgets).
#   - End-to-end: compaction-instructions writes the .compaction-marker;
#     post-compact removes the per-session marker.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0

pass() {
  echo "PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL  $1"
  FAIL=$((FAIL + 1))
}

assert_grep_count_zero() {
  local pattern="$1" file="$2"
  local count
  count=$(grep -c -E "$pattern" "$ROOT/$file" 2>/dev/null) || count=0
  if [ "$count" = "0" ]; then
    pass "$file: no marketplace cache path"
  else
    fail "$file: still has $count marketplace cache path mention(s)"
  fi
}

assert_grep_count_min() {
  local pattern="$1" file="$2" min="$3" label="$4"
  local count
  count=$(grep -c -E "$pattern" "$ROOT/$file" 2>/dev/null) || count=0
  if [ "$count" -ge "$min" ]; then
    pass "$file: $label (count=$count >= $min)"
  else
    fail "$file: $label (count=$count < $min)"
  fi
}

assert_loc_under() {
  local file="$1" cap="$2"
  local lc
  lc=$(wc -l < "$ROOT/$file" 2>/dev/null | tr -d ' ')
  if [ -n "$lc" ] && [ "$lc" -lt "$cap" ]; then
    pass "$file: LOC=$lc under $cap (stub shape)"
  else
    fail "$file: LOC=${lc:-?} not under $cap (stub shape)"
  fi
}

echo "=== verify-hook-wrapper-cache-path ==="

# --- Marketplace cache path removal across the audited set ---
MARKETPLACE_PATTERN='plugins/cache/(swt|vbw)-marketplace'
for f in \
  scripts/hook-wrapper.sh \
  scripts/install-hooks.sh \
  scripts/cache-nuke.sh \
  scripts/post-archive-hook.sh \
  scripts/pre-push-hook.sh
do
  assert_grep_count_zero "$MARKETPLACE_PATTERN" "$f"
done

# --- hook-wrapper.sh canonical resolver ---
assert_grep_count_min 'SWT_INSTALL_ROOT' scripts/hook-wrapper.sh 2 "SWT_INSTALL_ROOT canonical resolver"

# --- Stub shapes ---
assert_loc_under scripts/ensure-plugin-root-link.sh 20
assert_loc_under scripts/compaction-instructions.sh 50
assert_loc_under scripts/post-compact.sh 50

# --- Behavioural: compaction-instructions writes marker ---
TMP_BASE=$(mktemp -d)
TMP_PLANNING="$TMP_BASE/.swt-planning"
mkdir -p "$TMP_PLANNING"
if SWT_PLANNING_DIR="$TMP_PLANNING" bash "$ROOT/scripts/compaction-instructions.sh" < /dev/null >/dev/null 2>&1; then
  if [ -f "$TMP_PLANNING/.compaction-marker" ]; then
    pass "compaction-instructions.sh: writes .compaction-marker"
  else
    fail "compaction-instructions.sh: missing .compaction-marker after run"
  fi
else
  fail "compaction-instructions.sh: non-zero exit on minimal input"
fi

# --- Behavioural: compaction-instructions + post-compact pipeline ---
# Write a per-session marker, then ensure post-compact removes it.
echo '{"sessionId":"verify-abc","role":"dev"}' \
  | SWT_PLANNING_DIR="$TMP_PLANNING" bash "$ROOT/scripts/compaction-instructions.sh" >/dev/null 2>&1
if [ -f "$TMP_PLANNING/.compacting/verify-abc.json" ]; then
  pass "compaction-instructions.sh: writes .compacting/{sessionId}.json"
else
  fail "compaction-instructions.sh: missing per-session marker"
fi

if echo '{"sessionId":"verify-abc"}' \
  | SWT_PLANNING_DIR="$TMP_PLANNING" bash "$ROOT/scripts/post-compact.sh" >/dev/null 2>&1; then
  if [ ! -e "$TMP_PLANNING/.compacting/verify-abc.json" ]; then
    pass "post-compact.sh: clears per-session marker"
  else
    fail "post-compact.sh: marker still present after run"
  fi
else
  fail "post-compact.sh: non-zero exit on minimal input"
fi

# --- Behavioural: ensure-plugin-root-link.sh is a non-crashing stub ---
if echo "ignored-arg another-ignored-arg" | bash "$ROOT/scripts/ensure-plugin-root-link.sh" >/dev/null 2>&1; then
  pass "ensure-plugin-root-link.sh: stub exits 0"
else
  fail "ensure-plugin-root-link.sh: stub exited non-zero"
fi

rm -rf "$TMP_BASE"

echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
