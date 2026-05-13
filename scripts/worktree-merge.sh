#!/bin/bash
set -u

# worktree-merge.sh <phase> <plan>
# Merges vbw/<phase>-<plan> branch into the current branch using --no-ff.
# Output: exactly "clean" on success or "conflict" on merge failure.
# Exit code: always 0 (fail-open).

PHASE="${1:-}"
PLAN="${2:-}"

# Validate required arguments
if [ -z "$PHASE" ] || [ -z "$PLAN" ]; then
  exit 0
fi

BRANCH="vbw/${PHASE}-${PLAN}"

# Attempt the merge
git merge --no-ff "$BRANCH" -m "merge: phase ${PHASE} plan ${PLAN}" 2>/dev/null
MERGE_STATUS=$?

if [ "$MERGE_STATUS" -eq 0 ]; then
  echo "clean"
else
  git merge --abort 2>/dev/null || true
  echo "conflict"
fi

exit 0
