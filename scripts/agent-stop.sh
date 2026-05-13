#!/usr/bin/env bash
set -u
# agent-stop.sh — Phase 2 §6.3 rewrite.
#
# SubagentStop hook handler. Consumes the Phase 1 dispatcher payload
# (packages/runtime/src/hooks/dispatcher.ts dispatchSessionEvent) — NOT
# the legacy VBW shape. The stdin JSON is the resolved HookContext
# plus an optional CC-specific `last_assistant_message`:
#
#   { "sessionId": "...", "role": "...", "last_assistant_message": "..." (optional) }
#
# Legacy VBW fields (`agent_type`, `agent_name`, `pid`) are NO LONGER
# expected — see Scout Research §F Conflict 2 + Recommendation 7.
# Env fallback chain:
#   .role       -> $VBW_AGENT_ROLE  (dispatcher.ts line 420)
#   .sessionId  -> $SWT_SESSION_ID  (dispatcher.ts line 412)
#
# Behavior:
#   1. Decrements the active-agent count via lib/active-agent-state.sh.
#   2. Removes the per-session JSON state file via swt_session_remove (plan 02-01).
#   3. Last-words crash recovery: when `last_assistant_message` is present
#      AND no SUMMARY.md exists under the active phase dir, writes the
#      message to .swt-planning/.agent-last-words/{sessionId}.txt. Pi may
#      not supply the field (CC-specific); we treat it as optional and
#      skip the write when empty.
#
# Tmux pane cleanup is REMOVED (Decision 1 — tmux cleanup lives at the
# watchdog level, plan 02-03).
#
# Hook-wrapper invariant: ALWAYS exits 0, even on parse failures, missing
# libraries, or jq absence.

INPUT=$(cat 2>/dev/null || printf '')

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || SCRIPT_DIR="$(dirname "$0")"

# Source the shared session-state library (plan 02-01).
if [ -f "$SCRIPT_DIR/lib/swt-session-state.sh" ]; then
  # shellcheck source=lib/swt-session-state.sh
  . "$SCRIPT_DIR/lib/swt-session-state.sh" 2>/dev/null || true
fi

# Source active-agent-state.sh (§6.1 verbatim).
if [ -f "$SCRIPT_DIR/lib/active-agent-state.sh" ]; then
  # shellcheck source=lib/active-agent-state.sh
  . "$SCRIPT_DIR/lib/active-agent-state.sh" 2>/dev/null || true
fi

PLANNING_DIR="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"

# --- Parse Phase 1 dispatcher payload --------------------------------------
ROLE=""
SESSION_ID=""
LAST_MESSAGE=""

if command -v jq >/dev/null 2>&1 && [ -n "$INPUT" ]; then
  ROLE=$(printf '%s' "$INPUT" | jq -r '.role // empty' 2>/dev/null || printf '')
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.sessionId // empty' 2>/dev/null || printf '')
  LAST_MESSAGE=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null || printf '')
fi

# Env fallback chain per dispatcher.ts buildEnv.
[ -z "$ROLE" ] && ROLE="${VBW_AGENT_ROLE:-}"
[ -z "$SESSION_ID" ] && SESSION_ID="${SWT_SESSION_ID:-}"

# Nothing useful to do without a sessionId.
if [ -z "$SESSION_ID" ]; then
  echo "[agent-stop] no sessionId (stdin or env); nothing to clear" >&2
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
  ROLE=""
fi

AGENT_PID="${SWT_AGENT_PID:-$PPID}"

# --- Decrement active-agent count -------------------------------------------
if command -v vbw_active_agent_stop >/dev/null 2>&1; then
  if [ -d "$PLANNING_DIR" ]; then
    SYNTH_INPUT="{}"
    if command -v jq >/dev/null 2>&1; then
      SYNTH_INPUT=$(jq -nc --arg sid "$SESSION_ID" '{session_id: $sid}' 2>/dev/null || printf '{"session_id":"%s"}' "$SESSION_ID")
    else
      SYNTH_INPUT="{\"session_id\":\"$SESSION_ID\"}"
    fi
    vbw_active_agent_stop "$PLANNING_DIR" "$SYNTH_INPUT" "$ROLE" "$AGENT_PID" 2>/dev/null || true
  fi
fi

# --- Last-words crash recovery (preserves VBW pattern) ---------------------
# Detect active phase from .execution-state.json. If the phase dir has
# zero SUMMARY.md files AND last_assistant_message is non-empty, persist
# the message under .agent-last-words/{sessionId}.txt for post-mortem.
if [ -n "$LAST_MESSAGE" ] && [ -d "$PLANNING_DIR" ]; then
  EXEC_STATE="$PLANNING_DIR/.execution-state.json"
  PHASE_NUM=""
  if [ -f "$EXEC_STATE" ] && command -v jq >/dev/null 2>&1; then
    PHASE_NUM=$(jq -r '.phase // ""' "$EXEC_STATE" 2>/dev/null || printf '')
  fi

  WRITE_LAST_WORDS=0
  if [ -n "$PHASE_NUM" ]; then
    PHASE_DIR=""
    for d in "$PLANNING_DIR/phases/${PHASE_NUM}-"*; do
      [ -d "$d" ] && { PHASE_DIR="$d"; break; }
    done
    if [ -n "$PHASE_DIR" ] && [ -r "$PHASE_DIR" ]; then
      SUMMARY_COUNT=$(find "$PHASE_DIR" -maxdepth 1 -type f -name '*-SUMMARY.md' 2>/dev/null | wc -l | tr -d ' ' || printf '0')
      if [ -n "$SUMMARY_COUNT" ] && [ "$SUMMARY_COUNT" -eq 0 ]; then
        WRITE_LAST_WORDS=1
      fi
    fi
  else
    # No execution state -> assume crash-recovery write is safe (no phase
    # boundary to compare against). This matches VBW's permissive default.
    WRITE_LAST_WORDS=1
  fi

  if [ "$WRITE_LAST_WORDS" -eq 1 ]; then
    LAST_WORDS_DIR="$PLANNING_DIR/.agent-last-words"
    LAST_WORDS_FILE="$LAST_WORDS_DIR/${SESSION_ID}.txt"
    mkdir -p "$LAST_WORDS_DIR" 2>/dev/null || true
    TMP="${LAST_WORDS_FILE}.tmp.$$"
    if printf '%s\n' "$LAST_MESSAGE" > "$TMP" 2>/dev/null; then
      mv -f "$TMP" "$LAST_WORDS_FILE" 2>/dev/null || rm -f "$TMP" 2>/dev/null || true
    else
      rm -f "$TMP" 2>/dev/null || true
    fi
  fi
fi

# --- Remove session-state file (plan 02-01) --------------------------------
if command -v swt_session_remove >/dev/null 2>&1; then
  swt_session_remove "$SESSION_ID" 2>/dev/null || true
fi

# Hook-wrapper invariant: always exit 0.
exit 0
