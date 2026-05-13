#!/usr/bin/env bash
set -u
# tmux-watchdog.sh — Phase 2 §6.3 rewrite (plan 02-03).
#
# Decision 1 (Lead spawn brief): tmux support is preserved with graceful
# degradation. When `${TMUX:-}` is unset, the script exits 0 immediately as a
# no-op — SWT can be invoked from inside a tmux pane or not; both work.
#
# When TMUX is set, the script behaves as a polling daemon that terminates
# orphaned SWT sessions on tmux detach + kills agents stuck in compaction.
#
# Active session PIDs are read from .swt-planning/.sessions/*.json via the
# plan 02-01 swt_session_list helper (the legacy PID-tracker source is gone,
# and the flat agent-pid state file is no longer consulted). The compaction-
# marker namespace is normalized to .swt-planning/.compacting/.
#
# Pane resolution (the legacy pane-map file + per-pane walk) is removed.
# Decision 1 scope: kill-by-PID is sufficient; pane mapping is unnecessary.
#
# Usage: tmux-watchdog.sh [session-name]
# Logs to ${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}/.watchdog.log.
# Hook-wrapper invariant: every error path exits 0 or continues the loop.

# --- Decision 1: graceful degradation guard --------------------------------
# Not in tmux? There is nothing to watch. Exit silently.
if [ -z "${TMUX:-}" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || SCRIPT_DIR="$(dirname "$0")"
PLANNING_DIR="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"

# Source the shared session-state library (plan 02-01).
if [ -f "$SCRIPT_DIR/lib/swt-session-state.sh" ]; then
  # shellcheck source=lib/swt-session-state.sh
  . "$SCRIPT_DIR/lib/swt-session-state.sh" 2>/dev/null || true
fi

# Optional: active-agent-state.sh for the count-decrement housekeeping on
# detach. Best-effort; the script proceeds without it.
if [ -f "$SCRIPT_DIR/lib/active-agent-state.sh" ]; then
  # shellcheck source=lib/active-agent-state.sh
  . "$SCRIPT_DIR/lib/active-agent-state.sh" 2>/dev/null || true
fi

# --- Session name resolution ------------------------------------------------
SESSION="${1:-}"
if [ -z "$SESSION" ]; then
  SESSION=$(tmux display-message -p '#S' 2>/dev/null || true)
fi
if [ -z "$SESSION" ]; then
  echo "[tmux-watchdog] no session name and tmux display-message failed; exiting" >&2
  exit 0
fi

LOG="$PLANNING_DIR/.watchdog.log"
mkdir -p "$PLANNING_DIR" 2>/dev/null || true

log() {
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%d %H:%M:%S")
  echo "[$timestamp] $*" >> "$LOG" 2>/dev/null || echo "[$timestamp] $*" >&2
}

cleanup_detached_agent_state() {
  if command -v vbw_active_agent_clear_all >/dev/null 2>&1; then
    vbw_active_agent_clear_all "$PLANNING_DIR" 2>/dev/null || true
  else
    rm -f \
      "$PLANNING_DIR/.active-agent" \
      "$PLANNING_DIR/.active-agent-count" \
      "$PLANNING_DIR/.active-agent-roles" \
      "$PLANNING_DIR/.active-agent-role-pids" \
      2>/dev/null || true
    rm -rf "$PLANNING_DIR/.active-agents" "$PLANNING_DIR/.active-agent-count.lock" 2>/dev/null || true
  fi
}

# list_active_pids — pipe swt_session_list through jq to extract
# {sessionId, pid} pairs where .pid is present. Replaces the legacy
# external PID-tracker source.
list_active_pids() {
  if command -v swt_session_list >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    swt_session_list 2>/dev/null \
      | jq -r 'select(.pid != null) | "\(.sessionId) \(.pid)"' 2>/dev/null
  fi
}

log "Watchdog started for session: $SESSION (PID=$$, TMUX=$TMUX)"

# Clean stale compaction markers from previous (possibly crashed) sessions.
# Namespace is .swt-planning/.compacting/ (normalized from VBW's bare .compacting/).
mkdir -p "$PLANNING_DIR/.compacting" 2>/dev/null || true
shopt -s nullglob 2>/dev/null || true
for _stale_marker in "$PLANNING_DIR/.compacting"/*.json; do
  [ -f "$_stale_marker" ] || continue
  _stale_pid=$(jq -r '.pid // ""' "$_stale_marker" 2>/dev/null || printf '')
  _stale_ts=$(jq -r '.started_at // ""' "$_stale_marker" 2>/dev/null || printf '')
  if ! echo "$_stale_pid" | grep -Eq '^[1-9][0-9]{0,9}$' \
     || ! echo "$_stale_ts" | grep -Eq '^[1-9][0-9]{0,9}$' \
     || ! kill -0 "$_stale_pid" 2>/dev/null; then
    rm -f "$_stale_marker" 2>/dev/null || true
  fi
done
shopt -u nullglob 2>/dev/null || true

# Validate compaction timeout (env-overridable). Accepts the legacy VBW name
# as a fallback alongside the canonical SWT name.
COMPACTION_TIMEOUT="${VBW_COMPACTION_TIMEOUT:-${SWT_COMPACTION_TIMEOUT:-300}}"
if ! echo "$COMPACTION_TIMEOUT" | grep -Eq '^[1-9][0-9]{0,5}$'; then
  log "Invalid COMPACTION_TIMEOUT='$COMPACTION_TIMEOUT', falling back to 300"
  COMPACTION_TIMEOUT=300
fi

# --- Compaction timeout sweep ----------------------------------------------
# Scans .swt-planning/.compacting/*.json for agents stuck longer than
# COMPACTION_TIMEOUT. Kills the process via SIGTERM then SIGKILL.
check_compaction_timeouts() {
  local compacting_dir="$PLANNING_DIR/.compacting"
  [ -d "$compacting_dir" ] || return 0

  local now marker pid agent_name started_at age
  now=$(date +%s 2>/dev/null || echo "0")

  shopt -s nullglob 2>/dev/null || true
  for marker in "$compacting_dir"/*.json; do
    [ -f "$marker" ] || continue

    pid=$(jq -r '.pid // ""' "$marker" 2>/dev/null || printf '')
    agent_name=$(jq -r '.agent_name // "unknown"' "$marker" 2>/dev/null || printf 'unknown')
    started_at=$(jq -r '.started_at // 0' "$marker" 2>/dev/null || printf '0')

    if ! echo "$pid" | grep -Eq '^[1-9][0-9]{0,9}$' \
       || ! echo "$started_at" | grep -Eq '^[1-9][0-9]{0,9}$'; then
      rm -f "$marker" 2>/dev/null || true
      continue
    fi

    if [ "$started_at" -gt $((now + 60)) ] 2>/dev/null; then
      rm -f "$marker" 2>/dev/null || true
      continue
    fi

    if ! kill -0 "$pid" 2>/dev/null; then
      log "Compaction marker for dead PID $pid ($agent_name); cleaning up"
      rm -f "$marker" 2>/dev/null || true
      continue
    fi

    age=$((now - started_at))
    if [ "$age" -gt "$COMPACTION_TIMEOUT" ] 2>/dev/null; then
      log "COMPACTION TIMEOUT: agent=$agent_name pid=$pid age=${age}s (limit=${COMPACTION_TIMEOUT}s)"
      (
        log "Sending SIGTERM to stuck agent PID $pid"
        kill -TERM "$pid" 2>/dev/null || true
        sleep 2
        if kill -0 "$pid" 2>/dev/null; then
          log "Agent PID $pid survived SIGTERM, sending SIGKILL"
          kill -KILL "$pid" 2>/dev/null || true
        fi
      ) &

      rm -f "$marker" 2>/dev/null || true
      log "Compaction timeout cleanup complete for $agent_name (PID $pid)"
    fi
  done
  shopt -u nullglob 2>/dev/null || true
}

# --- Main polling loop ------------------------------------------------------
consecutive_empty=0
while true; do
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    log "Session $SESSION no longer exists, exiting"
    break
  fi

  CLIENTS=$(tmux list-clients -t "$SESSION" 2>/dev/null | wc -l | tr -d ' ')

  if [ "${CLIENTS:-0}" -eq 0 ]; then
    consecutive_empty=$((consecutive_empty + 1))
    log "No clients attached (consecutive: $consecutive_empty)"

    if [ "$consecutive_empty" -ge 2 ]; then
      log "Session detached (2 consecutive polls), cleaning up agents"

      PAIRS=$(list_active_pids)
      if [ -z "$PAIRS" ]; then
        log "No active session PIDs to terminate"
      else
        # SIGTERM pass.
        echo "$PAIRS" | while IFS=' ' read -r sid pid; do
          [ -z "$pid" ] && continue
          if kill -0 "$pid" 2>/dev/null; then
            log "Sending SIGTERM to session $sid (PID $pid)"
            kill -TERM "$pid" 2>/dev/null || true
          fi
        done

        sleep 3

        # SIGKILL fallback for survivors.
        echo "$PAIRS" | while IFS=' ' read -r sid pid; do
          [ -z "$pid" ] && continue
          if kill -0 "$pid" 2>/dev/null; then
            log "Session $sid PID $pid survived SIGTERM, sending SIGKILL"
            kill -KILL "$pid" 2>/dev/null || true
          fi
        done

        log "Agent cleanup complete"
      fi

      cleanup_detached_agent_state
      rm -rf "$PLANNING_DIR/.compacting" 2>/dev/null || true

      log "Watchdog exiting"
      break
    fi
  else
    if [ "$consecutive_empty" -gt 0 ]; then
      log "Client attached, resetting empty counter"
    fi
    consecutive_empty=0
  fi

  check_compaction_timeouts

  sleep 5
done

exit 0
