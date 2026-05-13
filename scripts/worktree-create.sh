#!/bin/bash
set -u

# worktree-create.sh <phase> <plan> [base-branch]
# Creates a git worktree for the given phase/plan combination.
# Output: absolute path of the worktree on success; nothing on failure.
# Exit code: always 0 (fail-open).

PHASE="${1:-}"
PLAN="${2:-}"
BASE="${3:-}"

# Validate required arguments
if [ -z "$PHASE" ] || [ -z "$PLAN" ]; then
  exit 0
fi

WORKTREE_DIR=".swt-worktrees/${PHASE}-${PLAN}"
BRANCH="vbw/${PHASE}-${PLAN}"

# Idempotent: if worktree already exists, return its absolute path
if [ -d "$WORKTREE_DIR" ]; then
  ABS_PATH=$(cd "$WORKTREE_DIR" && pwd)
  echo "$ABS_PATH"
  exit 0
fi

# Ensure the parent directory exists
mkdir -p .swt-worktrees

# Append .swt-worktrees/ to .gitignore if not already present
GITIGNORE=".gitignore"
if ! grep -qxF ".swt-worktrees/" "$GITIGNORE" 2>/dev/null; then
  echo ".swt-worktrees/" >> "$GITIGNORE"
fi

# Build the git worktree add command
# Try -b first (create new branch); fall back to existing branch if it already exists
if [ -n "$BASE" ]; then
  git worktree add "$WORKTREE_DIR" -b "$BRANCH" "$BASE" 2>/dev/null
  GIT_STATUS=$?
  if [ "$GIT_STATUS" -ne 0 ]; then
    git worktree add "$WORKTREE_DIR" "$BRANCH" 2>/dev/null
    GIT_STATUS=$?
  fi
else
  git worktree add "$WORKTREE_DIR" -b "$BRANCH" 2>/dev/null
  GIT_STATUS=$?
  if [ "$GIT_STATUS" -ne 0 ]; then
    git worktree add "$WORKTREE_DIR" "$BRANCH" 2>/dev/null
    GIT_STATUS=$?
  fi
fi

# On success, resolve and echo the absolute path
if [ "$GIT_STATUS" -eq 0 ]; then
  ABS_PATH=$(cd "$WORKTREE_DIR" && pwd)
  echo "$ABS_PATH"
fi

exit 0
