#!/usr/bin/env bash
# Plan 04-01 (Phase 4) T5 — cook-event-publisher.
#
# Pi PreToolUse / PostToolUse hook script. Runs on every tool invocation
# inside a cook-spawned agent session and appends one JSON line per call
# to .swt-planning/.events/agent-{sub_session_id}.jsonl. The dashboard's
# events-tailer.ts (production glob: .swt-planning/.events/*.jsonl)
# picks the lines up; plan 04-02's reducer folds them into the live
# agent / tool-call pane.
#
# Required env (fireHook / Pi sets these per Phase 1's hook contract):
#   CLAUDE_HOOK_EVENT        — "PreToolUse" or "PostToolUse"
#   CLAUDE_TOOL_NAME         — e.g. "Read", "Edit", "Bash"
#   CLAUDE_TOOL_INPUT        — JSON string of tool input (truncated below)
#   CLAUDE_TOOL_RESULT       — JSON string of tool result (PostToolUse only)
#   CLAUDE_TOOL_DURATION_MS  — int (PostToolUse only)
#   SWT_SESSION_ID           — orchestrator session id (set by cook.ts)
#   SWT_SUB_SESSION_ID       — Pi sub-session id (set by cook.ts)
#   SWT_PLANNING_ROOT        — optional; defaults to $(pwd)/.swt-planning
#
# Failure modes: missing env vars, unwritable directory, malformed JSON
# input — the script exits 0 silently in every case. Hooks MUST NOT
# block the Pi turn (research §2.4 + the dashboard tailer's zod parser
# will skip invalid rows anyway per the events-tailer contract).

set -u

PLANNING_ROOT="${SWT_PLANNING_ROOT:-$(pwd)/.swt-planning}"
EVENTS_DIR="${PLANNING_ROOT}/.events"
mkdir -p "$EVENTS_DIR" 2>/dev/null || exit 0

SESSION_ID="${SWT_SESSION_ID:-unknown}"
SUB_SESSION_ID="${SWT_SUB_SESSION_ID:-unknown}"
TOOL="${CLAUDE_TOOL_NAME:-unknown}"
EVENT="${CLAUDE_HOOK_EVENT:-unknown}"

# RFC 3339 timestamp with millisecond precision when GNU date is
# available; fall back to BSD date (no %N) on macOS where the system
# date lacks subsecond support.
TS=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null)
if [[ "$TS" == *N* || -z "$TS" ]]; then
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
fi

TARGET="${EVENTS_DIR}/agent-${SUB_SESSION_ID}.jsonl"

# Cap excerpts at 500 chars to match the SnapshotEvent schema limit
# (cook.tool_call.input_excerpt / cook.tool_result.result_excerpt).
truncate_excerpt() {
  head -c 500 | tr -d '\n' | tr -d '\r'
}

# JSON-escape a string using python3 when available (correct for any
# byte sequence Pi might pass through); fall back to a naive wrap when
# python3 is missing. Invalid escapes will simply lose the event on the
# dashboard side (events-tailer.ts drops schema-invalid rows).
json_escape() {
  local input="$1"
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null \
      || printf '"%s"' "${input//\"/\\\"}"
  else
    printf '"%s"' "${input//\"/\\\"}"
  fi
}

if [[ "$EVENT" == "PreToolUse" ]]; then
  EXCERPT=$(printf '%s' "${CLAUDE_TOOL_INPUT:-}" | truncate_excerpt)
  ESCAPED=$(json_escape "$EXCERPT")
  printf '{"type":"cook.tool_call","ts":"%s","session_id":"%s","sub_session_id":"%s","tool":"%s","input_excerpt":%s}\n' \
    "$TS" "$SESSION_ID" "$SUB_SESSION_ID" "$TOOL" "$ESCAPED" \
    >> "$TARGET" 2>/dev/null || exit 0
elif [[ "$EVENT" == "PostToolUse" ]]; then
  EXCERPT=$(printf '%s' "${CLAUDE_TOOL_RESULT:-}" | truncate_excerpt)
  ESCAPED=$(json_escape "$EXCERPT")
  DURATION="${CLAUDE_TOOL_DURATION_MS:-0}"
  # Guard against non-numeric duration env.
  if ! [[ "$DURATION" =~ ^[0-9]+$ ]]; then DURATION=0; fi
  printf '{"type":"cook.tool_result","ts":"%s","session_id":"%s","sub_session_id":"%s","tool":"%s","result_excerpt":%s,"duration_ms":%s}\n' \
    "$TS" "$SESSION_ID" "$SUB_SESSION_ID" "$TOOL" "$ESCAPED" "$DURATION" \
    >> "$TARGET" 2>/dev/null || exit 0
fi

exit 0
