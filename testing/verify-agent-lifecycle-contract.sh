#!/usr/bin/env bash
set -u

# verify-agent-lifecycle-contract.sh — Phase 2 (plan 02-02) structural test
# for the SubagentStart/SubagentStop hook handler contract + the
# agent-spawn-guard stub.
#
# Asserts:
#   1. agent-start.sh consumes stdin .role and creates
#      .swt-planning/.sessions/{sessionId}.json with the parsed role.
#   2. agent-start.sh falls back to VBW_AGENT_ROLE when stdin lacks .role.
#   3. agent-start.sh falls back to SWT_SESSION_ID when stdin lacks .sessionId.
#   4. agent-start.sh exits 0 on malformed JSON (hook-wrapper invariant).
#   5. agent-stop.sh removes the session file written by agent-start.sh.
#   6. agent-stop.sh writes .agent-last-words/{sessionId}.txt when
#      last_assistant_message is present AND no SUMMARY.md exists for the
#      active phase.
#   7. agent-stop.sh does NOT write the last-words file when
#      last_assistant_message is empty.
#   8. agent-spawn-guard.sh exits 0 regardless of input.
#   9. None of the three scripts reference the legacy .agent_type jq path —
#      the critical Scout §F Conflict 2 contract fix.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
START="${ROOT}/scripts/agent-start.sh"
STOP="${ROOT}/scripts/agent-stop.sh"
GUARD="${ROOT}/scripts/agent-spawn-guard.sh"

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
TMP_ROOT="$(mktemp -d -t swt-agent-lifecycle-XXXXXX 2>/dev/null || mktemp -d /tmp/swt-agent-lifecycle.XXXXXX)"
if [ -z "${TMP_ROOT}" ] || [ ! -d "${TMP_ROOT}" ]; then
  echo "FATAL: could not create tmp dir" >&2
  exit 1
fi

cleanup() {
  rm -rf "${TMP_ROOT}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

export SWT_PLANNING_DIR="${TMP_ROOT}/.swt-planning"
mkdir -p "$SWT_PLANNING_DIR" 2>/dev/null || true
# Avoid leaking outer environment into the agent-start test cases.
unset VBW_AGENT_ROLE SWT_SESSION_ID SWT_INSTALL_ROOT VBW_PLANNING_DIR SWT_AGENT_PID

echo "=== Agent lifecycle contract verification ==="
echo "tmp: ${TMP_ROOT}"
echo "SWT_PLANNING_DIR=${SWT_PLANNING_DIR}"

# --- 1. agent-start.sh consumes .role + creates session file ---------------
echo '{"role":"dev","sessionId":"contract-1","installRoot":"/tmp","cwd":"/tmp"}' | bash "$START" >/dev/null 2>&1
SESSION_FILE="$SWT_PLANNING_DIR/.sessions/contract-1.json"
if [ -f "$SESSION_FILE" ]; then
  ROLE_OUT=$(jq -r '.role // empty' "$SESSION_FILE" 2>/dev/null || printf '')
  if [ "$ROLE_OUT" = "dev" ]; then
    pass "agent-start.sh consumes stdin .role and writes .sessions/{id}.json"
  else
    fail "agent-start.sh wrote session file but role is '$ROLE_OUT', expected 'dev'"
  fi
else
  fail "agent-start.sh did not write $SESSION_FILE"
fi

# --- 2. VBW_AGENT_ROLE fallback ---------------------------------------------
rm -f "$SWT_PLANNING_DIR/.sessions/fallback-role.json" 2>/dev/null || true
echo '{"sessionId":"fallback-role","installRoot":"/tmp","cwd":"/tmp"}' | VBW_AGENT_ROLE=qa bash "$START" >/dev/null 2>&1
ROLE_OUT=$(jq -r '.role // empty' "$SWT_PLANNING_DIR/.sessions/fallback-role.json" 2>/dev/null || printf '')
if [ "$ROLE_OUT" = "qa" ]; then
  pass "agent-start.sh falls back to VBW_AGENT_ROLE when stdin lacks .role"
else
  fail "VBW_AGENT_ROLE fallback failed: role='$ROLE_OUT'"
fi

# --- 3. SWT_SESSION_ID fallback --------------------------------------------
rm -f "$SWT_PLANNING_DIR/.sessions/fallback-id.json" 2>/dev/null || true
echo '{"role":"scout"}' | SWT_SESSION_ID=fallback-id bash "$START" >/dev/null 2>&1
if [ -f "$SWT_PLANNING_DIR/.sessions/fallback-id.json" ]; then
  ROLE_OUT=$(jq -r '.role // empty' "$SWT_PLANNING_DIR/.sessions/fallback-id.json" 2>/dev/null || printf '')
  if [ "$ROLE_OUT" = "scout" ]; then
    pass "agent-start.sh falls back to SWT_SESSION_ID when stdin lacks .sessionId"
  else
    fail "SWT_SESSION_ID fallback: file present but role='$ROLE_OUT' (expected scout)"
  fi
else
  fail "SWT_SESSION_ID fallback: no session file at fallback-id.json"
fi

# --- 4. malformed JSON exits 0 ---------------------------------------------
SIZE_BEFORE=$(ls "$SWT_PLANNING_DIR/.sessions/" 2>/dev/null | wc -l | tr -d ' ')
echo 'not json at all' | bash "$START" >/dev/null 2>&1
RC=$?
SIZE_AFTER=$(ls "$SWT_PLANNING_DIR/.sessions/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$RC" -eq 0 ] && [ "$SIZE_AFTER" = "$SIZE_BEFORE" ]; then
  pass "agent-start.sh exits 0 on malformed JSON without writing state"
else
  fail "agent-start.sh malformed-JSON path: rc=$RC, before=$SIZE_BEFORE, after=$SIZE_AFTER"
fi

# --- 5. agent-stop.sh removes the session file -----------------------------
# Seed a session, then stop it.
echo '{"role":"dev","sessionId":"to-remove"}' | bash "$START" >/dev/null 2>&1
[ -f "$SWT_PLANNING_DIR/.sessions/to-remove.json" ] || fail "precondition: agent-start did not seed to-remove.json"
echo '{"role":"dev","sessionId":"to-remove"}' | bash "$STOP" >/dev/null 2>&1
if [ ! -f "$SWT_PLANNING_DIR/.sessions/to-remove.json" ]; then
  pass "agent-stop.sh removes session-state file"
else
  fail "agent-stop.sh did not remove .sessions/to-remove.json"
fi

# --- 6. last-words crash recovery path -------------------------------------
# Seed a session, set up a phase dir with NO SUMMARY.md, and verify last-words.
mkdir -p "$SWT_PLANNING_DIR/phases/02-script-port-finalisation" 2>/dev/null
printf '{"phase":"02"}\n' > "$SWT_PLANNING_DIR/.execution-state.json"
echo '{"role":"dev","sessionId":"crash-1"}' | bash "$START" >/dev/null 2>&1
echo '{"role":"dev","sessionId":"crash-1","last_assistant_message":"I crashed mid-task!"}' | bash "$STOP" >/dev/null 2>&1
LW_FILE="$SWT_PLANNING_DIR/.agent-last-words/crash-1.txt"
if [ -f "$LW_FILE" ] && grep -q "I crashed mid-task!" "$LW_FILE" 2>/dev/null; then
  pass "agent-stop.sh writes last-words when last_assistant_message is present and no SUMMARY.md exists"
else
  fail "last-words crash recovery: file missing or wrong content at $LW_FILE"
fi

# --- 7. last-words NOT written when last_assistant_message is empty -------
echo '{"role":"dev","sessionId":"no-crash"}' | bash "$START" >/dev/null 2>&1
echo '{"role":"dev","sessionId":"no-crash","last_assistant_message":""}' | bash "$STOP" >/dev/null 2>&1
if [ ! -f "$SWT_PLANNING_DIR/.agent-last-words/no-crash.txt" ]; then
  pass "agent-stop.sh does NOT write last-words when last_assistant_message is empty"
else
  fail "agent-stop.sh wrote last-words file for empty last_assistant_message"
fi

# --- 8. agent-spawn-guard.sh exits 0 regardless of input -------------------
echo '{"tool_name":"anything","tool_input":{"file_path":"/foo"}}' | bash "$GUARD" >/dev/null 2>&1
RC1=$?
echo 'garbage input' | bash "$GUARD" >/dev/null 2>&1
RC2=$?
echo '' | bash "$GUARD" >/dev/null 2>&1
RC3=$?
if [ "$RC1" -eq 0 ] && [ "$RC2" -eq 0 ] && [ "$RC3" -eq 0 ]; then
  pass "agent-spawn-guard.sh exits 0 regardless of input ($RC1/$RC2/$RC3)"
else
  fail "agent-spawn-guard.sh did not exit 0: rc1=$RC1 rc2=$RC2 rc3=$RC3"
fi

# --- 9. Legacy .agent_type jq path is fully removed ------------------------
# Critical Scout §F Conflict 2 fix: scripts must NOT grep-match the legacy
# VBW jq paths.
LEGACY_HITS=$(grep -c 'jq.*agent_type' "$START" "$STOP" 2>/dev/null | awk -F: '{ sum += $2 } END { print sum + 0 }')
if [ "$LEGACY_HITS" -eq 0 ]; then
  pass "no script grep-matches the legacy 'jq.*agent_type' payload field (Scout §F Conflict 2 fix)"
else
  fail "legacy 'jq.*agent_type' still present in agent-start/stop (count=$LEGACY_HITS)"
fi

# --- Footer ---------------------------------------------------------------
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
