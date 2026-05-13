#!/usr/bin/env bash
set -u

# assess-plan-risk.sh <plan-path>
# Classifies plan risk as low/medium/high based on metadata signals.
# Scoring: task_count>5 (+1), file_count>8 (+1), cross_phase_deps (+1),
#          must_haves>4 (+1). Score 0-1=low, 2=medium, 3+=high.
# Fail-open: defaults to "medium" on any error.

if [ $# -lt 1 ]; then
  echo "medium"
  exit 0
fi

PLAN_PATH="$1"
if [ ! -f "$PLAN_PATH" ]; then
  echo "medium"
  exit 0
fi

SCORE=0

# Count tasks from ### Task N: headings
TASK_COUNT=$(grep -c '^### Task [0-9]' "$PLAN_PATH" 2>/dev/null) || TASK_COUNT=0
if [ "$TASK_COUNT" -gt 5 ] 2>/dev/null; then
  SCORE=$((SCORE + 1))
fi

# Count unique file paths from **Files:** lines
FILE_COUNT=$(grep -oE '\*\*Files:\*\* .+' "$PLAN_PATH" 2>/dev/null | \
  sed 's/\*\*Files:\*\* //' | \
  tr ',' '\n' | \
  sed 's/^ *//;s/ *$//' | \
  grep -v '^$' | \
  sort -u | \
  wc -l | tr -d ' ') || FILE_COUNT=0
if [ "$FILE_COUNT" -gt 8 ] 2>/dev/null; then
  SCORE=$((SCORE + 1))
fi

# Check for cross_phase_deps in frontmatter
if grep -q 'cross_phase_deps:' "$PLAN_PATH" 2>/dev/null; then
  SCORE=$((SCORE + 1))
fi

# Count must_haves from frontmatter
MH_COUNT=$(awk '
  BEGIN { in_front=0; in_mh=0; count=0 }
  /^---$/ { if (in_front==0) { in_front=1; next } else { exit } }
  in_front && /^must_haves:/ { in_mh=1; next }
  in_front && in_mh && /^[[:space:]]+- / { count++; next }
  in_front && in_mh && /^[^[:space:]]/ { exit }
  END { print count }
' "$PLAN_PATH" 2>/dev/null) || MH_COUNT=0
if [ "$MH_COUNT" -gt 4 ] 2>/dev/null; then
  SCORE=$((SCORE + 1))
fi

# Classify
if [ "$SCORE" -le 1 ]; then
  echo "low"
elif [ "$SCORE" -eq 2 ]; then
  echo "medium"
else
  echo "high"
fi
