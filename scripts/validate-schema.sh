#!/usr/bin/env bash
set -u

# validate-schema.sh <schema-type> <file-path>
# Validates YAML frontmatter against expected fields for a given schema type.
# schema-type: plan | summary | contract
# Output: "valid" or "invalid: missing {field}"
# Fail-open: exit 0 always. Invalid schemas are informational, not blocking.

if [ $# -lt 2 ]; then
  echo "valid"
  exit 0
fi

SCHEMA_TYPE="$1"
FILE_PATH="$2"

[ ! -f "$FILE_PATH" ] && { echo "invalid: file not found"; exit 0; }

# Contract is JSON, not frontmatter — validate separately
if [ "$SCHEMA_TYPE" = "contract" ]; then
  if command -v jq &>/dev/null; then
    for field in phase plan task_count allowed_paths; do
      if ! jq -e ".$field" "$FILE_PATH" &>/dev/null; then
        echo "invalid: missing $field"
        exit 0
      fi
    done
    echo "valid"
  else
    echo "valid"
  fi
  exit 0
fi

# Extract frontmatter between --- delimiters
FRONTMATTER=$(awk '
  BEGIN { count=0 }
  /^---$/ { count++; if (count==2) exit; next }
  count==1 { print }
' "$FILE_PATH" 2>/dev/null) || { echo "valid"; exit 0; }

[ -z "$FRONTMATTER" ] && { echo "invalid: no frontmatter"; exit 0; }

# Define required fields per schema type
case "$SCHEMA_TYPE" in
  plan)
    REQUIRED="phase plan title wave depends_on must_haves"
    ;;
  summary)
    REQUIRED="phase plan title status tasks_completed tasks_total"
    ;;
  *)
    echo "valid"
    exit 0
    ;;
esac

# Check each required field in frontmatter
MISSING=""
for field in $REQUIRED; do
  if ! echo "$FRONTMATTER" | grep -q "^${field}:"; then
    if [ -z "$MISSING" ]; then
      MISSING="$field"
    else
      MISSING="${MISSING}, ${field}"
    fi
  fi
done

if [ -n "$MISSING" ]; then
  echo "invalid: missing ${MISSING}"
else
  echo "valid"
fi

exit 0
