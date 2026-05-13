#!/bin/bash
set -u
# worktree-status.sh — List active SWT agent worktrees as a JSON array.
# Interface: worktree-status.sh (no arguments)
# Output: JSON array on stdout. Always exits 0 (fail-open design).

# Parse git worktree list --porcelain output.
# Stanzas are separated by blank lines; each contains lines like:
#   worktree /abs/path
#   HEAD <sha>
#   branch refs/heads/vbw/01-01

# Collect matching stanzas and build JSON array manually (no jq required).

PORCELAIN=""
PORCELAIN=$(git worktree list --porcelain 2>/dev/null) || true

# Split into stanzas on blank lines, then process each
json_items=""

# We'll iterate line by line, accumulating stanza state
current_path=""
current_branch=""
in_vbw_worktree=0

process_stanza() {
  local path="$1"
  local branch="$2"
  local is_vbw="$3"

  [ "$is_vbw" -eq 0 ] && return
  [ -z "$path" ] && return
  [ -z "$branch" ] && return

  # Strip refs/heads/ prefix
  local short_branch="${branch#refs/heads/}"

  # Parse phase and plan from vbw/{phase}-{plan}
  # short_branch is like "vbw/01-01"
  local suffix="${short_branch#vbw/}"
  # Split on '-' — phase is everything before the first '-', plan is after
  local phase="${suffix%%-*}"
  local plan="${suffix#*-}"

  # Escape path for JSON (handle double quotes)
  local escaped_path
  escaped_path=$(printf '%s' "$path" | sed 's/\\/\\\\/g; s/"/\\"/g')
  local escaped_branch
  escaped_branch=$(printf '%s' "$short_branch" | sed 's/\\/\\\\/g; s/"/\\"/g')

  local entry
  entry="{\"path\":\"${escaped_path}\",\"branch\":\"${escaped_branch}\",\"phase\":\"${phase}\",\"plan\":\"${plan}\"}"

  if [ -z "$json_items" ]; then
    json_items="$entry"
  else
    json_items="${json_items},${entry}"
  fi
}

while IFS= read -r line || [ -n "$line" ]; do
  if [ -z "$line" ]; then
    # Blank line = end of stanza; process accumulated state
    process_stanza "$current_path" "$current_branch" "$in_vbw_worktree"
    current_path=""
    current_branch=""
    in_vbw_worktree=0
    continue
  fi

  key="${line%% *}"
  value="${line#* }"

  case "$key" in
    worktree)
      current_path="$value"
      # Check if this worktree path contains .swt-worktrees/
      case "$value" in
        *".swt-worktrees/"*) in_vbw_worktree=1 ;;
        *)                   in_vbw_worktree=0 ;;
      esac
      ;;
    branch)
      current_branch="$value"
      ;;
  esac
done <<EOF
$PORCELAIN
EOF

# Process any final stanza (no trailing blank line)
process_stanza "$current_path" "$current_branch" "$in_vbw_worktree"

printf '[%s]\n' "$json_items"

exit 0
