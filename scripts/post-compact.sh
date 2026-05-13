#!/usr/bin/env bash
# STUB — pairs with compaction-instructions.sh. TDD3 §20.4 defers the
# compaction story to Phase F; Phase 2 plan 02-04 Recommendation 2 keeps this
# as a stub.
#
# Responsibility: clean up the .swt-planning/.compacting/{sessionId}.json
# marker written by compaction-instructions.sh, and retain the
# snapshot-resume.sh restore call for Phase 6 crash recovery. The CC
# hook-protocol JSON output, post-compact resume hint, and teammate
# task-recovery references are dropped — all CC-only.
set -u

INPUT=$(cat 2>/dev/null || true)
PLANNING_DIR="${SWT_PLANNING_DIR:-${VBW_PLANNING_DIR:-.swt-planning}}"
COMPACTING_DIR="$PLANNING_DIR/.compacting"

SESSION_ID=""
if command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.sessionId // empty' 2>/dev/null) || SESSION_ID=""
fi
[ -z "$SESSION_ID" ] && SESSION_ID="${SWT_SESSION_ID:-unknown}"

rm -f "$COMPACTING_DIR/$SESSION_ID.json" 2>/dev/null || true

# Optional snapshot-resume restore — Phase 6 crash recovery.
if [ -x "$(dirname "${BASH_SOURCE[0]}")/snapshot-resume.sh" ]; then
  "$(dirname "${BASH_SOURCE[0]}")/snapshot-resume.sh" restore 2>/dev/null || true
fi

exit 0
