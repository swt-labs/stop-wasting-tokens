#!/usr/bin/env bash
set -u

# verify-tmux-watchdog-contract.sh — Phase 2 (plan 02-03) structural test
# for the tmux-watchdog.sh contract:
#
#   1. With TMUX unset, tmux-watchdog.sh exits 0 immediately (Decision 1
#      graceful degradation no-op guard).
#   2. No legacy `agent-pid-tracker.sh` source reference remains.
#   3. The new swt_session_list / lib/swt-session-state.sh source is wired.
#   4. The compaction-marker namespace is normalized to
#      .swt-planning/.compacting/.
#   5. Pane mapping is removed (no tmux list-panes / .agent-panes refs) —
#      Decision 1 scope: kill-by-PID is sufficient.

ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
WATCHDOG="${ROOT}/scripts/tmux-watchdog.sh"

PASS=0
FAIL=0
FAILURES=()

pass() {
  echo "PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL  $1"
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
}

# --- Isolated workspace ----------------------------------------------------
TMP_ROOT="$(mktemp -d -t swt-tmux-watchdog-XXXXXX 2>/dev/null || mktemp -d /tmp/swt-tmux-watchdog.XXXXXX)"
if [ -z "${TMP_ROOT}" ] || [ ! -d "${TMP_ROOT}" ]; then
  echo "FATAL: could not create tmp dir" >&2
  exit 1
fi

cleanup() {
  rm -rf "${TMP_ROOT}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

export SWT_PLANNING_DIR="${TMP_ROOT}/.swt-planning"
mkdir -p "$SWT_PLANNING_DIR"
unset VBW_PLANNING_DIR

echo "=== tmux-watchdog contract verification ==="
echo "tmp: ${TMP_ROOT}"

# --- 1. TMUX unset -> no-op guard (Decision 1) -----------------------------
( unset TMUX; bash "$WATCHDOG" >/dev/null 2>&1 ); RC=$?
if [ "$RC" -eq 0 ]; then
  pass "tmux-watchdog.sh exits 0 immediately when TMUX is unset (Decision 1)"
else
  fail "tmux-watchdog.sh no-op guard: rc=$RC, expected 0"
fi

# --- 2. Legacy PID-tracker source dependency removed -----------------------
LEGACY_HITS=$(grep -cE 'agent-pid-tracker\.sh\b' "$WATCHDOG" 2>/dev/null)
LEGACY_HITS="${LEGACY_HITS:-0}"
if [ "${LEGACY_HITS:-0}" -eq 0 ]; then
  pass "no agent-pid-tracker.sh references (legacy dependency removed)"
else
  fail "agent-pid-tracker.sh still referenced (count=$LEGACY_HITS)"
fi

# --- 3. New session-state source wired -------------------------------------
NEW_HITS=$(grep -cE 'swt_session_list|lib/swt-session-state' "$WATCHDOG" 2>/dev/null)
NEW_HITS="${NEW_HITS:-0}"
if [ "${NEW_HITS:-0}" -ge 1 ]; then
  pass "new swt_session_list / lib/swt-session-state.sh source is wired"
else
  fail "tmux-watchdog.sh does not source swt-session-state lib (count=$NEW_HITS)"
fi

# --- 4. Compaction-marker namespace normalized -----------------------------
NS_HITS=$(grep -c '\.swt-planning/\.compacting' "$WATCHDOG" 2>/dev/null)
NS_HITS="${NS_HITS:-0}"
if [ "${NS_HITS:-0}" -ge 1 ]; then
  pass "compaction-marker namespace normalized to .swt-planning/.compacting"
else
  fail ".swt-planning/.compacting namespace missing (count=$NS_HITS)"
fi

# --- 5. Pane mapping removed (Decision 1 scope) ----------------------------
PANE_HITS=$(grep -cE 'tmux list-panes|\.agent-panes' "$WATCHDOG" 2>/dev/null)
PANE_HITS="${PANE_HITS:-0}"
if [ "${PANE_HITS:-0}" -eq 0 ]; then
  pass "pane mapping removed (no tmux list-panes / .agent-panes refs)"
else
  fail "pane-mapping refs still present (count=$PANE_HITS)"
fi

# --- Footer ----------------------------------------------------------------
echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
fi
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
