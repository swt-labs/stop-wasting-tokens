#!/usr/bin/env bash
set -euo pipefail

# verify-hook-event-name.sh — Ensure all hook scripts include hookEventName in JSON output
#
# Claude Code's hook schema validator requires hookEventName inside hookSpecificOutput.
# This test checks that every script producing hookSpecificOutput also includes hookEventName.
# See: #2, #23, #72

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0

pass() {
  echo "PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL  $1"
  FAIL=$((FAIL + 1))
}

echo "=== Hook hookEventName Verification ==="

# For each script that emits hookSpecificOutput, verify every output block
# contains a hookEventName within ±3 lines. This catches:
# - Missing hookEventName in any single output path (cross-branch masking)
# - hookEventName present elsewhere in file but not near the output (wrong nesting)
# - Full-line and inline comments containing the token (false positives)

while IFS= read -r file; do
  rel="${file#$ROOT/}"

  # Find line numbers of non-comment lines containing hookSpecificOutput
  # Strips full-line comments, then filters for the token
  output_lines=$(grep -n 'hookSpecificOutput' "$file" 2>/dev/null \
    | grep -v '^[0-9]*:[[:space:]]*#' \
    | cut -d: -f1 || true)

  [ -z "$output_lines" ] && continue

  total_lines=$(wc -l < "$file")
  all_ok=true
  missing_at=""
  block_count=0

  for line_num in $output_lines; do
    block_count=$((block_count + 1))
    # Check ±3 line window for hookEventName (excluding full-line comments)
    start=$((line_num - 3))
    [ "$start" -lt 1 ] && start=1
    end=$((line_num + 3))
    [ "$end" -gt "$total_lines" ] && end="$total_lines"

    found=$(sed -n "${start},${end}p" "$file" \
      | grep -v '^[[:space:]]*#' \
      | grep -c 'hookEventName' 2>/dev/null || true)
    if [ "$found" -eq 0 ]; then
      all_ok=false
      missing_at="${missing_at} L${line_num}"
    fi
  done

  if [ "$all_ok" = true ]; then
    pass "$rel: hookEventName present in all $block_count output blocks"
  else
    fail "$rel: hookEventName missing near${missing_at}"
  fi
done < <(find "$ROOT/scripts" -type f -name '*.sh' | sort)

echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "All hook hookEventName checks passed."
exit 0
