#!/bin/bash
# hook-wrapper.sh — Universal SWT hook wrapper (DXP-01 / Phase 1 plan 01-03 contract).
#
# This script IS the wrapper that enforces the always-exits-0 invariant for every
# other hook script. A misbehaving wrapper crashes every Pi session that hits a
# hook, so the exit-0 discipline is the most critical invariant in the §6 port.
#
# Resolution path (Phase 2 plan 02-04 §6.2 light edit — CC marketplace cache-glob
# removed; SWT does not install through the Claude Code marketplace):
#   1. PRIMARY: ${SWT_INSTALL_ROOT}/scripts/${SCRIPT} — set by
#      applyEnvToProcess() in packages/runtime/src/env.ts at CLI boot.
#   2. EMERGENCY FALLBACK: sibling script next to ${BASH_SOURCE[0]} — covers the
#      case where SWT_INSTALL_ROOT is unset (e.g. script invoked directly from
#      a shell outside of HookDispatcher).
#
# Usage: hook-wrapper.sh <script-name.sh> [extra-args...]
#
# - Passes through stdin (hook JSON context) and extra arguments
# - Logs failures to .swt-planning/.hook-errors.log
# - ALWAYS EXITS 0 (or 2 when the wrapped script intentionally blocks per Phase 1
#   plan 01-03 contract; 2 is reserved for PreToolUse/UserPromptSubmit blocks).

SCRIPT="$1"; shift
[ -z "$SCRIPT" ] && exit 0

# --- SIGHUP trap for terminal force-close ---
# Cleanup orphaned agents on unexpected terminal termination.
# This is a backup for tmux watchdog — handles direct terminal force-close.
cleanup_on_sighup() {
  PLANNING_DIR="${VBW_PLANNING_DIR:-.swt-planning}"
  if [ ! -d "$PLANNING_DIR" ]; then
    exit 1
  fi

  # Resolve agent-pid-tracker.sh from SWT_INSTALL_ROOT (the npm-installed
  # location) — no more marketplace cache-glob (Phase 2 plan 02-04 §6.2).
  TRACKER=""
  if [ -n "${SWT_INSTALL_ROOT:-}" ] && [ -x "$SWT_INSTALL_ROOT/scripts/agent-pid-tracker.sh" ]; then
    TRACKER="$SWT_INSTALL_ROOT/scripts/agent-pid-tracker.sh"
  fi
  if [ -z "$TRACKER" ]; then
    _SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    [ -x "$_SELF_DIR/agent-pid-tracker.sh" ] && TRACKER="$_SELF_DIR/agent-pid-tracker.sh"
  fi

  if [ -z "$TRACKER" ] || [ ! -f "$TRACKER" ]; then
    exit 1
  fi

  # Log SIGHUP trigger
  LOG="$PLANNING_DIR/.hook-errors.log"
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%s")
  echo "[$TS] SIGHUP received, cleaning up agent PIDs" >> "$LOG" 2>/dev/null || true

  # Get active PIDs and terminate with escalation
  PIDS=$(bash "$TRACKER" list 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    for pid in $PIDS; do
      kill -TERM "$pid" 2>/dev/null || true
    done

    # Wait 3s for graceful shutdown, then SIGKILL survivors
    sleep 3
    for pid in $PIDS; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
  fi

  exit 1
}

trap cleanup_on_sighup SIGHUP

# Resolve SWT workspace root (issue #258: bare .swt-planning/ fails in monorepo submodules)
# shellcheck source=lib/swt-config-root.sh
. "$(dirname "$0")/lib/swt-config-root.sh"
find_swt_root

# Debug mode: SWT_DEBUG=1 enables verbose hook tracing to stderr
VBW_DEBUG="${VBW_DEBUG:-0}"

# Resolve debug_logging from config.json (shared flag for all hook diagnostics)
_DBG_ENABLED=0
[ "$VBW_DEBUG" = "1" ] && _DBG_ENABLED=1
if [ "$_DBG_ENABLED" != "1" ] && [ -f "$VBW_PLANNING_DIR/config.json" ] && command -v jq &>/dev/null; then
  _DBG_VAL=$(jq -r '.debug_logging // false' "$VBW_PLANNING_DIR/config.json" 2>/dev/null || echo "false")
  case "$_DBG_VAL" in true|1) _DBG_ENABLED=1 ;; esac
fi

# Resolve target script (Phase 2 plan 02-04 §6.2):
#   1. PRIMARY: ${SWT_INSTALL_ROOT}/scripts/${SCRIPT}
#   2. EMERGENCY: sibling-script (same dir as $0)
TARGET=""
if [ -n "${SWT_INSTALL_ROOT:-}" ] && [ -f "$SWT_INSTALL_ROOT/scripts/$SCRIPT" ]; then
  TARGET="$SWT_INSTALL_ROOT/scripts/$SCRIPT"
fi

if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
  _SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -f "$_SELF_DIR/$SCRIPT" ] && TARGET="$_SELF_DIR/$SCRIPT"
fi

# Resolution failed — log and exit 0 (hook-wrapper invariant: never crash the dispatcher).
if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
  if [ -d "$VBW_PLANNING_DIR" ]; then
    _LOG="$VBW_PLANNING_DIR/.hook-errors.log"
    _TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%s")
    printf '%s hook-wrapper: target not found script=%s SWT_INSTALL_ROOT=%s\n' \
      "$_TS" "$SCRIPT" "${SWT_INSTALL_ROOT:-<unset>}" >> "$_LOG" 2>/dev/null || true
  fi
  exit 0
fi

[ "$VBW_DEBUG" = "1" ] && echo "[SWT DEBUG] hook-wrapper: $SCRIPT → $TARGET" >&2

# Execute — stdin flows through to the target script
# When debug logging is enabled, capture stdout for the debug log while still passing it through
if [ "$_DBG_ENABLED" = "1" ] && [ -d "$VBW_PLANNING_DIR" ]; then
  _DBG_LOG="$VBW_PLANNING_DIR/.hook-debug.log"
  _DBG_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%s")
  _DBG_TMP=$(mktemp 2>/dev/null || echo "/tmp/.swt-hook-dbg-$$")
  bash "$TARGET" "$@" | tee "$_DBG_TMP"
  RC=${PIPESTATUS[0]}
  _DBG_OUTPUT=$(cat "$_DBG_TMP" 2>/dev/null)
  rm -f "$_DBG_TMP" 2>/dev/null
  # Log the hook execution and its full output
  {
    echo "${_DBG_TS} hook=${SCRIPT} exit=${RC}"
    if [ -n "$_DBG_OUTPUT" ]; then
      _DBG_B64=$(echo -n "$_DBG_OUTPUT" | base64 2>/dev/null | tr -d '\n' || echo "encode-failed")
      echo "${_DBG_TS} hook=${SCRIPT} output_base64=${_DBG_B64}"
    fi
  } >> "$_DBG_LOG" 2>/dev/null || true
  # Trim to last 200 entries
  if [ -f "$_DBG_LOG" ]; then
    _DBG_LC=$(wc -l < "$_DBG_LOG" 2>/dev/null | tr -d ' ')
    [ "${_DBG_LC:-0}" -gt 200 ] && { tail -100 "$_DBG_LOG" > "${_DBG_LOG}.tmp" && mv "${_DBG_LOG}.tmp" "$_DBG_LOG"; } 2>/dev/null
  fi
else
  bash "$TARGET" "$@"
  RC=$?
fi
[ "$VBW_DEBUG" = "1" ] && [ "$RC" -ne 0 ] && echo "[SWT DEBUG] hook-wrapper: $SCRIPT exit=$RC" >&2
[ "$RC" -eq 0 ] && exit 0

# Exit 2 = intentional block (PreToolUse/UserPromptSubmit) — pass through, not a failure
[ "$RC" -eq 2 ] && exit 2

# --- Failure: log and exit 0 ---
if [ -d "$VBW_PLANNING_DIR" ]; then
  LOG="$VBW_PLANNING_DIR/.hook-errors.log"
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%s")
  printf '%s %s exit=%d\n' "$TS" "$SCRIPT" "$RC" >> "$LOG" 2>/dev/null
  # Trim to last 50 entries to prevent unbounded growth
  if [ -f "$LOG" ]; then
    LC=$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')
    [ "${LC:-0}" -gt 50 ] && { tail -30 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"; } 2>/dev/null
  fi
fi

exit 0
