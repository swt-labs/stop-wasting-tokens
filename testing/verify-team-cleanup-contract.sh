#!/usr/bin/env bash
set -u

# verify-team-cleanup-contract.sh — Phase 2 (plan 02-03) structural test
# for the clean-stale-teams.sh contract:
#
#   1. active team with recent heartbeat is unchanged.
#   2. active team with heartbeat > SWT_TEAM_STALE_AFTER (default 1hr) is
#      promoted to status=stale.
#   3. stale team older than SWT_TEAM_REMOVE_AFTER (default 24hr) is removed.
#   4. clean-stale-teams.sh contains zero references to the legacy CC team
#      directory (~/.claude/teams or CLAUDE_CONFIG_DIR/teams).
#   5. clean-stale-teams.sh exits 0 when the .teams dir is empty.

ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
CLEAN="${ROOT}/scripts/clean-stale-teams.sh"

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
TMP_ROOT="$(mktemp -d -t swt-team-cleanup-XXXXXX 2>/dev/null || mktemp -d /tmp/swt-team-cleanup.XXXXXX)"
if [ -z "${TMP_ROOT}" ] || [ ! -d "${TMP_ROOT}" ]; then
  echo "FATAL: could not create tmp dir" >&2
  exit 1
fi

cleanup() {
  rm -rf "${TMP_ROOT}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

export SWT_PLANNING_DIR="${TMP_ROOT}/.swt-planning"
mkdir -p "$SWT_PLANNING_DIR/.teams"
# Avoid leaking outer environment into the test cases.
unset VBW_PLANNING_DIR SWT_TEAM_STALE_AFTER SWT_TEAM_REMOVE_AFTER

echo "=== Team cleanup contract verification ==="
echo "tmp: ${TMP_ROOT}"
echo "SWT_PLANNING_DIR=${SWT_PLANNING_DIR}"

# Portable "N hours ago" helper (BSD date on macOS, GNU date on Linux).
iso_n_hours_ago() {
  local n="$1"
  date -u -v-"${n}H" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -d "${n} hours ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || printf '1970-01-01T00:00:00Z'
}

NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TWO_HRS_AGO=$(iso_n_hours_ago 2)
THIRTY_HRS_AGO=$(iso_n_hours_ago 30)

# Seed three team fixtures.
printf '{"teamId":"team-active","createdAt":"%s","status":"active","members":[],"lastHeartbeat":"%s"}\n' \
  "$NOW_ISO" "$NOW_ISO" > "$SWT_PLANNING_DIR/.teams/team-active.json"
printf '{"teamId":"team-going-stale","createdAt":"%s","status":"active","members":[],"lastHeartbeat":"%s"}\n' \
  "$TWO_HRS_AGO" "$TWO_HRS_AGO" > "$SWT_PLANNING_DIR/.teams/team-going-stale.json"
printf '{"teamId":"team-old-stale","createdAt":"%s","status":"stale","members":[],"lastHeartbeat":"%s"}\n' \
  "$THIRTY_HRS_AGO" "$THIRTY_HRS_AGO" > "$SWT_PLANNING_DIR/.teams/team-old-stale.json"

bash "$CLEAN" >/dev/null 2>&1
RC=$?

# --- 1. team-active unchanged ----------------------------------------------
if [ -f "$SWT_PLANNING_DIR/.teams/team-active.json" ]; then
  STATUS=$(jq -r '.status // empty' "$SWT_PLANNING_DIR/.teams/team-active.json" 2>/dev/null || printf '')
  if [ "$STATUS" = "active" ]; then
    pass "team-active is unchanged (status=active)"
  else
    fail "team-active: status='$STATUS', expected 'active'"
  fi
else
  fail "team-active.json was removed (should be untouched)"
fi

# --- 2. team-going-stale promoted to status=stale --------------------------
if [ -f "$SWT_PLANNING_DIR/.teams/team-going-stale.json" ]; then
  STATUS=$(jq -r '.status // empty' "$SWT_PLANNING_DIR/.teams/team-going-stale.json" 2>/dev/null || printf '')
  if [ "$STATUS" = "stale" ]; then
    pass "team-going-stale promoted active -> stale (Decision 5)"
  else
    fail "team-going-stale: status='$STATUS', expected 'stale'"
  fi
else
  fail "team-going-stale.json was removed (should have been marked stale, not removed)"
fi

# --- 3. team-old-stale removed ---------------------------------------------
if [ ! -f "$SWT_PLANNING_DIR/.teams/team-old-stale.json" ]; then
  pass "team-old-stale removed (status=stale > 24hr threshold)"
else
  fail "team-old-stale.json still exists; should have been removed"
fi

# --- 4. No CC-era team directory references --------------------------------
CC_HITS=$(grep -cE '~/\.claude/teams|CLAUDE_CONFIG_DIR/teams' "$CLEAN" 2>/dev/null)
CC_HITS="${CC_HITS:-0}"
if [ "${CC_HITS:-0}" -eq 0 ]; then
  pass "clean-stale-teams.sh contains no CC-era team-dir references"
else
  fail "clean-stale-teams.sh still references CC team directories (count=$CC_HITS)"
fi

# --- 5. Empty .teams dir -> rc 0 -------------------------------------------
EMPTY_TMP="$(mktemp -d /tmp/swt-team-empty.XXXXXX)"
export SWT_PLANNING_DIR="${EMPTY_TMP}/.swt-planning"
mkdir -p "$SWT_PLANNING_DIR/.teams"
bash "$CLEAN" >/dev/null 2>&1
EMPTY_RC=$?
if [ "$EMPTY_RC" -eq 0 ]; then
  pass "clean-stale-teams.sh exits 0 when .teams dir is empty"
else
  fail "clean-stale-teams.sh empty .teams: rc=$EMPTY_RC"
fi
rm -rf "$EMPTY_TMP" 2>/dev/null || true

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
