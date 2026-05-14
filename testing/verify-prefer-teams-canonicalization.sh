#!/usr/bin/env bash
set -euo pipefail

# verify-prefer-teams-canonicalization.sh — Contract test for issue #127
#
# The canonical user-facing prefer_teams values are always|auto|never.
# Legacy when_parallel remains a silent compatibility alias in runtime code,
# but it must not reappear in docs/prompts as a documented choice.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0

pass() {
  echo "PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL  $1"
  FAIL=$((FAIL + 1))
}

echo "=== prefer_teams Canonicalization Contract (Issue #127) ==="

scan_for_legacy_alias() {
  local rel_path="$1"
  local abs_path="$ROOT/$rel_path"
  local hits

  hits=$(grep -n 'when_parallel' "$abs_path" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    fail "$rel_path: legacy alias 'when_parallel' reappeared in user-facing docs/prompts"
    printf '%s\n' "$hits" | head -5 | sed 's/^/     /'
  else
    pass "$rel_path: no documented when_parallel alias"
  fi
}

scan_for_legacy_alias "README.md"
scan_for_legacy_alias "commands/config.md"
scan_for_legacy_alias "commands/debug.md"
scan_for_legacy_alias "commands/map.md"
scan_for_legacy_alias "references/execute-protocol.md"

if grep -Fq '| prefer_teams | string | always/auto/never | auto |' "$ROOT/commands/config.md"; then
  pass "commands/config.md: canonical prefer_teams values table"
else
  fail "commands/config.md: canonical prefer_teams values table missing"
fi

# Phase 4 / Plan 04-03 (G-M4): the README config-reference table was reshaped by
# commit 36a1efd. The prefer_teams row is now a 4-column
# key | values | default | description table, not the old 5-column
# key | type | default | values shape. The contract intent (canonical values
# documented, default = auto, no when_parallel alias) is unchanged; the assertion
# is reconciled to the current README table format.
PREFER_TEAMS_ROW=$(grep -F '| `prefer_teams`' "$ROOT/README.md" || true)
if [ -n "$PREFER_TEAMS_ROW" ] \
  && printf '%s' "$PREFER_TEAMS_ROW" | grep -Fq '`auto`' \
  && printf '%s' "$PREFER_TEAMS_ROW" | grep -Fq '`always`' \
  && printf '%s' "$PREFER_TEAMS_ROW" | grep -Fq '`never`'; then
  pass "README.md: canonical prefer_teams settings row"
else
  fail "README.md: canonical prefer_teams settings row missing"
fi

if grep -Fq 'normalize-prefer-teams.sh' "$ROOT/commands/map.md"; then
  pass "commands/map.md: uses prefer_teams normalizer"
else
  fail "commands/map.md: missing prefer_teams normalizer"
fi

if grep -Fq 'normalize-prefer-teams.sh' "$ROOT/commands/debug.md"; then
  pass "commands/debug.md: uses prefer_teams normalizer"
else
  fail "commands/debug.md: missing prefer_teams normalizer"
fi

if grep -Fq 'normalize-prefer-teams.sh' "$ROOT/references/execute-protocol.md"; then
  pass "references/execute-protocol.md: uses prefer_teams normalizer"
else
  fail "references/execute-protocol.md: missing prefer_teams normalizer"
fi

echo ""
echo "==============================="
echo "TOTAL: $PASS PASS, $FAIL FAIL"
echo "==============================="

[ "$FAIL" -eq 0 ] || exit 1