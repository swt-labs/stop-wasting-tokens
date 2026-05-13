#!/usr/bin/env bash
set -euo pipefail

# verify-agent-spawn-guard.sh — Phase 2 (plan 02-05 T2) stub-shape migration.
#
# Migrated from VBW-era behavior tests (which wrote .vbw-planning/.execution-
# state.json + .delegated-workflow.json markers and asserted blocking exit-2
# semantics) to the Decision 2 STUB shape from plan 02-02.
#
# Why this is a stub: dispatcher.ts lines 18-66 document that Pi 0.74's
# PreToolUse hook is advisory-only — exit 2 logs a would-be-block but
# cannot unwind a tool call Pi has already forwarded. The real spawn
# validation now lives in TypeScript spawnAgent options validation (Phase 3).
#
# What we assert here:
#   1. The stub exits 0 on any input (empty / valid JSON / malformed JSON).
#   2. The script body contains the strings "advisory" and "Phase F" so
#      future maintainers cannot silently regrow bash policy logic.
#   3. The script body is < 40 lines (regression catch against accidental
#      re-implementation of full guard logic).
#   4. The advisory pass-through log line is written to .hook-errors.log
#      when SWT_PLANNING_DIR exists.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/scripts/agent-spawn-guard.sh"

PASS=0
FAIL=0
TEST_PARENT=$(mktemp -d)

pass() {
  echo "PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL  $1"
  FAIL=$((FAIL + 1))
}

cleanup() {
  rm -rf "$TEST_PARENT" 2>/dev/null || true
}
trap cleanup EXIT

setup_planning_dir() {
  local dir
  dir=$(mktemp -d "$TEST_PARENT/planning.XXXXXX")
  mkdir -p "$dir"
  printf '%s' "$dir"
}

# --- Test 1: empty stdin -> exit 0 ---
test_empty_stdin_exits_zero() {
  local dir
  dir=$(setup_planning_dir)
  if SWT_PLANNING_DIR="$dir" bash "$GUARD" </dev/null >/dev/null 2>&1; then
    pass "empty stdin: stub exits 0"
  else
    fail "empty stdin: stub did not exit 0"
  fi
}

# --- Test 2: valid tool-name payload -> exit 0 ---
test_valid_payload_exits_zero() {
  local dir
  dir=$(setup_planning_dir)
  local payload='{"tool_name":"swt_spawn_agent","tool_input":{"role":"dev"}}'
  if printf '%s' "$payload" | SWT_PLANNING_DIR="$dir" bash "$GUARD" >/dev/null 2>&1; then
    pass "valid tool-name payload: stub exits 0"
  else
    fail "valid tool-name payload: stub did not exit 0"
  fi
}

# --- Test 3: malformed JSON -> exit 0 (stub must not crash) ---
test_malformed_json_exits_zero() {
  local dir
  dir=$(setup_planning_dir)
  if printf 'not even close to json {{{' | SWT_PLANNING_DIR="$dir" bash "$GUARD" >/dev/null 2>&1; then
    pass "malformed JSON: stub exits 0 (no crash)"
  else
    fail "malformed JSON: stub crashed or returned non-zero"
  fi
}

# --- Test 4: stub body contains the Decision 2 / Phase F markers ---
test_body_contains_advisory_markers() {
  if grep -q 'advisory' "$GUARD" && grep -q 'Phase F' "$GUARD"; then
    pass "stub body documents advisory pass-through + Phase F TODO"
  else
    fail "stub body missing 'advisory' or 'Phase F' marker"
  fi
}

# --- Test 5: stub is small (regression catch against full re-implementation)
test_body_is_stub_sized() {
  local lines
  lines=$(wc -l < "$GUARD" | tr -d ' ')
  if [ "$lines" -lt 40 ]; then
    pass "stub body is $lines lines (< 40, stub shape preserved)"
  else
    fail "stub body has $lines lines (>= 40, may have regrown into full guard)"
  fi
}

# --- Test 6: advisory log line is written when SWT_PLANNING_DIR exists ---
test_advisory_log_written() {
  local dir
  dir=$(setup_planning_dir)
  printf '{"tool_name":"swt_spawn_agent"}' \
    | SWT_PLANNING_DIR="$dir" bash "$GUARD" >/dev/null 2>&1 || true
  if [ -f "$dir/.hook-errors.log" ] && [ -s "$dir/.hook-errors.log" ]; then
    if grep -q 'agent-spawn-guard: advisory pass-through' "$dir/.hook-errors.log"; then
      pass "advisory pass-through log line appended to .hook-errors.log"
    else
      fail "log file exists but missing advisory pass-through marker"
    fi
  else
    fail "advisory pass-through did not write to .hook-errors.log"
  fi
}

# --- Test 7: VBW_PLANNING_DIR legacy alias still triggers the log ---
test_legacy_planning_dir_alias() {
  local dir
  dir=$(setup_planning_dir)
  # Use legacy alias only — verify the cascade in agent-spawn-guard.sh.
  printf '%s' '{"tool_name":"swt_spawn_agent"}' \
    | VBW_PLANNING_DIR="$dir" bash "$GUARD" >/dev/null 2>&1 || true
  if [ -f "$dir/.hook-errors.log" ] && grep -q 'advisory pass-through' "$dir/.hook-errors.log"; then
    pass "legacy VBW_PLANNING_DIR alias is honoured by stub"
  else
    fail "legacy VBW_PLANNING_DIR alias was not honoured (log missing)"
  fi
}

# --- Test 8: regression — no actual writes of legacy execute-state markers
# remain. The Decision 2 stub does not read these files; the test must not
# write them either. We detect heredoc / redirect writes (`> ...json`) into
# the legacy marker filenames, not bare textual mentions inside a comment
# or assertion-pattern string.
test_no_legacy_execution_state_writes() {
  local stem_exec stem_deleg
  stem_exec='execution-state'
  stem_deleg='delegated-workflow'
  # Detect '>' or '>>' redirects whose target filename contains the legacy
  # stems. Match-then-strip self-references via the assertion's own lines.
  local hits
  hits=$(grep -nE '>\s*"[^"]*\.('"$stem_exec"'|'"$stem_deleg"')\.json"' "$0" \
    || true)
  if [ -n "$hits" ]; then
    fail "test file performs legacy execute-state marker writes:\n$hits"
  else
    pass "test file: no legacy execute-state marker writes"
  fi
}

echo "=== Agent Spawn Guard Tests — Decision 2 stub shape (plan 02-05 T2) ==="
echo ""

test_empty_stdin_exits_zero
test_valid_payload_exits_zero
test_malformed_json_exits_zero
test_body_contains_advisory_markers
test_body_is_stub_sized
test_advisory_log_written
test_legacy_planning_dir_alias
test_no_legacy_execution_state_writes

echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "All agent spawn guard stub checks passed."
