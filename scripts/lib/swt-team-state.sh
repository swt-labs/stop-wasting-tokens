#!/usr/bin/env bash
# swt-team-state.sh — Shared library: per-team JSON state under .swt-planning/.teams/
#
# Schema for .swt-planning/.teams/{teamId}.json
# {
#   "teamId": "swt-{slug}-{shortHash}",
#   "createdAt": "ISO-8601",
#   "status": "active" | "stale" | "cleaned",
#   "members": [{ "sessionId": "uuid", "role": "lead|dev|qa|..." }],
#   "lastHeartbeat": "ISO-8601"
# }
# Lifecycle: active -> (heartbeat > 1hr) stale -> (status=stale > 24hr OR explicit cleanup) cleaned/removed.
# Phase D dashboard reads these to render team-mode execution state.
#
# Source this file from other scripts:
#   . "$(dirname "$0")/lib/swt-team-state.sh"
#
# All helpers ALWAYS exit 0 (return 0) — hook-wrapper invariant. Errors are
# logged to stderr but never propagate as non-zero exit codes.
#
# Path cascade for SWT_PLANNING_DIR:
#   SWT_PLANNING_DIR -> VBW_PLANNING_DIR -> .swt-planning (relative to CWD)

# Sourced-guard: avoid double-defining functions if sourced twice.
[ -n "${_SWT_TEAM_STATE_SOURCED:-}" ] && return 0
_SWT_TEAM_STATE_SOURCED=1

# --- Path resolution -------------------------------------------------------
swt_team_state_root() {
  local planning_dir="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"
  printf '%s\n' "${planning_dir}/.teams"
}

# --- Internal helpers ------------------------------------------------------
_swt_team_log() {
  printf '[swt-team-state] %s\n' "$*" >&2
}

_swt_team_iso_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf '1970-01-01T00:00:00Z\n'
}

_swt_team_ensure_root() {
  local root
  root="$(swt_team_state_root)"
  if ! mkdir -p "${root}" 2>/dev/null; then
    _swt_team_log "failed to mkdir state root: ${root}"
    return 1
  fi
  printf '%s\n' "${root}"
  return 0
}

# --- Public helpers --------------------------------------------------------

# swt_team_write <teamId> <jsonBody>
# Atomic write via tmp + mv. Validates JSON.
swt_team_write() {
  local team_id="${1:-}"
  local body="${2:-}"
  if [ -z "${team_id}" ]; then
    _swt_team_log "swt_team_write: missing teamId"
    return 0
  fi
  if [ -z "${body}" ]; then
    _swt_team_log "swt_team_write: missing jsonBody for ${team_id}"
    return 0
  fi
  if ! printf '%s' "${body}" | jq -e . >/dev/null 2>&1; then
    _swt_team_log "swt_team_write: invalid JSON for ${team_id}"
    return 0
  fi
  local root
  root="$(_swt_team_ensure_root)" || return 0
  local target="${root}/${team_id}.json"
  local tmp="${target}.tmp.$$"
  if ! printf '%s\n' "${body}" > "${tmp}" 2>/dev/null; then
    _swt_team_log "swt_team_write: failed to write tmp ${tmp}"
    rm -f "${tmp}" 2>/dev/null || true
    return 0
  fi
  if ! mv -f "${tmp}" "${target}" 2>/dev/null; then
    _swt_team_log "swt_team_write: failed to mv ${tmp} -> ${target}"
    rm -f "${tmp}" 2>/dev/null || true
    return 0
  fi
  return 0
}

# swt_team_read <teamId>
swt_team_read() {
  local team_id="${1:-}"
  if [ -z "${team_id}" ]; then
    printf '{}\n'
    return 0
  fi
  local root target
  root="$(swt_team_state_root)"
  target="${root}/${team_id}.json"
  if [ ! -f "${target}" ]; then
    printf '{}\n'
    return 0
  fi
  if ! cat "${target}" 2>/dev/null; then
    _swt_team_log "swt_team_read: failed to cat ${target}"
    printf '{}\n'
  fi
  return 0
}

# swt_team_list
swt_team_list() {
  local root
  root="$(swt_team_state_root)"
  if [ ! -d "${root}" ]; then
    return 0
  fi
  local file
  shopt -s nullglob 2>/dev/null || true
  for file in "${root}"/*.json; do
    [ -f "${file}" ] || continue
    if ! jq -c . "${file}" 2>/dev/null; then
      _swt_team_log "swt_team_list: failed to parse ${file}"
    fi
  done
  shopt -u nullglob 2>/dev/null || true
  return 0
}

# swt_team_mark_stale <teamId>
# jq-merges {status:"stale", lastHeartbeat: now} into the existing body and
# writes atomically. No-op if the file is missing.
swt_team_mark_stale() {
  local team_id="${1:-}"
  if [ -z "${team_id}" ]; then
    _swt_team_log "swt_team_mark_stale: missing teamId"
    return 0
  fi
  local root target
  root="$(swt_team_state_root)"
  target="${root}/${team_id}.json"
  if [ ! -f "${target}" ]; then
    _swt_team_log "swt_team_mark_stale: no team file at ${target}"
    return 0
  fi
  local now updated tmp
  now="$(_swt_team_iso_now)"
  updated="$(jq -c --arg now "${now}" '. + {status: "stale", lastHeartbeat: $now}' "${target}" 2>/dev/null || printf '')"
  if [ -z "${updated}" ]; then
    _swt_team_log "swt_team_mark_stale: jq merge failed for ${team_id}"
    return 0
  fi
  tmp="${target}.tmp.$$"
  if ! printf '%s\n' "${updated}" > "${tmp}" 2>/dev/null; then
    _swt_team_log "swt_team_mark_stale: failed to write tmp ${tmp}"
    rm -f "${tmp}" 2>/dev/null || true
    return 0
  fi
  if ! mv -f "${tmp}" "${target}" 2>/dev/null; then
    _swt_team_log "swt_team_mark_stale: failed to mv ${tmp} -> ${target}"
    rm -f "${tmp}" 2>/dev/null || true
    return 0
  fi
  return 0
}

# swt_team_remove <teamId>
swt_team_remove() {
  local team_id="${1:-}"
  if [ -z "${team_id}" ]; then
    return 0
  fi
  local root target
  root="$(swt_team_state_root)"
  target="${root}/${team_id}.json"
  rm -f "${target}" 2>/dev/null || true
  return 0
}
