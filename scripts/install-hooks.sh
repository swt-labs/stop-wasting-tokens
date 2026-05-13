#!/bin/bash
set -euo pipefail
# Install SWT-managed git hooks. Idempotent -- safe to run repeatedly.

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

# Create a standalone hook script that uses git rev-parse (not relative paths)
# so it works regardless of where the plugin is cached.
HOOK_CONTENT='#!/usr/bin/env bash
set -euo pipefail
# SWT pre-push hook — delegates to the latest cached plugin script.
# Installed by SWT install-hooks.sh. Remove with: rm .git/hooks/pre-push
#
# Try SWT_CONFIG_DIR first, then common default locations.
# Git runs hooks in a clean environment so SWT_CONFIG_DIR may not be set.
_vbw_find_script() {
  local dirs=(
    "${SWT_CONFIG_DIR:-$HOME/.claude}"
    "$HOME/.config/claude-code"
  )
  for d in "${dirs[@]}"; do
    [ -z "$d" ] && continue
    local s
    s=$(ls -1 "$d"/plugins/cache/*/scripts/pre-push-hook.sh 2>/dev/null | sort -V | tail -1 || true)
    [ -n "$s" ] && [ -f "$s" ] && echo "$s" && return 0
  done
  return 1
}
SCRIPT=$(_vbw_find_script || true)
if [ -n "$SCRIPT" ] && [ -f "$SCRIPT" ]; then
  exec bash "$SCRIPT" "$@"
fi
# Plugin not cached — skip silently
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
    # SWT-managed hook — check if it needs upgrading to multi-location resolver
    if ! grep -q "_vbw_find_script" "$HOOK_PATH" 2>/dev/null; then
      echo "$HOOK_CONTENT" > "$HOOK_PATH"
      chmod +x "$HOOK_PATH"
      echo "Upgraded pre-push hook to multi-location resolver" >&2
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
