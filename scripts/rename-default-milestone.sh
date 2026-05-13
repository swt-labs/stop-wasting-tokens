#!/usr/bin/env bash
set -euo pipefail

# rename-default-milestone.sh — Brownfield migration for milestones/default/
#
# Usage: rename-default-milestone.sh PLANNING_DIR
#
# If milestones/default/ exists, derives a meaningful slug from SHIPPED.md
# content (phase names, "What Changed" summary, or phase directory names)
# and renames it. Idempotent — exits 0 if no default/ exists.
#
# Exit codes: 0 on success (including no-op), 1 on failure

PLANNING_DIR="${1:-}"

if [[ -z "$PLANNING_DIR" ]]; then
  echo "Usage: rename-default-milestone.sh PLANNING_DIR" >&2
  exit 1
fi

DEFAULT_DIR="$PLANNING_DIR/milestones/default"

# Idempotent: no default dir → nothing to do
if [[ ! -d "$DEFAULT_DIR" ]]; then
  exit 0
fi

# --- Normalize text to kebab-case slug ---
normalize_slug() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | \
    sed 's/[^a-z0-9 -]//g' | \
    sed 's/  */ /g' | \
    tr ' ' '-' | \
    sed 's/--*/-/g' | \
    sed 's/^-//;s/-$//'
}

# --- Derive slug from SHIPPED.md ---
derive_slug() {
  local shipped="$DEFAULT_DIR/SHIPPED.md"
  local slug=""

  if [[ -f "$shipped" ]]; then
    # Try 1: Use milestone name from title (e.g., "# SHIPPED: My Milestone")
    local title_name
    title_name=$(awk '
      tolower($0) ~ /^#[[:space:]]*shipped:[[:space:]]*/ {
        sub(/^#[[:space:]]*[Ss][Hh][Ii][Pp][Pp][Ee][Dd]:[[:space:]]*/, "", $0)
        print
        exit
      }
    ' "$shipped")
    local title_name_lc
    title_name_lc=$(printf '%s\n' "$title_name" | tr '[:upper:]' '[:lower:]')
    if [[ -n "$title_name" && "$title_name_lc" != "default milestone" ]]; then
      slug=$(normalize_slug "$title_name")
    fi

    # Try 2: Extract phase names from "## Phases" section
    # Handles both bulleted (- Phase N: Name) and numbered (N. **Name** — desc) formats
    if [[ -z "$slug" ]]; then
      local phases
      phases=$(awk '
        tolower($0) ~ /^##[[:space:]]+phases[[:space:]]*$/ { found=1; next }
        found && /^## / { exit }
        found && /^[-*] / {
          sub(/^[-*] +(Phase [0-9]+: )?/, "")
          sub(/ [—–-] .*/, "")
          if (length > 0) print
        }
        found && /^[0-9]+\. / {
          sub(/^[0-9]+\. +/, "")
          gsub(/\*\*/, "")
          sub(/ [—–-] .*/, "")
          if (length > 0) print
        }
      ' "$shipped" | head -2)
      if [[ -n "$phases" ]]; then
        slug=$(echo "$phases" | tr '\n' ' ' | sed 's/ $//')
        slug=$(normalize_slug "$slug")
      fi
    fi
  fi

  # Try 3: Derive from phase directory names
  if [[ -z "$slug" && -d "$DEFAULT_DIR/phases" ]]; then
    local phase_dirs
    phase_dirs=$(ls -1 "$DEFAULT_DIR/phases/" 2>/dev/null | head -2 | sed 's/^[0-9]*-//')
    if [[ -n "$phase_dirs" ]]; then
      slug=$(echo "$phase_dirs" | tr '\n' ' ' | sed 's/ $//')
      slug=$(normalize_slug "$slug")
    fi
  fi

  # Fallback: timestamp-based
  if [[ -z "$slug" ]]; then
    slug="milestone-$(date +%Y%m%d)"
  fi

  # Truncate slug portion to 50 chars
  echo "$slug" | head -c 50 | sed 's/-$//'
}

# --- Determine milestone number prefix ---
milestone_number() {
  local count=0
  if [[ -d "$PLANNING_DIR/milestones" ]]; then
    local d
    for d in "$PLANNING_DIR/milestones"/*/; do
      [[ -d "$d" ]] || continue
      [[ "$(basename "$d")" == "default" ]] && continue
      count=$((count + 1))
    done
  fi
  printf "%02d" $((count + 1))
}

slug_name=$(derive_slug)
ms_num=$(milestone_number)

# Guard against empty slug
if [[ -z "$slug_name" ]]; then
  slug_name="milestone-$(date +%Y%m%d)"
fi

new_slug="${ms_num}-${slug_name}"
new_dir="$PLANNING_DIR/milestones/$new_slug"

# Guard against collision — loop with counter to guarantee unique name
if [[ -d "$new_dir" ]]; then
  suffix=1
  while [[ -d "${new_dir}-${suffix}" ]]; do
    suffix=$((suffix + 1))
    if [[ $suffix -gt 10 ]]; then
      echo "Error: cannot find unique name for milestone dir (tried $new_slug through $new_slug-10)" >&2
      exit 1
    fi
  done
  new_dir="${new_dir}-${suffix}"
fi

mv "$DEFAULT_DIR" "$new_dir"

exit 0
