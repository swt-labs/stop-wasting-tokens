#!/usr/bin/env bash
set -euo pipefail

# infer-gsd-summary.sh — Extract recent work context from archived GSD planning data
#
# Usage: infer-gsd-summary.sh GSD_ARCHIVE_DIR
#   GSD_ARCHIVE_DIR   Path to .swt-planning/gsd-archive/ directory
#
# Output: JSON to stdout with latest milestone, recent phases, key decisions,
#         and current work status. Focused on recent context (last 2-3 phases).
#
# Exit: Always exits 0. Missing directory/files produce minimal JSON, not errors.

EMPTY_JSON='{"latest_milestone":null,"recent_phases":[],"key_decisions":[],"current_work":null}'

if [[ $# -lt 1 ]]; then
  echo "$EMPTY_JSON" | jq .
  exit 0
fi

GSD_ARCHIVE_DIR="$1"

# If archive directory doesn't exist, output minimal JSON
if [[ ! -d "$GSD_ARCHIVE_DIR" ]]; then
  echo "$EMPTY_JSON" | jq .
  exit 0
fi

# --- Extract latest milestone from INDEX.json ---
LATEST_MILESTONE="null"
INDEX_FILE="$GSD_ARCHIVE_DIR/INDEX.json"

if [[ -f "$INDEX_FILE" ]]; then
  milestone_name=$(jq -r '.milestones[-1] // empty' "$INDEX_FILE" 2>/dev/null || true)
  if [[ -n "$milestone_name" ]]; then
    phases_total=$(jq -r '.phases_total // 0' "$INDEX_FILE" 2>/dev/null || echo "0")
    phases_complete=$(jq -r '.phases_complete // 0' "$INDEX_FILE" 2>/dev/null || echo "0")
    if [[ "$phases_complete" -eq "$phases_total" ]] && [[ "$phases_total" -gt 0 ]]; then
      milestone_status="complete"
    else
      milestone_status="in_progress"
    fi
    LATEST_MILESTONE=$(jq -n \
      --arg name "$milestone_name" \
      --argjson phase_count "$phases_total" \
      --arg status "$milestone_status" \
      '{"name": $name, "phase_count": $phase_count, "status": $status}')
  fi
fi

# --- Extract last 2-3 completed phases with task/commit counts ---
RECENT_PHASES="[]"

if [[ -f "$INDEX_FILE" ]]; then
  # Get completed phases from INDEX.json, take last 3
  completed_phases=$(jq '[.phases[] | select(.status == "complete")] | .[-3:]' "$INDEX_FILE" 2>/dev/null || echo "[]")

  if [[ "$completed_phases" != "[]" ]]; then
    # Try to enrich with task/commit counts from ROADMAP.md progress table
    ROADMAP_FILE="$GSD_ARCHIVE_DIR/ROADMAP.md"
    roadmap_data="{}"

    if [[ -f "$ROADMAP_FILE" ]]; then
      # Parse progress table: | Phase | Status | Plans | Tasks | Commits |
      while IFS='|' read -r _ phase_col _ _ tasks_col commits_col _; do
        phase_num=$(echo "$phase_col" | tr -d ' ')
        tasks=$(echo "$tasks_col" | tr -d ' ')
        commits=$(echo "$commits_col" | tr -d ' ')
        # Only process numeric rows
        if [[ "$phase_num" =~ ^[0-9]+$ ]]; then
          roadmap_data=$(jq -n --argjson existing "$roadmap_data" \
            --arg key "$phase_num" \
            --argjson tasks "${tasks:-0}" \
            --argjson commits "${commits:-0}" \
            '$existing + {($key): {"tasks": $tasks, "commits": $commits}}')
        fi
      done < <(grep -E '^\|[[:space:]]*[0-9]+' "$ROADMAP_FILE" 2>/dev/null || true)
    fi

    # Build recent_phases array with enriched data
    RECENT_PHASES=$(echo "$completed_phases" | jq --argjson roadmap "$roadmap_data" '
      [.[] | {
        "name": "\(.num)-\(.slug)",
        "tasks": ($roadmap[(.num | tostring)].tasks // .plans),
        "commits": ($roadmap[(.num | tostring)].commits // 0)
      }]')
  fi
fi

# --- Extract key decisions from STATE.md ---
KEY_DECISIONS="[]"
STATE_FILE="$GSD_ARCHIVE_DIR/STATE.md"

if [[ -f "$STATE_FILE" ]]; then
  in_decisions=false
  while IFS= read -r line; do
    # Detect Key Decisions / Decisions section header
    if [[ "$line" =~ ^##[[:space:]]+(Key[[:space:]]+)?Decisions ]]; then
      in_decisions=true
      continue
    fi
    # Stop at next section header
    if [[ "$in_decisions" == true ]] && [[ "$line" =~ ^## ]]; then
      break
    fi
    if [[ "$in_decisions" == true ]]; then
      # Parse table rows: | Decision | Date | Rationale |
      if [[ "$line" =~ ^\|[[:space:]]*[^|-] ]] && [[ ! "$line" =~ ^\|[[:space:]]*Decision ]]; then
        decision=$(echo "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2}')
        if [[ -n "$decision" ]] && [[ "$decision" != "_(No decisions yet)_" ]]; then
          KEY_DECISIONS=$(echo "$KEY_DECISIONS" | jq --arg d "$decision" '. + [$d]')
        fi
      fi
      # Parse bullet items: - Decision text
      if [[ "$line" =~ ^[[:space:]]*-[[:space:]]+(.+)$ ]]; then
        decision="${BASH_REMATCH[1]}"
        if [[ -n "$decision" ]]; then
          KEY_DECISIONS=$(echo "$KEY_DECISIONS" | jq --arg d "$decision" '. + [$d]')
        fi
      fi
    fi
  done < "$STATE_FILE"
fi

# --- Extract current work status ---
CURRENT_WORK="null"

if [[ -f "$INDEX_FILE" ]]; then
  # Find first in_progress phase from INDEX.json
  current_phase=$(jq -r '.phases[] | select(.status == "in_progress") | "\(.num)-\(.slug)"' "$INDEX_FILE" 2>/dev/null | head -1 || true)
  if [[ -n "$current_phase" ]]; then
    CURRENT_WORK=$(jq -n --arg phase "$current_phase" --arg status "in_progress" \
      '{"phase": $phase, "status": $status}')
  fi
fi

# If no in_progress phase found in INDEX.json, try STATE.md
if [[ "$CURRENT_WORK" == "null" ]] && [[ -f "$STATE_FILE" ]]; then
  # Look for Current Phase field: **Current Phase:** Phase N
  current_line=$(grep -E '^\*\*Current Phase:\*\*' "$STATE_FILE" 2>/dev/null | head -1 || true)
  if [[ -n "$current_line" ]]; then
    phase_name=$(echo "$current_line" | sed 's/\*\*Current Phase:\*\*[[:space:]]*//')
    status_line=$(grep -E '^\*\*Status:\*\*' "$STATE_FILE" 2>/dev/null | head -1 || true)
    phase_status=$(echo "$status_line" | sed 's/\*\*Status:\*\*[[:space:]]*//')
    if [[ -n "$phase_name" ]]; then
      CURRENT_WORK=$(jq -n --arg phase "$phase_name" --arg status "${phase_status:-unknown}" \
        '{"phase": $phase, "status": $status}')
    fi
  fi
fi

# --- Build output ---
jq -n \
  --argjson latest_milestone "$LATEST_MILESTONE" \
  --argjson recent_phases "$RECENT_PHASES" \
  --argjson key_decisions "$KEY_DECISIONS" \
  --argjson current_work "$CURRENT_WORK" \
  '{
    "latest_milestone": $latest_milestone,
    "recent_phases": $recent_phases,
    "key_decisions": $key_decisions,
    "current_work": $current_work
  }'
