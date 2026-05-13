#!/usr/bin/env bash
set -u
# clean-stale-teams.sh — Phase 2 §6.3 rewrite (plan 02-03).
#
# Scans .swt-planning/.teams/{teamId}.json (the SWT-owned namespace; the
# legacy CC-era team directory under the user home is no longer consulted)
# and applies the Decision 5 lifecycle:
#
#   active                          -- normal running team
#     |  (lastHeartbeat older than SWT_TEAM_STALE_AFTER, default 1hr)
#     v
#   stale                           -- marked via swt_team_mark_stale
#     |  (status=stale for older than SWT_TEAM_REMOVE_AFTER, default 24hr)
#     v
#   removed                         -- atomic mv to /tmp then rm -rf
#
# The team-state schema is documented in scripts/lib/swt-team-state.sh (plan 02-01):
#   { teamId, createdAt, status: active|stale|cleaned,
#     members[{sessionId, role}], lastHeartbeat }
#
# Drops everything VBW-specific that was tied to Claude Code:
#   - No legacy CC-home team directory scan; .swt-planning/.teams/ is namespaced.
#   - No vbw-* / swt-* slug filter — the directory is owned by SWT.
#   - No legacy CC-home tasks pairing — SWT has no equivalent.
#   - No pass-1 "configless team" heuristic — Decision 5 requires structured
#     JSON, so malformed files are logged + skipped (not auto-removed).
#
# Hook-wrapper invariant: ALWAYS exits 0. Errors log to .hook-errors.log;
# never propagate.

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || SCRIPT_DIR="$(dirname "$0")"

# Source the shared team-state library (plan 02-01).
if [ -f "$SCRIPT_DIR/lib/swt-team-state.sh" ]; then
  # shellcheck source=lib/swt-team-state.sh
  . "$SCRIPT_DIR/lib/swt-team-state.sh" 2>/dev/null || true
fi

# Optional: log-event.sh for structured transition logging.
if [ -f "$SCRIPT_DIR/log-event.sh" ]; then
  LOG_EVENT_SCRIPT="$SCRIPT_DIR/log-event.sh"
else
  LOG_EVENT_SCRIPT=""
fi

PLANNING_DIR="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"
LOG_FILE="$PLANNING_DIR/.hook-errors.log"

# Decision 5 lifecycle thresholds (env-overridable).
STALE_AFTER_SECONDS="${SWT_TEAM_STALE_AFTER:-3600}"     # 1 hour
REMOVE_AFTER_SECONDS="${SWT_TEAM_REMOVE_AFTER:-86400}"  # 24 hours

mkdir -p "$PLANNING_DIR" 2>/dev/null || true

log_cleanup() {
  local msg="$1"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] clean-stale-teams: $msg" >> "$LOG_FILE" 2>/dev/null || true
}

# Portable ISO-8601 -> epoch seconds. Returns 0 on parse failure so the caller
# can treat unparseable timestamps as "age 0" (safe — no transition triggered).
iso8601_to_epoch() {
  local iso="${1:-}"
  [ -z "$iso" ] && { printf '0'; return 0; }
  local out=""
  # GNU date first (Linux + nix).
  out=$(date -u -d "$iso" +%s 2>/dev/null || printf '')
  if [ -z "$out" ]; then
    # BSD/macOS date.
    out=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$iso" +%s 2>/dev/null || printf '')
  fi
  if [ -z "$out" ]; then
    printf '0'
  else
    printf '%s' "$out"
  fi
  return 0
}

# Resolve team root + bail if absent.
if ! command -v swt_team_state_root >/dev/null 2>&1; then
  log_cleanup "swt-team-state.sh unavailable; skipping cleanup pass"
  exit 0
fi
TEAMS_DIR="$(swt_team_state_root)"

# Graceful exit if teams dir not present yet.
if [ ! -d "$TEAMS_DIR" ]; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  log_cleanup "jq missing; cannot parse team state files"
  exit 0
fi

# Temporary atomic-cleanup staging dir (vendor-neutral pattern preserved
# from the original VBW shape).
TEMP_DIR="/tmp/swt-stale-teams-$$"
mkdir -p "$TEMP_DIR" 2>/dev/null || true

NOW=$(date -u +%s 2>/dev/null || echo "0")

teams_marked=0
teams_removed=0

# Single pass: read each team file, determine the appropriate transition.
shopt -s nullglob 2>/dev/null || true
for team_file in "$TEAMS_DIR"/*.json; do
  [ -f "$team_file" ] || continue

  team_id=$(jq -r '.teamId // empty' "$team_file" 2>/dev/null || printf '')
  status=$(jq -r '.status // empty' "$team_file" 2>/dev/null || printf '')
  last_hb=$(jq -r '.lastHeartbeat // empty' "$team_file" 2>/dev/null || printf '')

  # Malformed / missing schema fields — log + skip (conservative).
  if [ -z "$team_id" ] || [ -z "$status" ] || [ -z "$last_hb" ]; then
    log_cleanup "skipping malformed team file (missing teamId/status/lastHeartbeat): $team_file"
    continue
  fi

  hb_epoch=$(iso8601_to_epoch "$last_hb")
  if [ "$hb_epoch" = "0" ]; then
    log_cleanup "could not parse lastHeartbeat='$last_hb' for $team_id; treating as age=0"
    continue
  fi

  age_seconds=$((NOW - hb_epoch))
  [ "$age_seconds" -lt 0 ] && age_seconds=0

  case "$status" in
    active)
      if [ "$age_seconds" -gt "$STALE_AFTER_SECONDS" ]; then
        swt_team_mark_stale "$team_id" 2>/dev/null || true
        teams_marked=$((teams_marked + 1))
        log_cleanup "active -> stale: $team_id (age=${age_seconds}s, threshold=${STALE_AFTER_SECONDS}s)"
        if [ -n "$LOG_EVENT_SCRIPT" ]; then
          bash "$LOG_EVENT_SCRIPT" team_marked_stale "0" "team_id=${team_id}" "age=${age_seconds}" 2>/dev/null || true
        fi
      fi
      ;;
    stale)
      if [ "$age_seconds" -gt "$REMOVE_AFTER_SECONDS" ]; then
        # Atomic mv-to-tmp then rm-rf preserves VBW's vendor-neutral pattern.
        if mv "$team_file" "$TEMP_DIR/$(basename "$team_file")" 2>/dev/null; then
          teams_removed=$((teams_removed + 1))
          log_cleanup "stale -> removed: $team_id (age=${age_seconds}s, threshold=${REMOVE_AFTER_SECONDS}s)"
          if [ -n "$LOG_EVENT_SCRIPT" ]; then
            bash "$LOG_EVENT_SCRIPT" team_removed "0" "team_id=${team_id}" "age=${age_seconds}" 2>/dev/null || true
          fi
        else
          log_cleanup "failed to mv $team_file to staging; leaving in place"
        fi
      fi
      ;;
    cleaned)
      # Terminal state — also subject to removal after threshold (legacy bodies
      # written by other components may set cleaned instead of stale).
      if [ "$age_seconds" -gt "$REMOVE_AFTER_SECONDS" ]; then
        if mv "$team_file" "$TEMP_DIR/$(basename "$team_file")" 2>/dev/null; then
          teams_removed=$((teams_removed + 1))
          log_cleanup "cleaned -> removed: $team_id (age=${age_seconds}s)"
        fi
      fi
      ;;
    *)
      log_cleanup "skipping team $team_id: unrecognized status '$status'"
      ;;
  esac
done
shopt -u nullglob 2>/dev/null || true

# Atomic-cleanup finish: blow away the staging dir.
rm -rf "$TEMP_DIR" 2>/dev/null || true

if [ "$teams_marked" -gt 0 ] || [ "$teams_removed" -gt 0 ]; then
  log_cleanup "summary: $teams_marked teams marked stale, $teams_removed teams removed"
fi

exit 0
