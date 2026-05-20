#!/usr/bin/env bash
set -euo pipefail

# bootstrap-roadmap.sh — Generate ROADMAP.md and create phase directories
#
# Usage: bootstrap-roadmap.sh OUTPUT_PATH PROJECT_NAME PHASES_JSON
#   OUTPUT_PATH    Path to write ROADMAP.md
#   PROJECT_NAME   Name of the project/milestone
#   PHASES_JSON    Path to JSON file with array of phase objects:
#                  [{name, goal, requirements[], success_criteria[]}]

if [[ $# -lt 3 ]]; then
  echo "Usage: bootstrap-roadmap.sh OUTPUT_PATH PROJECT_NAME PHASES_JSON" >&2
  exit 1
fi

OUTPUT_PATH="$1"
PROJECT_NAME="$2"
PHASES_JSON="$3"

if [[ ! -f "$PHASES_JSON" ]]; then
  echo "Error: Phases file not found: $PHASES_JSON" >&2
  exit 1
fi

if ! jq empty "$PHASES_JSON" 2>/dev/null; then
  echo "Error: Invalid JSON in $PHASES_JSON" >&2
  exit 1
fi

PHASE_COUNT=$(jq 'length' "$PHASES_JSON")
if [[ "$PHASE_COUNT" -eq 0 ]]; then
  echo "Error: No phases defined in $PHASES_JSON" >&2
  exit 1
fi

# Ensure parent directory exists
mkdir -p "$(dirname "$OUTPUT_PATH")"

# Derive phases directory from OUTPUT_PATH location
PLANNING_DIR="$(dirname "$OUTPUT_PATH")"
PHASES_DIR="${PLANNING_DIR}/phases"

{
  echo "# ${PROJECT_NAME} Roadmap"
  echo ""
  echo "**Goal:** ${PROJECT_NAME}"
  echo ""
  echo "**Scope:** ${PHASE_COUNT} phases"
  echo ""

  # Progress table
  echo "## Progress"
  echo "| Phase | Status | Plans | Tasks | Commits |"
  echo "|-------|--------|-------|-------|---------|"
  for i in $(seq 0 $((PHASE_COUNT - 1))); do
    PHASE_NUM=$((i + 1))
    echo "| ${PHASE_NUM} | Pending | 0 | 0 | 0 |"
  done
  echo ""
  echo "---"
  echo ""

  # Phase list
  echo "## Phase List"
  for i in $(seq 0 $((PHASE_COUNT - 1))); do
    PHASE_NUM=$((i + 1))
    PHASE_NAME=$(jq -r ".[$i].name" "$PHASES_JSON")
    SLUG=$(echo "$PHASE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
    echo "- [ ] [Phase ${PHASE_NUM}: ${PHASE_NAME}](#phase-${PHASE_NUM}-${SLUG})"
  done
  echo ""
  echo "---"
  echo ""

  # Phase details
  for i in $(seq 0 $((PHASE_COUNT - 1))); do
    PHASE_NUM=$((i + 1))
    PHASE_NAME=$(jq -r ".[$i].name" "$PHASES_JSON")
    PHASE_GOAL=$(jq -r ".[$i].goal" "$PHASES_JSON")
    REQS=$(jq -r ".[$i].requirements // [] | join(\", \")" "$PHASES_JSON")
    CRITERIA_COUNT=$(jq ".[$i].success_criteria // [] | length" "$PHASES_JSON")

    echo "## Phase ${PHASE_NUM}: ${PHASE_NAME}"
    echo ""
    echo "**Goal:** ${PHASE_GOAL}"
    echo ""
    if [[ -n "$REQS" ]]; then
      echo "**Requirements:** ${REQS}"
      echo ""
    fi
    echo "**Success Criteria:**"
    for j in $(seq 0 $((CRITERIA_COUNT - 1))); do
      CRITERION=$(jq -r ".[$i].success_criteria[$j]" "$PHASES_JSON")
      echo "- ${CRITERION}"
    done
    echo ""

    # Dependencies: Phase 1 has none, others depend on previous
    if [[ "$PHASE_NUM" -eq 1 ]]; then
      echo "**Dependencies:** None"
    else
      echo "**Dependencies:** Phase $((PHASE_NUM - 1))"
    fi
    echo ""

    if [[ $i -lt $((PHASE_COUNT - 1)) ]]; then
      echo "---"
      echo ""
    fi
  done
} > "$OUTPUT_PATH"

# Create phase directories
for i in $(seq 0 $((PHASE_COUNT - 1))); do
  PHASE_NUM=$(printf "%02d" $((i + 1)))
  PHASE_NAME=$(jq -r ".[$i].name" "$PHASES_JSON")
  SLUG=$(echo "$PHASE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
  mkdir -p "${PHASES_DIR}/${PHASE_NUM}-${SLUG}"
done

exit 0
