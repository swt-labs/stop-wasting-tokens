#!/usr/bin/env bash
set -euo pipefail

# verify-ghost-team-cleanup.sh — Phase 2 (plan 02-05 T1) fixture migration.
#
# Migrated from the CC TeamDelete residual-cleanup shape to the SWT-shaped
# .swt-planning/.teams/{teamId}.json lifecycle defined by Decision 5 and
# implemented in scripts/clean-stale-teams.sh (plan 02-03) +
# scripts/lib/swt-team-state.sh (plan 02-01).
#
# Lifecycle exercised:
#   active                            -- fresh heartbeat
#     | heartbeat older than SWT_TEAM_STALE_AFTER (default 3600s)
#     v
#   stale (mark via clean-stale-teams.sh pass)
#     | status=stale older than SWT_TEAM_REMOVE_AFTER (default 86400s)
#     v
#   removed (file gone from .swt-planning/.teams/)
#
# We override SWT_TEAM_STALE_AFTER and SWT_TEAM_REMOVE_AFTER per-test to
# avoid waiting real wall-clock hours. All state is contained in a
# per-test mktemp -d (no writes outside $TEST_PARENT).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLEAN_SCRIPT="$ROOT/scripts/clean-stale-teams.sh"

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

# Setup a fresh SWT_PLANNING_DIR per test (so cases do not interfere).
setup_planning_dir() {
  local dir
  dir=$(mktemp -d "$TEST_PARENT/planning.XXXXXX")
  mkdir -p "$dir/.teams"
  printf '%s' "$dir"
}

# Seed a team file. Args:
#   $1 dir             -- SWT_PLANNING_DIR
#   $2 teamId          -- swt-foo-abc
#   $3 status          -- active | stale | cleaned
#   $4 heartbeat_iso   -- ISO-8601 timestamp
seed_team() {
  local dir="$1" team_id="$2" status="$3" hb="$4"
  jq -n \
    --arg teamId "$team_id" \
    --arg status "$status" \
    --arg hb "$hb" \
    '{
      teamId: $teamId,
      createdAt: $hb,
      status: $status,
      members: [],
      lastHeartbeat: $hb
    }' > "$dir/.teams/${team_id}.json"
}

# ISO timestamp generator — accepts an offset in seconds from "now".
iso_offset() {
  local offset="$1"
  local target
  if date -u -v-1S +%s >/dev/null 2>&1; then
    # BSD/macOS: -v offset semantics use units; just do epoch math.
    target=$(( $(date -u +%s) + offset ))
    date -u -r "$target" +"%Y-%m-%dT%H:%M:%SZ"
  else
    # GNU date.
    date -u -d "@$(( $(date -u +%s) + offset ))" +"%Y-%m-%dT%H:%M:%SZ"
  fi
}

# Run clean-stale-teams.sh against a planning dir with the given thresholds.
# Defaults preserve production behavior (1h stale, 24h remove); per-test
# overrides shrink the windows so we can drive transitions with synthetic
# timestamps without sleeping.
run_clean() {
  local dir="$1"
  local stale_after="${2:-3600}"
  local remove_after="${3:-86400}"
  SWT_PLANNING_DIR="$dir" \
    SWT_TEAM_STALE_AFTER="$stale_after" \
    SWT_TEAM_REMOVE_AFTER="$remove_after" \
    bash "$CLEAN_SCRIPT" 2>/dev/null
}

# --- Test 1: active + fresh heartbeat -> untouched
test_active_fresh_untouched() {
  local dir
  dir=$(setup_planning_dir)
  local fresh
  fresh=$(iso_offset -60)            # 1 minute ago
  seed_team "$dir" "swt-active-fresh" "active" "$fresh"

  run_clean "$dir" 3600 86400

  if [ ! -f "$dir/.teams/swt-active-fresh.json" ]; then
    fail "active+fresh team file removed unexpectedly"
    return
  fi
  local status
  status=$(jq -r '.status' "$dir/.teams/swt-active-fresh.json" 2>/dev/null)
  if [ "$status" = "active" ]; then
    pass "active+fresh team: untouched (status=active)"
  else
    fail "active+fresh team: status became '$status', expected 'active'"
  fi
}

# --- Test 2: active + heartbeat older than stale threshold -> transitions to stale
test_active_going_stale_transitions() {
  local dir
  dir=$(setup_planning_dir)
  local before_hb
  before_hb=$(iso_offset -7200)      # 2 hours ago
  seed_team "$dir" "swt-active-going-stale" "active" "$before_hb"

  # stale_after=3600 (1h), so 2h-ago active should transition to stale.
  run_clean "$dir" 3600 86400

  if [ ! -f "$dir/.teams/swt-active-going-stale.json" ]; then
    fail "active->stale candidate was unexpectedly removed"
    return
  fi
  local status new_hb
  status=$(jq -r '.status' "$dir/.teams/swt-active-going-stale.json" 2>/dev/null)
  new_hb=$(jq -r '.lastHeartbeat' "$dir/.teams/swt-active-going-stale.json" 2>/dev/null)
  if [ "$status" = "stale" ] && [ "$new_hb" != "$before_hb" ]; then
    pass "active->stale transition: status flipped and heartbeat bumped"
  else
    fail "active->stale transition failed (status=$status, hb_changed=$([ "$new_hb" != "$before_hb" ] && echo yes || echo no))"
  fi
}

# --- Test 3: stale + heartbeat within remove window -> kept
test_stale_still_young_kept() {
  local dir
  dir=$(setup_planning_dir)
  local hb
  hb=$(iso_offset -7200)             # 2 hours ago (well under 24h remove)
  seed_team "$dir" "swt-stale-still-young" "stale" "$hb"

  run_clean "$dir" 3600 86400

  if [ -f "$dir/.teams/swt-stale-still-young.json" ]; then
    local status
    status=$(jq -r '.status' "$dir/.teams/swt-stale-still-young.json" 2>/dev/null)
    if [ "$status" = "stale" ]; then
      pass "stale + within remove window: kept (status=stale)"
    else
      fail "stale young team: status became '$status', expected 'stale'"
    fi
  else
    fail "stale young team: removed unexpectedly"
  fi
}

# --- Test 4: stale + heartbeat older than remove threshold -> removed
test_stale_old_removed() {
  local dir
  dir=$(setup_planning_dir)
  local hb
  hb=$(iso_offset -108000)           # 30 hours ago (> 24h remove)
  seed_team "$dir" "swt-stale-old" "stale" "$hb"

  run_clean "$dir" 3600 86400

  if [ ! -f "$dir/.teams/swt-stale-old.json" ]; then
    pass "stale + beyond remove window: file removed"
  else
    fail "stale + beyond remove window: file should have been removed"
  fi
}

# --- Test 5: malformed JSON -> not crashed, file preserved
test_malformed_preserved() {
  local dir
  dir=$(setup_planning_dir)
  # Write a non-JSON body — clean-stale-teams should log + skip.
  printf '%s' 'this is not json {{{' > "$dir/.teams/swt-malformed.json"

  if run_clean "$dir" 3600 86400; then
    : # script exit 0 expected (hook-wrapper invariant)
  else
    fail "clean-stale-teams returned non-zero on malformed input"
    return
  fi

  if [ -f "$dir/.teams/swt-malformed.json" ]; then
    pass "malformed team file: conservatively preserved (logged + skipped)"
  else
    fail "malformed team file: was auto-removed (should be conservative)"
  fi
}

# --- Test 6: clean-stale-teams.sh always exits 0 (hook-wrapper invariant)
test_exit_zero_invariant() {
  local dir
  dir=$(setup_planning_dir)
  # No teams at all.
  if run_clean "$dir" 3600 86400; then
    pass "clean-stale-teams.sh exits 0 on empty .teams/ dir"
  else
    fail "clean-stale-teams.sh did not exit 0 on empty input"
  fi
}

# --- Test 7: clean-stale-teams.sh body references the SWT team state lib
test_script_uses_swt_team_state_lib() {
  if grep -q 'swt-team-state.sh\|swt_team_list\|swt_team_mark_stale' "$CLEAN_SCRIPT"; then
    pass "clean-stale-teams.sh references SWT team-state lib (plan 02-03)"
  else
    fail "clean-stale-teams.sh missing SWT team-state lib reference"
  fi
}

# --- Test 8: regression — test fixtures never set CC plugin env vars to
# write into a real home directory. The Decision 5 migration mandates
# sandbox-safe fixtures that only touch $TEST_PARENT (mktemp -d).
test_fixtures_sandbox_safe() {
  # Detect any actual assignment/export of the CC plugin config env var
  # (not a comment mentioning the migration). The migration removed all
  # such writes; if any creeps back in, this asserts the regression.
  local marker
  marker=$(printf 'CLAUDE_%s_DIR' CONFIG)
  if grep -E "^[^#]*\b${marker}=" "$0" | grep -vq 'test_fixtures_sandbox_safe'; then
    fail "test file assigns ${marker} (sandbox regression)"
  else
    pass "test file: no plugin config-dir assignments (sandbox-safe)"
  fi
}

# --- Run all tests ---
echo "=== Ghost Team Cleanup Tests — SWT lifecycle (plan 02-05 T1) ==="
echo ""

test_active_fresh_untouched
test_active_going_stale_transitions
test_stale_still_young_kept
test_stale_old_removed
test_malformed_preserved
test_exit_zero_invariant
test_script_uses_swt_team_state_lib
test_fixtures_sandbox_safe

echo ""
echo "==============================="
echo "Ghost Team Cleanup: $PASS passed, $FAIL failed"
echo "==============================="

[ "$FAIL" -eq 0 ] || exit 1
