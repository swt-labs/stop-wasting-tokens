#!/usr/bin/env bash
# STUB — Phase 2 plan 02-04 Recommendation 2 + TDD3 §20.4 defer the compaction
# story to Phase F. We trust Pi's built-in handling.
#
# This handler preserves the marker-write discipline that tmux-watchdog
# (plan 02-03) reads from .swt-planning/.compacting/ — that is the only
# responsibility kept from VBW's 307-LOC compaction-instructions.sh. The CC
# hook-protocol JSON output, role-specific priority strings, and loop-breaker
# directive are dropped — none of those are consumed by Pi.
#
# Future readers: don't expand this stub without revisiting TDD3 §20.4 first.
set -u

INPUT=$(cat 2>/dev/null || true)
PLANNING_DIR="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"
COMPACTING_DIR="$PLANNING_DIR/.compacting"
mkdir -p "$COMPACTING_DIR" 2>/dev/null || true

# Best-effort session id extraction. Falls back to the env var SWT_SESSION_ID
# (set by HookDispatcher.buildEnv in packages/runtime/src/hooks/dispatcher.ts).
SESSION_ID=""
if command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.sessionId // empty' 2>/dev/null) || SESSION_ID=""
fi
[ -z "$SESSION_ID" ] && SESSION_ID="${SWT_SESSION_ID:-unknown}"

ROLE=""
if command -v jq >/dev/null 2>&1; then
  ROLE=$(printf '%s' "$INPUT" | jq -r '.role // empty' 2>/dev/null) || ROLE=""
fi
[ -z "$ROLE" ] && ROLE="${VBW_AGENT_ROLE:-unknown}"

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%s)

# Per-session marker (tmux-watchdog reads this; plan 02-03).
printf '{"sessionId":"%s","role":"%s","startedAt":"%s"}\n' \
  "$SESSION_ID" "$ROLE" "$NOW" \
  > "$COMPACTING_DIR/$SESSION_ID.json" 2>/dev/null || true

# Bucket timestamp (.compaction-marker) preserved for backwards-compat with
# Dev re-read guard (REQ-14).
printf '%s\n' "$NOW" > "$PLANNING_DIR/.compaction-marker" 2>/dev/null || true

# Optional snapshot-resume save — useful for Phase 6 crash recovery.
if [ -x "$(dirname "${BASH_SOURCE[0]}")/snapshot-resume.sh" ]; then
  "$(dirname "${BASH_SOURCE[0]}")/snapshot-resume.sh" save 2>/dev/null || true
fi

exit 0
