#!/bin/bash
set -euo pipefail
# Install SWT-managed git hooks. Idempotent — safe to run repeatedly.
#
# Phase 2 plan 02-04 §6.2 light edit (Research §B item 7):
#   The installed .git/hooks/pre-push body now resolves the upstream hook script
#   via ${SWT_INSTALL_ROOT}/scripts/pre-push-hook.sh — the npm-installed
#   location. The previous version searched ${SWT_CONFIG_DIR}/plugins/cache/.../
#   for a versioned marketplace cache, which does not exist in npm-installed
#   SWT. Falls back to walking up from the hook's own directory when env-less
#   (git invokes hooks in a stripped environment).
#
# When the resolver can't find the hook script, the installed pre-push exits 0
# rather than blocking the push — the hook-wrapper invariant (always allow on
# missing infrastructure) extends here.

# Determine the user's project root, NOT the plugin root.
# When called from a hook, $PWD is the project. When called manually, use git.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || ROOT=""

# Exit silently if not inside a git repo
if [ -z "$ROOT" ] || [ ! -d "$ROOT/.git" ]; then
  exit 0
fi

# Ensure hooks directory exists
mkdir -p "$ROOT/.git/hooks"

# --- pre-push hook ---
HOOK_PATH="$ROOT/.git/hooks/pre-push"

# Standalone hook script. Resolves SWT_INSTALL_ROOT at runtime (env preferred,
# repo-cascade fallback for environments where git strips the var).
HOOK_CONTENT='#!/usr/bin/env bash
set -euo pipefail
# SWT pre-push hook — delegates to ${SWT_INSTALL_ROOT}/scripts/pre-push-hook.sh.
# Installed by SWT install-hooks.sh. Remove with: rm .git/hooks/pre-push
#
# Git runs hooks in a clean environment so SWT_INSTALL_ROOT may not be set.
# Fall back to walking up two levels from this hooks/ dir to find the SWT repo
# root when invoked from a checked-out SWT working copy.
if [ -z "${SWT_INSTALL_ROOT:-}" ]; then
  _HOOK_SELF=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd -P 2>/dev/null) || _HOOK_SELF=""
  if [ -n "$_HOOK_SELF" ] && [ -x "$_HOOK_SELF/scripts/pre-push-hook.sh" ]; then
    SWT_INSTALL_ROOT="$_HOOK_SELF"
  fi
fi
if [ -n "${SWT_INSTALL_ROOT:-}" ] && [ -x "$SWT_INSTALL_ROOT/scripts/pre-push-hook.sh" ]; then
  exec bash "$SWT_INSTALL_ROOT/scripts/pre-push-hook.sh" "$@"
fi
# Hook script not resolvable — skip silently (hook-wrapper invariant).
exit 0'

if [ -f "$HOOK_PATH" ]; then
  # Check if this is a SWT-managed hook (symlink to old target or contains our marker)
  if [ -L "$HOOK_PATH" ]; then
    CURRENT_TARGET=$(readlink "$HOOK_PATH")
    if echo "$CURRENT_TARGET" | grep -q "pre-push-hook.sh"; then
      # Old symlink-style SWT hook — upgrade to standalone script
      echo "$HOOK_CONTENT" > "$HOOK_PATH"
      chmod +x "$HOOK_PATH"
      echo "Upgraded pre-push hook to standalone script" >&2
    else
      echo "pre-push hook exists but is not managed by SWT -- skipping" >&2
    fi
  elif grep -q "SWT pre-push hook" "$HOOK_PATH" 2>/dev/null; then
    # SWT-managed hook — check if it needs upgrading to SWT_INSTALL_ROOT resolver
    if ! grep -q "SWT_INSTALL_ROOT" "$HOOK_PATH" 2>/dev/null; then
      echo "$HOOK_CONTENT" > "$HOOK_PATH"
      chmod +x "$HOOK_PATH"
      echo "Upgraded pre-push hook to SWT_INSTALL_ROOT resolver" >&2
    else
      echo "pre-push hook already installed" >&2
    fi
  else
    echo "pre-push hook exists but is not managed by SWT -- skipping" >&2
  fi
else
  echo "$HOOK_CONTENT" > "$HOOK_PATH"
  chmod +x "$HOOK_PATH"
  echo "Installed pre-push hook" >&2
fi
