#!/usr/bin/env bash
set -u

# verify-session-state-schema.sh — Phase 2 (plan 02-01) structural test for the
# session + team state schemas + the agent-pid-tracker rewrite.
#
# Asserts:
#   1. swt-session-state.sh sources cleanly + exposes the 5 expected helpers.
#   2. swt-team-state.sh sources cleanly + exposes the 6 expected helpers.
#   3. swt_session_write + swt_session_read round-trip a fixture JSON.
#   4. swt_team_write + swt_team_mark_stale flips status active -> stale.
#   5. agent-pid-tracker.sh register then list returns the registered sessionId.
#   6. agent-pid-tracker.sh register with malformed args exits 0 (hook-wrapper invariant).
#   7. agent-pid-tracker.sh prune removes a session whose .pid is dead.
#   8. The session-state file at .swt-planning/.sessions/{id}.json validates as JSON.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB_SESSION="${ROOT}/scripts/lib/swt-session-state.sh"
LIB_TEAM="${ROOT}/scripts/lib/swt-team-state.sh"
TRACKER="${ROOT}/scripts/agent-pid-tracker.sh"

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
TMP_ROOT="$(mktemp -d -t swt-session-state-XXXXXX 2>/dev/null || mktemp -d /tmp/swt-session-state.XXXXXX)"
if [ -z "${TMP_ROOT}" ] || [ ! -d "${TMP_ROOT}" ]; then
  echo "FATAL: could not create tmp dir" >&2
  exit 1
fi

cleanup() {
  rm -rf "${TMP_ROOT}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

export SWT_PLANNING_DIR="${TMP_ROOT}/.swt-planning"

echo "=== Session/Team state schema verification ==="
echo "tmp: ${TMP_ROOT}"

# --- 1. session lib sources + exposes 5 helpers ----------------------------
if bash -n "${LIB_SESSION}" 2>/dev/null; then
  if (
    # shellcheck disable=SC1090
    . "${LIB_SESSION}" 2>/dev/null
    for fn in swt_session_state_root swt_session_write swt_session_read swt_session_list swt_session_remove swt_session_prune; do
      if ! declare -F "${fn}" >/dev/null 2>&1; then
        echo "missing fn: ${fn}" >&2
        exit 1
      fi
    done
    exit 0
  ); then
    pass "swt-session-state.sh: sources cleanly + exposes 6 helpers (5 CRUD + state-root)"
  else
    fail "swt-session-state.sh: missing one or more helper functions"
  fi
else
  fail "swt-session-state.sh: failed bash -n syntax check"
fi

# --- 2. team lib sources + exposes 6 helpers -------------------------------
if bash -n "${LIB_TEAM}" 2>/dev/null; then
  if (
    # shellcheck disable=SC1090
    . "${LIB_TEAM}" 2>/dev/null
    for fn in swt_team_state_root swt_team_write swt_team_read swt_team_list swt_team_mark_stale swt_team_remove; do
      if ! declare -F "${fn}" >/dev/null 2>&1; then
        echo "missing fn: ${fn}" >&2
        exit 1
      fi
    done
    exit 0
  ); then
    pass "swt-team-state.sh: sources cleanly + exposes 6 helpers"
  else
    fail "swt-team-state.sh: missing one or more helper functions"
  fi
else
  fail "swt-team-state.sh: failed bash -n syntax check"
fi

# --- 3. session write/read round-trip --------------------------------------
ROUNDTRIP_RESULT="$(
  bash -c '
    set -u
    # shellcheck disable=SC1090
    . "$1" 2>/dev/null || exit 1
    body='"'"'{"sessionId":"fixture-1","role":"dev","started_at":"2026-05-13T00:00:00Z","last_heartbeat":"2026-05-13T00:00:00Z"}'"'"'
    swt_session_write fixture-1 "$body"
    out=$(swt_session_read fixture-1)
    if [ "$(printf '"'"'%s'"'"' "$out" | jq -r .sessionId 2>/dev/null)" = "fixture-1" ]; then
      printf OK
    else
      printf "MISMATCH: %s" "$out"
    fi
  ' bash "${LIB_SESSION}" 2>/dev/null
)"
if [ "${ROUNDTRIP_RESULT}" = "OK" ]; then
  pass "swt_session_write + swt_session_read round-trip fixture JSON"
else
  fail "session round-trip failed: ${ROUNDTRIP_RESULT}"
fi

# --- 4. team mark_stale flips status ---------------------------------------
TEAM_RESULT="$(
  bash -c '
    set -u
    # shellcheck disable=SC1090
    . "$1" 2>/dev/null || exit 1
    body='"'"'{"teamId":"swt-fixture-team","createdAt":"2026-05-13T00:00:00Z","status":"active","members":[{"sessionId":"sid-x","role":"dev"}],"lastHeartbeat":"2026-05-13T00:00:00Z"}'"'"'
    swt_team_write swt-fixture-team "$body"
    swt_team_mark_stale swt-fixture-team
    out=$(swt_team_read swt-fixture-team)
    if [ "$(printf '"'"'%s'"'"' "$out" | jq -r .status 2>/dev/null)" = "stale" ]; then
      printf OK
    else
      printf "BAD_STATUS: %s" "$out"
    fi
  ' bash "${LIB_TEAM}" 2>/dev/null
)"
if [ "${TEAM_RESULT}" = "OK" ]; then
  pass "swt_team_mark_stale flips status active -> stale"
else
  fail "team mark_stale failed: ${TEAM_RESULT}"
fi

# --- 5. tracker register + list returns the sessionId ----------------------
"${TRACKER}" register tracker-fixture-1 11111 dev >/dev/null 2>&1 || true
LIST_OUT="$("${TRACKER}" list 2>/dev/null || printf '')"
if printf '%s\n' "${LIST_OUT}" | jq -e 'select(.sessionId == "tracker-fixture-1")' >/dev/null 2>&1; then
  pass "agent-pid-tracker.sh register + list returns the registered sessionId"
else
  fail "tracker register/list did not return sessionId; output: ${LIST_OUT}"
fi

# --- 6. tracker register with malformed args exits 0 -----------------------
"${TRACKER}" register some-id not-a-pid dev >/dev/null 2>&1
RC=$?
if [ "${RC}" -eq 0 ]; then
  pass "agent-pid-tracker.sh register with malformed pid exits 0 (hook-wrapper invariant)"
else
  fail "tracker register with bad pid exited ${RC}, expected 0"
fi

# Also: completely missing args.
"${TRACKER}" register >/dev/null 2>&1
RC=$?
"${TRACKER}" bogus-subcommand >/dev/null 2>&1
RC2=$?
"${TRACKER}" >/dev/null 2>&1
RC3=$?
if [ "${RC}" -eq 0 ] && [ "${RC2}" -eq 0 ] && [ "${RC3}" -eq 0 ]; then
  pass "agent-pid-tracker.sh exits 0 on missing/unknown subcommand (hook-wrapper invariant)"
else
  fail "tracker did not exit 0 on missing/unknown subcommand (got ${RC}/${RC2}/${RC3})"
fi

# --- 7. tracker prune removes dead-pid session -----------------------------
"${TRACKER}" register dead-fixture 99999999 qa >/dev/null 2>&1 || true
"${TRACKER}" prune >/dev/null 2>&1 || true
LIST_AFTER_PRUNE="$("${TRACKER}" list 2>/dev/null || printf '')"
if ! printf '%s\n' "${LIST_AFTER_PRUNE}" | jq -e 'select(.sessionId == "dead-fixture")' >/dev/null 2>&1; then
  pass "agent-pid-tracker.sh prune removes dead-PID session"
else
  fail "tracker prune did NOT remove dead session; output: ${LIST_AFTER_PRUNE}"
fi

# --- 8. on-disk file validates as JSON -------------------------------------
"${TRACKER}" register json-validation-fixture 22222 lead >/dev/null 2>&1 || true
FILE="${SWT_PLANNING_DIR}/.sessions/json-validation-fixture.json"
if [ -f "${FILE}" ] && jq -e . "${FILE}" >/dev/null 2>&1; then
  pass "session-state file validates as JSON (jq -e .)"
else
  fail "session-state file at ${FILE} missing or not valid JSON"
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
