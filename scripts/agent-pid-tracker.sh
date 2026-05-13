#!/usr/bin/env bash
# agent-pid-tracker.sh — Track active SWT agent sessions for cleanup on tmux detach
#
# TDD3 §6.3 rewrite (plan 02-01): state moved from the legacy VBW flat
# newline-delimited PID file to SWT's per-session JSON at
# .swt-planning/.sessions/{sessionId}.json. The four-verb interface
# (register | unregister | list | prune) is preserved bit-for-bit (REQ-06).
#
# Usage:
#   agent-pid-tracker.sh register [<sessionId>] [<pid>] [<role>]
#   agent-pid-tracker.sh register <pid>                # legacy positional (digits-only arg = PID)
#   agent-pid-tracker.sh unregister <sessionId|pid>
#   agent-pid-tracker.sh list
#   agent-pid-tracker.sh prune
#   agent-pid-tracker.sh --help
#
# State location: .swt-planning/.sessions/{sessionId}.json
# Schema:       see scripts/lib/swt-session-state.sh
# Hook-wrapper invariant: every error path exits 0; this script never crashes
# the parent dispatcher.

set -u  # NOT -e — every error path must allow continuation to exit 0.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/swt-session-state.sh
. "${SCRIPT_DIR}/lib/swt-session-state.sh"

# --- Locking ---------------------------------------------------------------
# Per-process scratch lock dir; mkdir-spin with 5 retries and 0.1s backoff.
# flock is not available on macOS by default; mkdir is portable.
LOCK_DIR="${SWT_AGENT_PID_LOCK_DIR:-/tmp/swt-agent-pid-lock-$(id -u 2>/dev/null || printf 0)-$$}"

_log_stderr() {
  printf '[agent-pid-tracker] %s\n' "$*" >&2
}

_log_event_safe() {
  # Best-effort structured log; never crashes on absence.
  local log_event="${SCRIPT_DIR}/log-event.sh"
  if [ -x "${log_event}" ]; then
    "${log_event}" "$@" >/dev/null 2>&1 || true
  fi
}

_acquire_lock() {
  local retries=5
  while ! mkdir "${LOCK_DIR}" 2>/dev/null; do
    retries=$((retries - 1))
    if [ "${retries}" -le 0 ]; then
      _log_stderr "lock contention at ${LOCK_DIR}; proceeding without lock"
      return 1
    fi
    sleep 0.1
  done
  return 0
}

_release_lock() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}

# --- Argv ------------------------------------------------------------------
_print_usage() {
  cat <<'USAGE'
Usage: agent-pid-tracker.sh <subcommand> [args]

Subcommands:
  register [<sessionId>] [<pid>] [<role>]   register a new session
  register <pid>                            legacy: digits-only first arg = PID
  unregister <sessionId|pid>                remove a session by id or pid
  list                                      one compact JSON object per session
  prune                                     remove sessions whose .pid is dead
  --help                                    show this message

State: .swt-planning/.sessions/{sessionId}.json (see scripts/lib/swt-session-state.sh)
USAGE
}

_is_positive_int() {
  case "${1:-}" in
    ''|*[!0-9]*) return 1 ;;
    0*) return 1 ;;  # reject 0 and leading-zero strings
    *) return 0 ;;
  esac
}

_iso_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf '1970-01-01T00:00:00Z\n'
}

# --- register --------------------------------------------------------------
cmd_register() {
  local arg1="${1:-}"
  local arg2="${2:-}"
  local arg3="${3:-}"

  local session_id pid role

  if [ -z "${arg1}" ] && [ -z "${arg2}" ] && [ -z "${arg3}" ]; then
    # Pure env-driven path.
    session_id="${SWT_SESSION_ID:-}"
    pid=""
    role="${VBW_AGENT_ROLE:-unknown}"
  elif _is_positive_int "${arg1}" && [ -z "${arg2}" ] && [ -z "${arg3}" ]; then
    # Legacy positional: single digits-only arg = PID; sessionId from env.
    pid="${arg1}"
    session_id="${SWT_SESSION_ID:-}"
    role="${VBW_AGENT_ROLE:-unknown}"
  else
    # New triple form: <sessionId> [<pid>] [<role>]
    session_id="${arg1}"
    pid="${arg2}"
    role="${arg3:-${VBW_AGENT_ROLE:-unknown}}"
  fi

  # sessionId fallback: uuidgen if available.
  if [ -z "${session_id}" ]; then
    if command -v uuidgen >/dev/null 2>&1; then
      session_id="$(uuidgen 2>/dev/null || printf '')"
    fi
  fi
  if [ -z "${session_id}" ]; then
    _log_stderr "register: no sessionId (env SWT_SESSION_ID unset and uuidgen unavailable)"
    _log_event_safe error 02-01 reason="register-missing-sessionId" || true
    return 0
  fi

  # PID validation: blank or positive int. Reject malformed.
  if [ -n "${pid}" ] && ! _is_positive_int "${pid}"; then
    _log_stderr "register: invalid pid '${pid}'"
    return 0
  fi

  _acquire_lock || true
  # Trap-based lock release in case we get interrupted.
  trap '_release_lock' EXIT INT TERM

  local now
  now="$(_iso_now)"

  # Compose JSON via jq -n to guarantee well-formed output.
  local body
  if [ -n "${pid}" ]; then
    body="$(jq -n \
      --arg sessionId "${session_id}" \
      --argjson pid "${pid}" \
      --arg role "${role}" \
      --arg started_at "${now}" \
      --arg last_heartbeat "${now}" \
      '{sessionId: $sessionId, pid: $pid, role: $role, started_at: $started_at, last_heartbeat: $last_heartbeat}' \
      2>/dev/null || printf '')"
  else
    body="$(jq -n \
      --arg sessionId "${session_id}" \
      --arg role "${role}" \
      --arg started_at "${now}" \
      --arg last_heartbeat "${now}" \
      '{sessionId: $sessionId, role: $role, started_at: $started_at, last_heartbeat: $last_heartbeat}' \
      2>/dev/null || printf '')"
  fi

  if [ -z "${body}" ]; then
    _log_stderr "register: failed to compose JSON for ${session_id}"
    _release_lock
    trap - EXIT INT TERM
    return 0
  fi

  swt_session_write "${session_id}" "${body}"

  _release_lock
  trap - EXIT INT TERM
  return 0
}

# --- unregister ------------------------------------------------------------
cmd_unregister() {
  local arg1="${1:-}"
  if [ -z "${arg1}" ]; then
    _log_stderr "unregister: missing arg"
    return 0
  fi

  _acquire_lock || true
  trap '_release_lock' EXIT INT TERM

  if _is_positive_int "${arg1}"; then
    # PID path: scan session files and remove the one whose .pid matches.
    local root file matched_id
    root="$(swt_session_state_root)"
    if [ -d "${root}" ]; then
      shopt -s nullglob 2>/dev/null || true
      for file in "${root}"/*.json; do
        [ -f "${file}" ] || continue
        local file_pid
        file_pid="$(jq -r '.pid // empty' "${file}" 2>/dev/null || printf '')"
        if [ "${file_pid}" = "${arg1}" ]; then
          matched_id="$(jq -r '.sessionId // empty' "${file}" 2>/dev/null || printf '')"
          if [ -n "${matched_id}" ]; then
            swt_session_remove "${matched_id}"
          else
            rm -f "${file}" 2>/dev/null || true
          fi
        fi
      done
      shopt -u nullglob 2>/dev/null || true
    fi
  else
    swt_session_remove "${arg1}"
  fi

  _release_lock
  trap - EXIT INT TERM
  return 0
}

# --- list ------------------------------------------------------------------
cmd_list() {
  swt_session_list
  return 0
}

# --- prune -----------------------------------------------------------------
cmd_prune() {
  _acquire_lock || true
  trap '_release_lock' EXIT INT TERM

  swt_session_prune

  _release_lock
  trap - EXIT INT TERM
  return 0
}

# --- main ------------------------------------------------------------------
CMD="${1:-}"
shift 2>/dev/null || true

case "${CMD}" in
  --help|-h|help)
    _print_usage
    exit 0
    ;;
  register)
    cmd_register "$@"
    ;;
  unregister)
    cmd_unregister "$@"
    ;;
  list)
    cmd_list
    ;;
  prune)
    cmd_prune
    ;;
  '')
    _log_stderr "missing subcommand"
    _print_usage >&2
    ;;
  *)
    _log_stderr "unknown subcommand: ${CMD}"
    _print_usage >&2
    ;;
esac

# Hook-wrapper invariant: always exit 0.
exit 0
