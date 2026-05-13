#!/usr/bin/env bash
# swt-session-state.sh — Shared library: per-session JSON state under .swt-planning/.sessions/
#
# Schema for .swt-planning/.sessions/{sessionId}.json
# {
#   "sessionId": "uuid",       # required, matches filename
#   "pid": 12345,              # optional — present only when the spawned process exposes an OS PID
#   "role": "lead|dev|qa|scout|debugger|architect|docs",
#   "started_at": "ISO-8601",
#   "last_heartbeat": "ISO-8601",
#   "phase": "02-script-port-finalisation"  # optional, set when known
# }
#
# This is the single source of truth consumed by agent-start.sh, agent-stop.sh,
# tmux-watchdog.sh, clean-stale-teams.sh, and the TypeScript orchestrator.
#
# Source this file from other scripts:
#   . "$(dirname "$0")/lib/swt-session-state.sh"
#
# All helpers ALWAYS exit 0 (return 0) — hook-wrapper invariant. Errors are
# logged to stderr but never propagate as non-zero exit codes.
#
# Path cascade for SWT_PLANNING_DIR:
#   SWT_PLANNING_DIR -> VBW_PLANNING_DIR -> .swt-planning (relative to CWD)

# Sourced-guard: avoid double-defining functions if sourced twice.
[ -n "${_SWT_SESSION_STATE_SOURCED:-}" ] && return 0
_SWT_SESSION_STATE_SOURCED=1

# --- Path resolution -------------------------------------------------------
swt_session_state_root() {
  local planning_dir="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"
  printf '%s\n' "${planning_dir}/.sessions"
}

# --- Internal helpers ------------------------------------------------------
_swt_session_log() {
  # All log lines go to stderr only; never affects stdout.
  printf '[swt-session-state] %s\n' "$*" >&2
}

_swt_session_iso_now() {
  # ISO-8601 UTC, second precision. Portable across macOS + GNU.
  date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf '1970-01-01T00:00:00Z\n'
}

_swt_session_ensure_root() {
  local root
  root="$(swt_session_state_root)"
  if ! mkdir -p "${root}" 2>/dev/null; then
    _swt_session_log "failed to mkdir state root: ${root}"
    return 1
  fi
  printf '%s\n' "${root}"
  return 0
}

# --- Public helpers --------------------------------------------------------

# swt_session_write <sessionId> <jsonBody>
# Atomic write via tmp + mv. Validates that jsonBody parses as JSON (jq).
swt_session_write() {
  local session_id="${1:-}"
  local body="${2:-}"
  if [ -z "${session_id}" ]; then
    _swt_session_log "swt_session_write: missing sessionId"
    return 0
  fi
  if [ -z "${body}" ]; then
    _swt_session_log "swt_session_write: missing jsonBody for ${session_id}"
    return 0
  fi
  if ! printf '%s' "${body}" | jq -e . >/dev/null 2>&1; then
    _swt_session_log "swt_session_write: invalid JSON for ${session_id}"
    return 0
  fi
  local root
  root="$(_swt_session_ensure_root)" || return 0
  local target="${root}/${session_id}.json"
  local tmp="${target}.tmp.$$"
  if ! printf '%s\n' "${body}" > "${tmp}" 2>/dev/null; then
    _swt_session_log "swt_session_write: failed to write tmp ${tmp}"
    rm -f "${tmp}" 2>/dev/null || true
    return 0
  fi
  if ! mv -f "${tmp}" "${target}" 2>/dev/null; then
    _swt_session_log "swt_session_write: failed to mv ${tmp} -> ${target}"
    rm -f "${tmp}" 2>/dev/null || true
    return 0
  fi
  return 0
}

# swt_session_read <sessionId>
# Echoes the JSON body or `{}` if the file is missing/unreadable.
swt_session_read() {
  local session_id="${1:-}"
  if [ -z "${session_id}" ]; then
    printf '{}\n'
    return 0
  fi
  local root target
  root="$(swt_session_state_root)"
  target="${root}/${session_id}.json"
  if [ ! -f "${target}" ]; then
    printf '{}\n'
    return 0
  fi
  if ! cat "${target}" 2>/dev/null; then
    _swt_session_log "swt_session_read: failed to cat ${target}"
    printf '{}\n'
  fi
  return 0
}

# swt_session_list
# Emits one compact JSON object per line for every *.json in the state root.
swt_session_list() {
  local root
  root="$(swt_session_state_root)"
  if [ ! -d "${root}" ]; then
    return 0
  fi
  local file
  shopt -s nullglob 2>/dev/null || true
  for file in "${root}"/*.json; do
    [ -f "${file}" ] || continue
    if ! jq -c . "${file}" 2>/dev/null; then
      _swt_session_log "swt_session_list: failed to parse ${file}"
    fi
  done
  shopt -u nullglob 2>/dev/null || true
  return 0
}

# swt_session_remove <sessionId>
# Removes the per-session file; never fails loudly.
swt_session_remove() {
  local session_id="${1:-}"
  if [ -z "${session_id}" ]; then
    return 0
  fi
  local root target
  root="$(swt_session_state_root)"
  target="${root}/${session_id}.json"
  rm -f "${target}" 2>/dev/null || true
  return 0
}

# swt_session_prune
# For each session: if `.pid` is present and `kill -0 $pid` fails, remove the
# file. Sessions without a pid (in-process Pi sessions) are left alone.
swt_session_prune() {
  local root
  root="$(swt_session_state_root)"
  if [ ! -d "${root}" ]; then
    return 0
  fi
  local file pid
  shopt -s nullglob 2>/dev/null || true
  for file in "${root}"/*.json; do
    [ -f "${file}" ] || continue
    pid="$(jq -r '.pid // empty' "${file}" 2>/dev/null || printf '')"
    if [ -z "${pid}" ] || [ "${pid}" = "null" ]; then
      continue
    fi
    # Must be a positive integer.
    case "${pid}" in
      ''|*[!0-9]*) continue ;;
    esac
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${file}" 2>/dev/null || true
    fi
  done
  shopt -u nullglob 2>/dev/null || true
  return 0
}
