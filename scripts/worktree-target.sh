#!/bin/bash
# v1.30.0: always prompt method. Switch to cwd when CC ships #26678.
set -u

WORKTREE_PATH="${1:-}"

# If no path given, exit silently (fail-open)
if [ -z "${WORKTREE_PATH// /}" ]; then
  exit 0
fi

printf '{"method":"prompt","path":"%s","instruction":"Your working directory is %s. ALL file operations must use this path."}\n' \
  "$WORKTREE_PATH" \
  "$WORKTREE_PATH"

exit 0
