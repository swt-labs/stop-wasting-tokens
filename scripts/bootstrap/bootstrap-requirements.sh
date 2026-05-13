#!/usr/bin/env bash
set -euo pipefail

# bootstrap-requirements.sh — Generate REQUIREMENTS.md from discovery data
#
# Usage: bootstrap-requirements.sh OUTPUT_PATH DISCOVERY_JSON_PATH [RESEARCH_FILE]
#   OUTPUT_PATH          Path to write REQUIREMENTS.md
#   DISCOVERY_JSON_PATH  Path to discovery.json with answered[] and inferred[]
#   RESEARCH_FILE        Optional path to domain-research.md

if [[ $# -lt 2 ]]; then
  echo "Usage: bootstrap-requirements.sh OUTPUT_PATH DISCOVERY_JSON_PATH [RESEARCH_FILE]" >&2
  exit 1
fi

OUTPUT_PATH="$1"
DISCOVERY_JSON="$2"
RESEARCH_FILE="${3:-}"

if [[ ! -f "$DISCOVERY_JSON" ]]; then
  echo "Error: Discovery file not found: $DISCOVERY_JSON" >&2
  exit 1
fi

# Validate JSON
if ! jq empty "$DISCOVERY_JSON" 2>/dev/null; then
  echo "Error: Invalid JSON in $DISCOVERY_JSON" >&2
  exit 1
fi

# Check if research file exists
RESEARCH_AVAILABLE=false
if [ -n "$RESEARCH_FILE" ] && [ -f "$RESEARCH_FILE" ]; then
  RESEARCH_AVAILABLE=true
fi

CREATED=$(date +%Y-%m-%d)

# Ensure parent directory exists
mkdir -p "$(dirname "$OUTPUT_PATH")"

# Extract inferred requirements count
INFERRED_COUNT=$(jq '.inferred | length' "$DISCOVERY_JSON")

# Build the file
{
  echo "# Requirements"
  echo ""
  echo "Defined: ${CREATED}"
  echo ""
  echo "## Requirements"
  echo ""

  if [[ "$INFERRED_COUNT" -gt 0 ]]; then
    REQ_NUM=1
    for i in $(seq 0 $((INFERRED_COUNT - 1))); do
      REQ_ID=$(printf "REQ-%02d" "$REQ_NUM")
      REQ_TEXT=$(jq -r ".inferred[$i].text // .inferred[$i]" "$DISCOVERY_JSON")
      REQ_PRIORITY=$(jq -r ".inferred[$i].priority // \"Must-have\"" "$DISCOVERY_JSON")

      echo "### ${REQ_ID}: ${REQ_TEXT}"
      echo "**${REQ_PRIORITY}**"
      echo ""
      REQ_NUM=$((REQ_NUM + 1))
    done
  else
    echo "_(No requirements defined yet)_"
    echo ""
  fi

  echo "## Out of Scope"
  echo ""
  echo "_(To be defined)_"
  echo ""
} > "$OUTPUT_PATH"

# Update discovery.json with research metadata
if [ "$RESEARCH_AVAILABLE" = true ]; then
  DOMAIN=$(jq -r '.answered[] | select(.category=="scope") | .answer' "$DISCOVERY_JSON" | head -1 | awk '{print $1}')
  DATE=$(date +%Y-%m-%d)
  jq --arg domain "$DOMAIN" --arg date "$DATE" \
     '.research_summary = {available: true, domain: $domain, date: $date, key_findings: []}' \
     "$DISCOVERY_JSON" > "$DISCOVERY_JSON.tmp" && mv "$DISCOVERY_JSON.tmp" "$DISCOVERY_JSON"
else
  jq '.research_summary = {available: false}' "$DISCOVERY_JSON" > "$DISCOVERY_JSON.tmp" && mv "$DISCOVERY_JSON.tmp" "$DISCOVERY_JSON"
fi

exit 0
