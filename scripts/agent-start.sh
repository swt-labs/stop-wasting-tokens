#!/usr/bin/env bash
set -u
# agent-start.sh — Phase 2 §6.3 rewrite.
#
# SubagentStart hook handler. Consumes the Phase 1 dispatcher payload
# (packages/runtime/src/hooks/dispatcher.ts dispatchSessionEvent) — NOT
# the legacy VBW shape. The stdin JSON is the resolved HookContext:
#
#   { "sessionId": "...", "installRoot": "...", "cwd": "...", "role": "..." }
#
# Legacy VBW fields (`agent_type`, `agent_name`, `pid`) are NO LONGER
# expected — see Scout Research §F Conflict 2 + Recommendation 7.
# Env fallback for missing stdin fields:
#   .role       -> $VBW_AGENT_ROLE (dispatcher.ts line 420)
#   .sessionId  -> $SWT_SESSION_ID (dispatcher.ts line 412)
#
# Writes per-session JSON state via the shared swt-session-state.sh helpers
# (plan 02-01) and increments the active-agent count via lib/active-agent-state.sh
# (§6.1 verbatim). Tmux pane tracking is REMOVED (Decision 1 — tmux cleanup
# lives at the watchdog level, plan 02-03).
#
# Hook-wrapper invariant: ALWAYS exits 0, even on parse failures, missing
# libraries, or jq absence. Errors log to stderr only.

INPUT=$(cat 2>/dev/null || printf '')

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || SCRIPT_DIR="$(dirname "$0")"

# Source the shared session-state library (plan 02-01).
if [ -f "$SCRIPT_DIR/lib/swt-session-state.sh" ]; then
  # shellcheck source=lib/swt-session-state.sh
  . "$SCRIPT_DIR/lib/swt-session-state.sh" 2>/dev/null || true
fi

# Source active-agent-state.sh (§6.1 verbatim). Optional — agent-start.sh
# still functions for the session-state write if this lib is unavailable.
if [ -f "$SCRIPT_DIR/lib/active-agent-state.sh" ]; then
  # shellcheck source=lib/active-agent-state.sh
  . "$SCRIPT_DIR/lib/active-agent-state.sh" 2>/dev/null || true
fi

PLANNING_DIR="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"

# --- Parse Phase 1 dispatcher payload --------------------------------------
# Reads .role / .sessionId / .installRoot — NOT .agent_type / .pid.

ROLE=""
SESSION_ID=""
INSTALL_ROOT=""

if command -v jq >/dev/null 2>&1 && [ -n "$INPUT" ]; then
  ROLE=$(printf '%s' "$INPUT" | jq -r '.role // empty' 2>/dev/null || printf '')
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.sessionId // empty' 2>/dev/null || printf '')
  INSTALL_ROOT=$(printf '%s' "$INPUT" | jq -r '.installRoot // empty' 2>/dev/null || printf '')
fi

# Env fallback chain per dispatcher.ts buildEnv (Research §F Recommendation 7).
[ -z "$ROLE" ] && ROLE="${VBW_AGENT_ROLE:-}"
[ -z "$SESSION_ID" ] && SESSION_ID="${SWT_SESSION_ID:-}"
[ -z "$INSTALL_ROOT" ] && INSTALL_ROOT="${SWT_INSTALL_ROOT:-}"

# Without a sessionId we cannot proceed — no key for the state file.
if [ -z "$SESSION_ID" ]; then
  echo "[agent-start] no sessionId (stdin or env); skipping session-state write" >&2
  exit 0
fi

# --- Normalize role --------------------------------------------------------
normalize_agent_role() {
  local value="${1:-}"
  local lower
  lower=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')
  lower="${lower#@}"
  lower="${lower#vbw:}"
  lower="${lower#swt-}"
  lower="${lower#vbw-}"
  lower="${lower#team-}"
  case "$lower" in
    lead|lead-[0-9]*)            printf 'lead'; return 0 ;;
    dev|dev-[0-9]*)              printf 'dev'; return 0 ;;
    qa|qa-[0-9]*)                printf 'qa'; return 0 ;;
    scout|scout-[0-9]*)          printf 'scout'; return 0 ;;
    debugger|debugger-[0-9]*)    printf 'debugger'; return 0 ;;
    architect|architect-[0-9]*)  printf 'architect'; return 0 ;;
    docs|docs-[0-9]*)            printf 'docs'; return 0 ;;
  esac
  return 1
}

NORMALIZED_ROLE=""
if [ -n "$ROLE" ] && NORMALIZED_ROLE=$(normalize_agent_role "$ROLE"); then
  ROLE="$NORMALIZED_ROLE"
else
  ROLE="unknown"
fi

# --- Active-agent count + per-role tracking --------------------------------
# Phase 3 may export SWT_AGENT_PID; until then PPID is a stable fallback for
# the role-pid table used by active-agent-state's reconciliation logic.
AGENT_PID="${SWT_AGENT_PID:-$PPID}"

if [ "$ROLE" != "unknown" ] && command -v vbw_active_agent_start >/dev/null 2>&1; then
  if [ -d "$PLANNING_DIR" ] || mkdir -p "$PLANNING_DIR" 2>/dev/null; then
    # Synthesize an input JSON the legacy helper understands. Its
    # vbw_active_agent_session_id reads `.session_id`; threading SESSION_ID
    # there ensures session-scoped state-dir usage.
    SYNTH_INPUT="{}"
    if command -v jq >/dev/null 2>&1; then
      SYNTH_INPUT=$(jq -nc --arg sid "$SESSION_ID" '{session_id: $sid}' 2>/dev/null || printf '{"session_id":"%s"}' "$SESSION_ID")
    else
      SYNTH_INPUT="{\"session_id\":\"$SESSION_ID\"}"
    fi
    vbw_active_agent_start "$PLANNING_DIR" "$SYNTH_INPUT" "$ROLE" "$AGENT_PID" 2>/dev/null || true
  fi
fi

# --- Session-state write (plan 02-01) --------------------------------------
if command -v swt_session_write >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf '1970-01-01T00:00:00Z')
  BODY=""
  if [ -n "${SWT_AGENT_PID:-}" ] && printf '%s' "${SWT_AGENT_PID}" | grep -Eq '^[0-9]+$'; then
    BODY=$(jq -nc \
      --arg id "$SESSION_ID" \
      --arg role "$ROLE" \
      --arg ts "$TS" \
      --argjson pid "${SWT_AGENT_PID}" \
      '{sessionId: $id, role: $role, started_at: $ts, last_heartbeat: $ts, pid: $pid}' \
      2>/dev/null || printf '')
  else
    BODY=$(jq -nc \
      --arg id "$SESSION_ID" \
      --arg role "$ROLE" \
      --arg ts "$TS" \
      '{sessionId: $id, role: $role, started_at: $ts, last_heartbeat: $ts}' \
      2>/dev/null || printf '')
  fi
  if [ -n "$BODY" ]; then
    swt_session_write "$SESSION_ID" "$BODY" 2>/dev/null || true
  fi
else
  echo "[agent-start] swt-session-state.sh or jq unavailable; skipping session write for $SESSION_ID" >&2
fi

# Hook-wrapper invariant: always exit 0.
exit 0
